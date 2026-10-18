from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .services.costing import safe_float, calculate_graph, apply_financial_goal_allocations
from .services.collaboration import (
    collaboration_path_key, apply_collaboration_operation, apply_collaboration_batch,
)  # Re-exported for compatibility with tests and internal scripts.
from .services.export import build_xlsx, make_export_sheets
from .services.rooms import ProcessRoomManager
from .services.collaboration_store import (
    load_collaboration_snapshot as _load_collaboration_snapshot,
    commit_collaboration_operation_batch as _commit_collaboration_operation_batch,
)

APP_DIR = Path(__file__).resolve().parent
# Local secrets/configuration live in backend/.env; real process environment wins.
load_dotenv(APP_DIR.parent / ".env", override=False)
DEFAULT_DB = APP_DIR.parent / "data" / "flowcost.sqlite3"
DB_PATH = Path(os.getenv("FLOWCOST_DB_PATH", str(DEFAULT_DB)))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("flowcost.collaboration")

app = FastAPI(
    title="FlowCost Process Planner API",
    version="0.5.4",
    description="Visual process planning, task costing, reusable workflows, and collaboration.",
)
# Use exact browser origins (scheme + host + port). The trailing slash is not
# part of the Origin header, so normalize it to avoid a subtle config mismatch.
ALLOWED_ORIGINS = list(dict.fromkeys(
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "FLOWCOST_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"


@contextmanager
def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db_conn() as conn:
        # WAL improves local read/write concurrency. SQLite must remain on this host;
        # use PostgreSQL before moving the database to a network filesystem or multi-host deployment.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS processes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                graph_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                folder TEXT NOT NULL DEFAULT '',
                owner_id TEXT,
                visibility TEXT NOT NULL DEFAULT 'private',
                revision INTEGER NOT NULL DEFAULT 1
            )"""
        )
        process_columns = {row["name"] for row in conn.execute("PRAGMA table_info(processes)").fetchall()}
        if "folder" not in process_columns:
            conn.execute("ALTER TABLE processes ADD COLUMN folder TEXT NOT NULL DEFAULT ''")
        if "owner_id" not in process_columns:
            conn.execute("ALTER TABLE processes ADD COLUMN owner_id TEXT")
        if "visibility" not in process_columns:
            conn.execute("ALTER TABLE processes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'")
        # Preserve the old read-only behavior for legacy rows without an owner. The
        # specific starter process and its untouched generated copies are removed below.
        conn.execute("UPDATE processes SET visibility = 'public' WHERE owner_id IS NULL")
        if "revision" not in process_columns:
            conn.execute("ALTER TABLE processes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")

        conn.execute(
            """CREATE TABLE IF NOT EXISTS team_members (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT '',
                hourly_rate REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'RUB',
                active INTEGER NOT NULL DEFAULT 1,
                is_demo INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS tools (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                monthly_price REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'RUB',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS role_grades (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                grade TEXT NOT NULL,
                hourly_rate REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'RUB',
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(role, grade)
            )"""
        )
        role_grade_columns = {row["name"] for row in conn.execute("PRAGMA table_info(role_grades)").fetchall()}
        if "is_default" not in role_grade_columns:
            conn.execute("ALTER TABLE role_grades ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0")
        # Keep exactly one default grade for each role, including databases migrated from older versions.
        role_rows = conn.execute("SELECT role FROM role_grades GROUP BY role COLLATE NOCASE").fetchall()
        for role_row in role_rows:
            role_name = str(role_row["role"])
            grade_rows = conn.execute("SELECT id, is_default FROM role_grades WHERE role = ? COLLATE NOCASE ORDER BY created_at, id", (role_name,)).fetchall()
            defaults = [grade for grade in grade_rows if bool(grade["is_default"])]
            chosen = defaults[0] if defaults else (grade_rows[0] if grade_rows else None)
            if chosen:
                conn.execute("UPDATE role_grades SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE role = ? COLLATE NOCASE", (chosen["id"], role_name))
        conn.execute(
            """CREATE TABLE IF NOT EXISTS financial_goals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                target_monthly_amount REAL NOT NULL DEFAULT 0,
                opening_balance REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'RUB',
                active INTEGER NOT NULL DEFAULT 1,
                is_demo INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS process_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                user_id TEXT,
                username TEXT NOT NULL DEFAULT '',
                operations_json TEXT NOT NULL,
                conflicts_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS process_op_receipts (
                process_id TEXT NOT NULL,
                op_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                conflicts_json TEXT NOT NULL DEFAULT '[]',
                operations_hash TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY(process_id, op_id),
                FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE
            )"""
        )
        receipt_columns = {row["name"] for row in conn.execute("PRAGMA table_info(process_op_receipts)").fetchall()}
        if "operations_hash" not in receipt_columns:
            conn.execute("ALTER TABLE process_op_receipts ADD COLUMN operations_hash TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS process_path_versions (
                process_id TEXT NOT NULL,
                path_key TEXT NOT NULL,
                revision INTEGER NOT NULL,
                PRIMARY KEY(process_id, path_key),
                FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                email TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at TEXT NOT NULL,
                email_verified_at TEXT,
                approval_status TEXT NOT NULL DEFAULT 'pending',
                approved_by TEXT,
                approved_at TEXT,
                is_admin INTEGER NOT NULL DEFAULT 0
            )"""
        )
        # Additive migration for existing local databases. Existing accounts must
        # verify an email and be approved before their old sessions work again.
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "email_verified_at" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT")
        if "approval_status" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'")
        if "approved_by" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN approved_by TEXT")
        if "approved_at" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN approved_at TEXT")
        if "is_admin" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS email_verification_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                used_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id)")
        try:
            # Enforce unique email addresses for new registrations. Legacy duplicate
            # addresses are logged rather than making the whole application fail to boot.
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE) WHERE trim(email) <> ''")
        except sqlite3.IntegrityError:
            logger.warning("Duplicate legacy email addresses detected; email uniqueness will be enforced by registration checks until records are cleaned up")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS process_shares (
                process_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                permission TEXT NOT NULL DEFAULT 'edit',
                created_at TEXT NOT NULL,
                PRIMARY KEY(process_id, user_id),
                FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS process_access_requests (
                process_id TEXT NOT NULL,
                requester_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                requested_permission TEXT NOT NULL DEFAULT 'edit',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(process_id, requester_id),
                FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE,
                FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS presence_sessions (
                user_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                process_id TEXT,
                route TEXT NOT NULL DEFAULT '/',
                last_seen TEXT NOT NULL,
                PRIMARY KEY(user_id, client_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE SET NULL
            )"""
        )

        member_count = conn.execute("SELECT COUNT(*) AS n FROM team_members").fetchone()["n"]
        if member_count == 0:
            stamp = now_iso()
            demo_team = [
                ("demo-pm", "Аккаунт / PM (демо)", "Проджект-менеджер", 1500.0, "RUB", 1, 1, stamp, stamp),
                ("demo-design", "Дизайнер (демо)", "Дизайнер", 1800.0, "RUB", 1, 1, stamp, stamp),
                ("demo-dev", "Разработчик (демо)", "Разработчик", 2200.0, "RUB", 1, 1, stamp, stamp),
            ]
            conn.executemany("INSERT INTO team_members VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", demo_team)
        role_grade_count = conn.execute("SELECT COUNT(*) AS n FROM role_grades").fetchone()["n"]
        if role_grade_count == 0:
            stamp = now_iso()
            demo_grades = [
                ("grade-demo-pm", "Проджект-менеджер", "Middle", 1500.0, "RUB", 1, stamp, stamp),
                ("grade-demo-design", "Дизайнер", "Middle", 1800.0, "RUB", 1, stamp, stamp),
                ("grade-demo-dev", "Разработчик", "Middle", 2200.0, "RUB", 1, stamp, stamp),
            ]
            conn.executemany("INSERT INTO role_grades (id, role, grade, hourly_rate, currency, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", demo_grades)
        goal_count = conn.execute("SELECT COUNT(*) AS n FROM financial_goals").fetchone()["n"]
        if goal_count == 0:
            stamp = now_iso()
            conn.execute(
                "INSERT INTO financial_goals (id, name, description, target_monthly_amount, opening_balance, currency, active, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("goal-demo-c-level", "Фонд зарплат C-level", "Демонстрационная финансовая цель: ежемесячный фонд покрытия зарплат C-level должностей.", 500000.0, 0.0, "RUB", 1, 1, stamp, stamp),
            )
        # Remove the legacy starter scenario. Also remove only per-user copies that
        # are byte-for-byte unchanged and still carry the generated starter name;
        # a modified/renamed user process is intentionally preserved.
        starter = conn.execute("SELECT graph_json FROM processes WHERE id = 'demo-landing'").fetchone()
        if starter:
            unchanged_copies = conn.execute(
                "SELECT id FROM processes WHERE owner_id IS NOT NULL AND name LIKE 'Моя копия: Пример: производство лендинга%' AND graph_json = ?",
                (starter["graph_json"],),
            ).fetchall()
            for copy_row in unchanged_copies:
                conn.execute("DELETE FROM processes WHERE id = ?", (copy_row["id"],))
            conn.execute("DELETE FROM processes WHERE id = 'demo-landing'")


init_db()


SESSION_DAYS = 30
EMAIL_VERIFICATION_HOURS = 24


def password_digest(password: str, salt: str) -> str:
    return hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()


def provision_env_admin() -> None:
    """Create/update the configured administrator without embedding credentials in code."""
    username = os.getenv("FLOWCOST_ADMIN_USERNAME", "").strip()
    email = os.getenv("FLOWCOST_ADMIN_EMAIL", "").strip()
    password = os.getenv("FLOWCOST_ADMIN_PASSWORD", "")
    configured = [bool(username), bool(email), bool(password)]
    if not any(configured):
        # Treat the environment as the authority for administrator privileges.
        # If the admin configuration is removed, persisted accounts must not retain
        # an admin role silently.
        with db_conn() as conn:
            conn.execute("UPDATE users SET is_admin = 0 WHERE is_admin <> 0")
        logger.warning("Admin bootstrap is disabled and stored admin privileges have been removed; configure FLOWCOST_ADMIN_USERNAME, FLOWCOST_ADMIN_EMAIL and FLOWCOST_ADMIN_PASSWORD in backend/.env")
        return
    if not all(configured):
        raise RuntimeError("Admin setup is incomplete: set FLOWCOST_ADMIN_USERNAME, FLOWCOST_ADMIN_EMAIL and FLOWCOST_ADMIN_PASSWORD together in backend/.env")
    if len(username) < 3 or len(username) > 40 or not all(ch.isalnum() or ch in "._-" for ch in username):
        raise RuntimeError("FLOWCOST_ADMIN_USERNAME must be 3-40 characters using letters, digits, dot, hyphen or underscore")
    if len(password) < 12:
        raise RuntimeError("FLOWCOST_ADMIN_PASSWORD must be at least 12 characters long")
    if "CHANGE_ME" in password.upper() or "REPLACE_ME" in password.upper():
        raise RuntimeError("Replace the placeholder FLOWCOST_ADMIN_PASSWORD with a unique secret before starting FlowCost")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise RuntimeError("FLOWCOST_ADMIN_EMAIL must be a valid email address")
    salt = os.urandom(16).hex()
    digest = password_digest(password, salt)
    stamp = now_iso()
    with db_conn() as conn:
        username_row = conn.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
        email_row = conn.execute("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND email <> ''", (email,)).fetchone()
        if email_row and (not username_row or email_row["id"] != username_row["id"]):
            raise RuntimeError("FLOWCOST_ADMIN_EMAIL is already associated with another account; resolve the email conflict before bootstrapping admin")
        if username_row:
            password_changed = not hmac.compare_digest(password_digest(password, username_row["password_salt"]), username_row["password_hash"])
            stable_salt = salt if password_changed else username_row["password_salt"]
            stable_digest = digest if password_changed else username_row["password_hash"]
            conn.execute(
                """UPDATE users SET email = ?, password_hash = ?, password_salt = ?, email_verified_at = COALESCE(email_verified_at, ?),
                   approval_status = 'approved', approved_at = COALESCE(approved_at, ?), is_admin = 1 WHERE id = ?""",
                (email, stable_digest, stable_salt, stamp, stamp, username_row["id"]),
            )
            if password_changed:
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (username_row["id"],))
        else:
            conn.execute(
                """INSERT INTO users (id, username, email, password_hash, password_salt, created_at, email_verified_at, approval_status, approved_by, approved_at, is_admin)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NULL, ?, 1)""",
                (new_id("user-"), username, email, digest, salt, stamp, stamp, stamp),
            )
    logger.info("Environment-configured FlowCost administrator provisioned: %s", username)


provision_env_admin()


def user_for_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    with db_conn() as conn:
        row = conn.execute(
            """SELECT users.id, users.username, users.email, users.is_admin, users.email_verified_at,
                      users.approval_status, sessions.expires_at
               FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?""",
            (token,),
        ).fetchone()
    if not row:
        return None
    if row["expires_at"] < now_iso() or not row["email_verified_at"] or row["approval_status"] != "approved":
        with db_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return None
    return {"id": row["id"], "username": row["username"], "email": row["email"], "is_admin": bool(row["is_admin"])}


@app.middleware("http")
async def authenticate_api_requests(request: Request, call_next):
    path = request.url.path
    public_paths = {"/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/verify-email", "/api/auth/resend-verification"}
    if path.startswith("/api/") and path not in public_paths and request.method != "OPTIONS":
        header = request.headers.get("authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        user = user_for_token(token)
        if not user:
            return JSONResponse({"detail": "Сессия не найдена или истекла. Войдите в аккаунт снова."}, status_code=401)
        request.state.user = user
    return await call_next(request)


# Register CORS *after* the auth middleware so it becomes the outermost user
# middleware. That way CORS headers are also added to early responses generated
# by authenticate_api_requests (especially 401 for an expired/stale token).
# Without this order the browser hides the real JSON error behind a CORS error.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


process_rooms = ProcessRoomManager()


def ensure_process_access(process_id: str, user_id: str, write: bool = False) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Процесс не найден")
        owner_id = row["owner_id"]
        visibility = row["visibility"] if "visibility" in row.keys() else ("public" if owner_id is None else "private")
        if owner_id == user_id:
            result = process_from_row(row)
            result["can_edit"] = True
            return result
        share = conn.execute(
            "SELECT permission FROM process_shares WHERE process_id = ? AND user_id = ?",
            (process_id, user_id),
        ).fetchone()
        if share:
            if write and share["permission"] != "edit":
                raise HTTPException(status_code=403, detail="У вас есть доступ только для просмотра")
            result = process_from_row(row)
            result["can_edit"] = share["permission"] == "edit"
            return result
        if visibility == "public":
            if write:
                raise HTTPException(status_code=403, detail="Публичный процесс доступен всем для просмотра. Для редактирования попросите владельца выдать доступ.")
            result = process_from_row(row)
            result["can_edit"] = False
            return result
        raise HTTPException(status_code=403, detail="Нет доступа к этому процессу")


def owner_only(process_id: str, user_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Процесс не найден")
    if row["owner_id"] != user_id:
        raise HTTPException(status_code=403, detail="Управлять доступом может только владелец процесса")
    return process_from_row(row)


def process_from_row(row: sqlite3.Row) -> dict[str, Any]:
    graph = json.loads(row["graph_json"])
    keys = set(row.keys())
    return {
        "id": row["id"], "name": row["name"], "description": row["description"],
        "nodes": graph.get("nodes", []), "edges": graph.get("edges", []),
        "folder": row["folder"] if "folder" in keys else "",
        "settings": graph.get("settings", {}),
        "revision": row["revision"] if "revision" in keys else 1,
        "owner_id": row["owner_id"] if "owner_id" in keys else None,
        "visibility": row["visibility"] if "visibility" in keys else ("public" if row["owner_id"] is None else "private"),
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


def get_process_or_404(process_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Процесс не найден")
    return process_from_row(row)


def get_team() -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute("SELECT * FROM team_members ORDER BY active DESC, name COLLATE NOCASE").fetchall()
    # `hourly_rate` remains in SQLite only for backwards-compatible migration; rates now belong to role grades.
    return [
        {"id": r["id"], "name": r["name"], "role": r["role"],
         "active": bool(r["active"]), "is_demo": bool(r["is_demo"]),
         "created_at": r["created_at"], "updated_at": r["updated_at"]}
        for r in rows
    ]


def get_tools() -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute("SELECT * FROM tools ORDER BY active DESC, name COLLATE NOCASE").fetchall()
    return [{"id": row["id"], "name": row["name"], "description": row["description"], "monthly_price": row["monthly_price"], "currency": row["currency"], "active": bool(row["active"]), "created_at": row["created_at"], "updated_at": row["updated_at"]} for row in rows]


def get_role_grades() -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute("SELECT * FROM role_grades ORDER BY role COLLATE NOCASE, is_default DESC, created_at, grade COLLATE NOCASE").fetchall()
    return [{"id": row["id"], "role": row["role"], "grade": row["grade"], "hourly_rate": row["hourly_rate"], "currency": row["currency"], "is_default": bool(row["is_default"]), "created_at": row["created_at"], "updated_at": row["updated_at"]} for row in rows]


def get_financial_goals() -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute("SELECT * FROM financial_goals ORDER BY active DESC, name COLLATE NOCASE").fetchall()
        process_rows = conn.execute("SELECT id, graph_json FROM processes").fetchall()
    goals = [{"id": row["id"], "name": row["name"], "description": row["description"],
              "target_monthly_amount": row["target_monthly_amount"], "opening_balance": row["opening_balance"],
              "currency": row["currency"], "active": bool(row["active"]), "is_demo": bool(row["is_demo"]),
              "created_at": row["created_at"], "updated_at": row["updated_at"],
              "planned_contributions": 0.0, "planned_monthly_contributions": 0.0}
             for row in rows]
    team, tools, grades = get_team(), get_tools(), get_role_grades()
    by_goal = {goal["id"]: goal for goal in goals}
    for row in process_rows:
        try:
            stored = json.loads(row["graph_json"])
            summary = calculate_graph({"nodes": stored.get("nodes", []), "edges": stored.get("edges", [])}, team, tools=tools, role_grades=grades)
            allocation_summary = apply_financial_goal_allocations(summary, stored.get("settings", {}), goals)
            for contribution in allocation_summary["financial_goal_contributions"]:
                goal = by_goal[contribution["goal_id"]]
                goal["planned_contributions"] += contribution["contribution"]
                goal["planned_monthly_contributions"] += contribution["monthly_contribution"]
        except (ValueError, TypeError, KeyError):
            continue
    for goal in goals:
        goal["planned_contributions"] = round(goal["planned_contributions"], 2)
        goal["planned_monthly_contributions"] = round(goal["planned_monthly_contributions"], 2)
        goal["planned_coverage_percent"] = round(goal["planned_monthly_contributions"] / goal["target_monthly_amount"] * 100, 1) if goal["target_monthly_amount"] > 0 else 0
    return goals


def load_collaboration_snapshot(process_id: str) -> tuple[dict[str, Any], int]:
    return _load_collaboration_snapshot(process_id, db_conn)


def commit_collaboration_operation_batch(
    process_id: str,
    op_id: str,
    base_revision: int,
    path_keys: list[str],
    operations: list[dict[str, Any]],
    user_id: str,
    username: str,
) -> dict[str, Any]:
    return _commit_collaboration_operation_batch(
        process_id, op_id, base_revision, path_keys, operations, user_id, username,
        db_conn, now_iso,
    )


# API endpoint modules are built from explicit dependencies so they do not import main.py
# back into itself. The module remains the application composition root.
from .routers.auth import create_auth_router
from .routers.processes import create_process_router
from .routers.resources import create_resources_router
from .routers.collaboration import create_collaboration_router

_router_context = {
    "app": app, "db_conn": db_conn, "now_iso": now_iso, "new_id": new_id,
    "password_digest": password_digest, "SESSION_DAYS": SESSION_DAYS, "EMAIL_VERIFICATION_HOURS": EMAIL_VERIFICATION_HOURS,
    "process_from_row": process_from_row, "get_process_or_404": get_process_or_404,
    "get_team": get_team, "get_tools": get_tools, "get_role_grades": get_role_grades,
    "get_financial_goals": get_financial_goals, "ensure_process_access": ensure_process_access,
    "owner_only": owner_only, "process_rooms": process_rooms, "safe_float": safe_float,
    "calculate_graph": calculate_graph, "apply_financial_goal_allocations": apply_financial_goal_allocations,
    "build_xlsx": build_xlsx, "make_export_sheets": make_export_sheets,
    "user_for_token": user_for_token, "ALLOWED_ORIGINS": ALLOWED_ORIGINS,
    "load_collaboration_snapshot": load_collaboration_snapshot,
    "collaboration_path_key": collaboration_path_key,
    "commit_collaboration_operation_batch": commit_collaboration_operation_batch,
    "logger": logger,
}

_auth_router, _ = create_auth_router(_router_context)
_process_router, _process_handlers = create_process_router(_router_context)
_resources_router, _resource_handlers = create_resources_router(_router_context)
_collaboration_router, _ = create_collaboration_router(_router_context)
app.include_router(_auth_router)
app.include_router(_process_router)
app.include_router(_resources_router)
app.include_router(_collaboration_router)

# Backwards-compatible exports for the unit tests and lightweight internal scripts.
list_processes = _process_handlers["list_processes"]
list_team = _resource_handlers["list_team"]
list_tools = _resource_handlers["list_tools"]
list_role_grades = _resource_handlers["list_role_grades"]
