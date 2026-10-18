"""Optional end-to-end smoke test for the FlowCost WebSocket collaboration API.

Requires the app's backend environment plus `httpx` and `websockets` packages.
Run the script with the backend dependencies installed; it starts a temporary
Uvicorn process on 127.0.0.1:8877 and removes its temporary SQLite files.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from datetime import datetime, timezone

import httpx
import websockets

BACKEND = Path(__file__).resolve().parents[1] / "backend"
BASE_URL = "http://127.0.0.1:8877"
WS_URL = "ws://127.0.0.1:8877"
ORIGIN = "http://localhost:5173"


async def main() -> None:
    db_path = tempfile.mktemp(prefix="flowcost-ws-smoke-", suffix=".sqlite3")
    env = os.environ.copy()
    env["FLOWCOST_DB_PATH"] = db_path
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8877"],
        cwd=BACKEND,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        async with httpx.AsyncClient() as client:
            for _ in range(100):
                try:
                    response = await client.get(f"{BASE_URL}/api/health", timeout=0.5)
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.1)
            else:
                raise RuntimeError("FlowCost backend did not start")

            # CORS must wrap the auth middleware so expired/missing tokens return
            # a readable 401 response, not a browser-level CORS error.
            stale_session = await client.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Origin": ORIGIN},
            )
            assert stale_session.status_code == 401, stale_session.text
            assert stale_session.headers.get("access-control-allow-origin") == ORIGIN, stale_session.headers
            preflight = await client.options(
                f"{BASE_URL}/api/auth/me",
                headers={
                    "Origin": ORIGIN,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            assert preflight.status_code == 200, preflight.text
            assert preflight.headers.get("access-control-allow-origin") == ORIGIN, preflight.headers

            # Seed verified/approved accounts directly into this throwaway SQLite DB.
            # The collaboration smoke test is about cross-account shared editing;
            # email verification and admin approval are covered by backend/tests/test_auth.py.
            def seed_approved_user(username: str, email: str, password: str) -> None:
                stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                salt = secrets.token_hex(16)
                digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
                with sqlite3.connect(db_path) as database:
                    database.execute(
                        """INSERT INTO users (id, username, email, password_hash, password_salt, created_at,
                           email_verified_at, approval_status, approved_by, approved_at, is_admin)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NULL, ?, 0)""",
                        (f"smoke-{username}", username, email, digest, salt, stamp, stamp, stamp),
                    )

            owner_username, owner_email, owner_password = "sync-smoke-user", "sync-smoke-user@example.test", "Temporary-smoke-pass-42"
            peer_username, peer_email, peer_password = "sync-smoke-peer", "sync-smoke-peer@example.test", "Temporary-peer-pass-42"
            seed_approved_user(owner_username, owner_email, owner_password)
            seed_approved_user(peer_username, peer_email, peer_password)
            register = await client.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": owner_username, "password": owner_password},
            )
            assert register.status_code == 200, register.text
            token = register.json()["token"]
            headers = {"Authorization": f"Bearer {token}"}
            initial_owner_processes = await client.get(f"{BASE_URL}/api/processes", headers=headers)
            assert initial_owner_processes.status_code == 200, initial_owner_processes.text
            assert initial_owner_processes.json() == [], initial_owner_processes.text
            peer_register = await client.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": peer_username, "password": peer_password},
            )
            assert peer_register.status_code == 200, peer_register.text
            peer_token = peer_register.json()["token"]
            peer_headers = {"Authorization": f"Bearer {peer_token}"}
            public_created = await client.post(
                f"{BASE_URL}/api/processes",
                headers=headers,
                json={
                    "name": "Public visibility smoke test", "visibility": "public",
                    "nodes": [], "edges": [], "settings": {},
                },
            )
            assert public_created.status_code == 200, public_created.text
            public_id = public_created.json()["id"]
            assert public_created.json().get("visibility") == "public", public_created.json()
            peer_public_list = await client.get(f"{BASE_URL}/api/processes", headers=peer_headers)
            assert peer_public_list.status_code == 200 and any(item["id"] == public_id for item in peer_public_list.json()), peer_public_list.text
            public_open = await client.get(f"{BASE_URL}/api/processes/{public_id}", headers=peer_headers)
            assert public_open.status_code == 200 and public_open.json().get("can_edit") is False, public_open.text
            public_write = await client.put(f"{BASE_URL}/api/processes/{public_id}", headers=peer_headers, json={"name": "Should not edit"})
            assert public_write.status_code == 403, public_write.text
            public_delete = await client.delete(f"{BASE_URL}/api/processes/{public_id}", headers=peer_headers)
            assert public_delete.status_code == 403, public_delete.text
            owner_delete = await client.delete(f"{BASE_URL}/api/processes/{public_id}", headers=headers)
            assert owner_delete.status_code == 200, owner_delete.text

            created = await client.post(
                f"{BASE_URL}/api/processes",
                headers=headers,
                json={
                    "name": "WebSocket smoke test",
                    "description": "",
                    "folder": "",
                    "nodes": [{"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "data": {"name": "Start"}}],
                    "edges": [],
                    "settings": {},
                },
            )
            assert created.status_code == 200, created.text
            assert created.json().get("visibility") == "private", created.json()
            process_id = created.json()["id"]
            revision = created.json()["revision"]
            peer_initial_processes = await client.get(f"{BASE_URL}/api/processes", headers=peer_headers)
            assert peer_initial_processes.status_code == 200 and not any(item["id"] == process_id for item in peer_initial_processes.json()), peer_initial_processes.text
            await client.post(
                f"{BASE_URL}/api/presence/heartbeat", headers=headers,
                json={"client_id": "smoke-owner-tab", "process_id": process_id, "route": f"/processes/{process_id}"},
            )
            private_online = await client.get(f"{BASE_URL}/api/presence/online", headers=peer_headers)
            assert private_online.status_code == 200, private_online.text
            private_owner = next((item for item in private_online.json()["users"] if item["id"] == register.json()["user"]["id"]), None)
            private_process = next((item for item in (private_owner or {}).get("processes", []) if item["id"] == process_id), None)
            assert private_process and not private_process["can_open"] and private_process["name"] == "Закрытый процесс", private_online.text

            # Cross-account collaboration starts by requesting access. Owners can approve
            # the request from the Online teammates screen, then both users share one process id.
            access_request = await client.post(
                f"{BASE_URL}/api/processes/{process_id}/access-request",
                headers=peer_headers,
                json={},
            )
            assert access_request.status_code == 200 and access_request.json()["status"] == "pending", access_request.text
            incoming = await client.get(f"{BASE_URL}/api/access-requests/incoming", headers=headers)
            assert incoming.status_code == 200 and any(item["requester_username"] == "sync-smoke-peer" for item in incoming.json()), incoming.text
            decision = await client.post(
                f"{BASE_URL}/api/processes/{process_id}/access-requests/{peer_register.json()['user']['id']}/decision",
                headers=headers,
                json={"decision": "approve", "permission": "edit"},
            )
            assert decision.status_code == 200 and decision.json()["status"] == "approved", decision.text

            # Heartbeats allow the account directory to show online users and their current process.
            owner_presence = await client.post(
                f"{BASE_URL}/api/presence/heartbeat", headers=headers,
                json={"client_id": "smoke-owner-tab", "process_id": process_id, "route": f"/processes/{process_id}"},
            )
            peer_presence = await client.post(
                f"{BASE_URL}/api/presence/heartbeat", headers=peer_headers,
                json={"client_id": "smoke-peer-tab", "process_id": process_id, "route": f"/processes/{process_id}"},
            )
            assert owner_presence.status_code == 200 and peer_presence.status_code == 200
            online = await client.get(f"{BASE_URL}/api/presence/online", headers=peer_headers)
            assert online.status_code == 200, online.text
            owner_online = next((item for item in online.json()["users"] if item["id"] == register.json()["user"]["id"]), None)
            assert owner_online and any(proc["id"] == process_id and proc["can_open"] for proc in owner_online["processes"]), online.text
            peer_processes = await client.get(f"{BASE_URL}/api/processes", headers=peer_headers)
            assert peer_processes.status_code == 200 and any(item["id"] == process_id for item in peer_processes.json()), peer_processes.text
            url = f"{WS_URL}/api/ws/process/{process_id}"

            # An unauthorized origin must not enter the collaboration room.
            try:
                async with websockets.connect(url, origin="https://untrusted.invalid"):
                    raise AssertionError("Untrusted Origin was accepted")
            except websockets.exceptions.InvalidStatus:
                pass

            async with websockets.connect(url, origin=ORIGIN) as editor_a:
                await editor_a.send(json.dumps({"type": "auth", "token": token}))
                a_joined = json.loads(await asyncio.wait_for(editor_a.recv(), 3))
                a_snapshot = json.loads(await asyncio.wait_for(editor_a.recv(), 3))
                assert a_joined["type"] == "joined", a_joined
                assert a_snapshot["type"] == "snapshot", a_snapshot

                async with websockets.connect(url, origin=ORIGIN) as editor_b:
                    await editor_b.send(json.dumps({"type": "auth", "token": peer_token}))
                    b_joined = json.loads(await asyncio.wait_for(editor_b.recv(), 3))
                    b_snapshot = json.loads(await asyncio.wait_for(editor_b.recv(), 3))
                    assert b_joined["type"] == "joined", b_joined
                    assert b_snapshot["type"] == "snapshot", b_snapshot
                    presence = json.loads(await asyncio.wait_for(editor_a.recv(), 3))
                    assert presence["type"] == "presence", presence

                    # Cursor messages must cross between two separate user accounts.
                    await editor_a.send(json.dumps({"type": "cursor", "coordinate_space": "flow", "client_id": "editor-a-cursor", "x": 740.5, "y": -185.25, "color": "#86d6ff"}))
                    cursor = json.loads(await asyncio.wait_for(editor_b.recv(), 3))
                    assert cursor["type"] == "cursor" and cursor["client_id"] == "editor-a-cursor", cursor
                    assert cursor["coordinate_space"] == "flow", cursor
                    assert abs(cursor["x"] - 740.5) < 0.001 and abs(cursor["y"] + 185.25) < 0.001, cursor

                    # Moving a node must be persisted and peers receive the canonical saved snapshot.
                    move_op = {
                        "type": "ops", "op_id": "smoke-live-move-1", "base_revision": revision,
                        "operations": [{"type": "set", "entity": "node", "entity_id": "start", "path": ["position", "x"], "value": 240}],
                    }
                    await editor_a.send(json.dumps(move_op))
                    move_ack = json.loads(await asyncio.wait_for(editor_a.recv(), 3))
                    move_broadcast = json.loads(await asyncio.wait_for(editor_b.recv(), 3))
                    assert move_ack["type"] == "ack" and move_ack["snapshot"]["nodes"][0]["position"]["x"] == 240, move_ack
                    assert move_broadcast["type"] == "ops", move_broadcast
                    assert move_broadcast["snapshot"]["nodes"][0]["position"]["x"] == 240, move_broadcast

                    # Deletion must also be represented by the server's canonical graph on the peer.
                    delete_op = {
                        "type": "ops", "op_id": "smoke-live-delete-1", "base_revision": move_ack["revision"],
                        "operations": [{"type": "node.remove", "node_id": "start"}],
                    }
                    await editor_a.send(json.dumps(delete_op))
                    delete_ack = json.loads(await asyncio.wait_for(editor_a.recv(), 3))
                    delete_broadcast = json.loads(await asyncio.wait_for(editor_b.recv(), 3))
                    assert delete_ack["type"] == "ack" and delete_ack["snapshot"]["nodes"] == [], delete_ack
                    assert delete_broadcast["type"] == "ops" and delete_broadcast["snapshot"]["nodes"] == [], delete_broadcast

                    # Re-sending an accepted op_id should return a receipt, not apply it twice.
                    await editor_a.send(json.dumps(delete_op))
                    duplicate_ack = json.loads(await asyncio.wait_for(editor_a.recv(), 3))
                    assert duplicate_ack["type"] == "ack" and duplicate_ack["duplicate"], duplicate_ack

                    persisted = await client.get(f"{BASE_URL}/api/processes/{process_id}", headers=headers)
                    assert persisted.status_code == 200, persisted.text
                    assert persisted.json()["nodes"] == []
                    history = await client.get(f"{BASE_URL}/api/processes/{process_id}/history", headers=peer_headers)
                    assert history.status_code == 200 and len(history.json()) >= 2, history.text
                    assert any(any(op.get("type") == "node.remove" for op in item["operations"]) for item in history.json())

                    # Deleting the whole process must notify tabs already editing it.
                    delete_process_response = await client.delete(f"{BASE_URL}/api/processes/{process_id}", headers=headers)
                    assert delete_process_response.status_code == 200, delete_process_response.text
                    deleted_notice = json.loads(await asyncio.wait_for(editor_b.recv(), 3))
                    assert deleted_notice["type"] == "process_deleted" and deleted_notice["process_id"] == process_id, deleted_notice
                    print("PASS: auth/CORS, empty starter library, private/public visibility, public read-only permissions, separate shared accounts, flow-space cursor relay, canonical move + node/process deletion, event log, ACK, idempotent retry, SQLite persistence")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(db_path + suffix)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    asyncio.run(main())
