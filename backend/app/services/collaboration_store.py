"""SQLite persistence for collaborative process snapshots and operation batches."""
from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
from typing import Any, Callable, ContextManager

from fastapi import HTTPException

from .collaboration import apply_collaboration_batch, operation_conflict_paths

def load_collaboration_state(conn: sqlite3.Connection, process_id: str) -> tuple[dict[str, Any], sqlite3.Row]:
    row = conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Процесс не найден")
    stored = json.loads(row["graph_json"])
    state = {
        "nodes": stored.get("nodes", []), "edges": stored.get("edges", []),
        "settings": stored.get("settings", {}), "name": row["name"],
        "description": row["description"], "folder": row["folder"],
    }
    return state, row


def persist_collaboration_state(conn: sqlite3.Connection, process_id: str, state: dict[str, Any], revision: int, now_iso_fn: Callable[[], str]) -> str:
    stamp = now_iso_fn()
    graph = {"nodes": state.get("nodes", []), "edges": state.get("edges", []), "settings": state.get("settings", {})}
    conn.execute("UPDATE processes SET name=?, description=?, folder=?, graph_json=?, revision=?, updated_at=? WHERE id=?", (
        str(state.get("name") or "Новый процесс")[:200], str(state.get("description") or "")[:5000],
        str(state.get("folder") or "")[:100], json.dumps(graph, ensure_ascii=False), revision, stamp, process_id,
    ))
    return stamp


def load_collaboration_snapshot(process_id: str, db_conn_factory: Callable[[], ContextManager[sqlite3.Connection]]) -> tuple[dict[str, Any], int]:
    """Read one consistent graph/revision pair outside the async event loop."""
    with db_conn_factory() as conn:
        state, row = load_collaboration_state(conn, process_id)
        return state, int(row["revision"])


def commit_collaboration_operation_batch(
    process_id: str,
    op_id: str,
    base_revision: int,
    path_keys: list[str],
    operations: list[dict[str, Any]],
    user_id: str,
    username: str,
    db_conn_factory: Callable[[], ContextManager[sqlite3.Connection]],
    now_iso_fn: Callable[[], str],
) -> dict[str, Any]:
    """Commit an idempotent operation batch and its journal entry in one SQLite transaction."""
    operations_hash = hashlib.sha256(json.dumps(operations, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    with db_conn_factory() as conn:
        conn.execute("BEGIN IMMEDIATE")
        duplicate = conn.execute("SELECT revision, conflicts_json, operations_hash, updated_at FROM process_op_receipts WHERE process_id = ? AND op_id = ?", (process_id, op_id)).fetchone()
        if duplicate is not None:
            if duplicate["operations_hash"] and not hmac.compare_digest(str(duplicate["operations_hash"]), operations_hash):
                raise ValueError("op_id has already been used for a different operation batch")
            return {"revision": int(duplicate["revision"]), "conflicts": json.loads(duplicate["conflicts_json"] or "[]"), "updated_at": str(duplicate["updated_at"]), "duplicate": True}

        state, row = load_collaboration_state(conn, process_id)
        current_revision = int(row["revision"])
        if base_revision > current_revision:
            raise ValueError("base_revision exceeds current process revision")
        conflicts = operation_conflict_paths(conn, process_id, base_revision, path_keys)
        apply_collaboration_batch(state, operations, conflicts)
        next_revision = current_revision + 1
        stamp = persist_collaboration_state(conn, process_id, state, next_revision, now_iso_fn)
        for path_key in path_keys:
            conn.execute("INSERT INTO process_path_versions (process_id, path_key, revision) VALUES (?, ?, ?) ON CONFLICT(process_id, path_key) DO UPDATE SET revision=excluded.revision", (process_id, path_key, next_revision))
        conn.execute("INSERT INTO process_events (process_id, revision, user_id, username, operations_json, conflicts_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (process_id, next_revision, user_id, username, json.dumps(operations, ensure_ascii=False), json.dumps(conflicts, ensure_ascii=False), stamp))
        conn.execute("INSERT INTO process_op_receipts (process_id, op_id, revision, conflicts_json, operations_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)", (process_id, op_id, next_revision, json.dumps(conflicts, ensure_ascii=False), operations_hash, stamp))
        return {"revision": next_revision, "conflicts": conflicts, "updated_at": stamp, "duplicate": False, "snapshot": {**state, "revision": next_revision}}



