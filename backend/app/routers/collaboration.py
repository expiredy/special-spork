from __future__ import annotations

import asyncio
import json
import math
import sqlite3
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

def create_collaboration_router(context: dict[str, Any]):
    ALLOWED_ORIGINS = context["ALLOWED_ORIGINS"]
    db_conn = context["db_conn"]
    now_iso = context["now_iso"]
    user_for_token = context["user_for_token"]
    ensure_process_access = context["ensure_process_access"]
    process_rooms = context["process_rooms"]
    load_collaboration_snapshot = context["load_collaboration_snapshot"]
    collaboration_path_key = context["collaboration_path_key"]
    commit_collaboration_operation_batch = context["commit_collaboration_operation_batch"]
    logger = context["logger"]
    router = APIRouter()

    @router.post("/api/presence/heartbeat")
    def presence_heartbeat(payload: dict[str, Any], request: Request) -> dict[str, bool]:
        user = request.state.user
        client_id = str(payload.get("client_id") or "").strip()[:120]
        if not client_id:
            raise HTTPException(status_code=400, detail="client_id обязателен")
        stamp = now_iso()
        with db_conn() as conn:
            if payload.get("online") is False:
                conn.execute("DELETE FROM presence_sessions WHERE user_id = ? AND client_id = ?", (user["id"], client_id))
                return {"ok": True}
            process_id = str(payload.get("process_id") or "").strip() or None
            if process_id:
                try:
                    ensure_process_access(process_id, user["id"], False)
                except HTTPException:
                    process_id = None
            route = str(payload.get("route") or "/")[:300]
            conn.execute(
                """INSERT INTO presence_sessions (user_id, client_id, process_id, route, last_seen)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(user_id, client_id) DO UPDATE SET process_id=excluded.process_id, route=excluded.route, last_seen=excluded.last_seen""",
                (user["id"], client_id, process_id, route, stamp),
            )
            cutoff = (datetime.now(timezone.utc) - timedelta(seconds=45)).replace(microsecond=0).isoformat()
            conn.execute("DELETE FROM presence_sessions WHERE last_seen < ?", (cutoff,))
        return {"ok": True}


    @router.get("/api/presence/online")
    def presence_online(request: Request) -> dict[str, Any]:
        viewer_id = request.state.user["id"]
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=45)).replace(microsecond=0).isoformat()
        with db_conn() as conn:
            conn.execute("DELETE FROM presence_sessions WHERE last_seen < ?", (cutoff,))
            rows = conn.execute(
                """SELECT ps.user_id, ps.client_id, ps.process_id, ps.route, ps.last_seen, u.username
                   FROM presence_sessions ps JOIN users u ON u.id = ps.user_id
                   WHERE ps.last_seen >= ? ORDER BY u.username COLLATE NOCASE, ps.last_seen DESC""",
                (cutoff,),
            ).fetchall()
            grouped: dict[str, dict[str, Any]] = {}
            for row in rows:
                item = grouped.setdefault(row["user_id"], {
                    "id": row["user_id"], "username": row["username"], "last_seen": row["last_seen"],
                    "session_count": 0, "processes": [],
                })
                item["session_count"] += 1
                if str(row["last_seen"]) > str(item["last_seen"]):
                    item["last_seen"] = row["last_seen"]
                process_id = row["process_id"]
                if not process_id:
                    continue
                if any(proc["id"] == process_id for proc in item["processes"]):
                    continue
                process = conn.execute(
                    "SELECT p.id, p.name, p.owner_id, p.visibility, owner.username AS owner_username FROM processes p LEFT JOIN users owner ON owner.id = p.owner_id WHERE p.id = ?",
                    (process_id,),
                ).fetchone()
                if not process:
                    continue
                share = conn.execute("SELECT permission FROM process_shares WHERE process_id = ? AND user_id = ?", (process_id, viewer_id)).fetchone()
                can_open = process["visibility"] == "public" or process["owner_id"] == viewer_id or share is not None
                can_edit = bool(process["owner_id"] == viewer_id or (share and share["permission"] == "edit"))
                access_request = conn.execute("SELECT status FROM process_access_requests WHERE process_id = ? AND requester_id = ?", (process_id, viewer_id)).fetchone()
                process_item = {
                    "id": process_id,
                    "name": process["name"] if can_open else "Закрытый процесс",
                    "owner_username": process["owner_username"] or "FlowCost",
                    "can_open": bool(can_open),
                    "can_edit": bool(can_edit),
                    "can_request_access": bool(process["owner_id"] and process["owner_id"] != viewer_id and (not share or share["permission"] != "edit")),
                    "request_status": access_request["status"] if access_request else None,
                    "route": row["route"] if can_open else None,
                    "active": True,
                }
                item["processes"].append(process_item)
        users = sorted(grouped.values(), key=lambda value: (value["id"] != viewer_id, value["username"].casefold()))
        return {"users": users, "checked_at": now_iso()}


    @router.websocket("/api/ws/process/{process_id}")
    async def process_websocket(websocket: WebSocket, process_id: str) -> None:
        # Browser sessions authenticate through the first WebSocket frame so tokens never enter URL logs.
        origin = websocket.headers.get("origin", "")
        if not origin or origin not in ALLOWED_ORIGINS:
            await websocket.close(code=4403, reason="Origin not allowed")
            return
        await websocket.accept()
        registered = False
        user: dict[str, Any] | None = None
        session_token = ""
        connection_client_id = ""
        try:
            auth_raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            if len(auth_raw.encode("utf-8")) > 4096:
                await websocket.close(code=4401, reason="Authentication frame too large")
                return
            try:
                auth_message = json.loads(auth_raw)
            except json.JSONDecodeError:
                await websocket.close(code=4401, reason="Invalid authentication frame")
                return
            if not isinstance(auth_message, dict) or auth_message.get("type") != "auth":
                await websocket.close(code=4401, reason="Authentication required")
                return
            session_token = str(auth_message.get("token") or "")
            user = await asyncio.to_thread(user_for_token, session_token)
            if not user:
                await websocket.close(code=4401, reason="Authentication required")
                return
            try:
                access = await asyncio.to_thread(ensure_process_access, process_id, user["id"], False)
            except HTTPException:
                await websocket.close(code=4403, reason="No process access")
                return
            await process_rooms.connect(process_id, websocket)
            registered = True
            state, current_revision = await asyncio.to_thread(load_collaboration_snapshot, process_id)
            await websocket.send_json({"type": "joined", "user": user["username"], "count": await process_rooms.presence(process_id), "revision": current_revision, "can_edit": bool(access.get("can_edit", True))})
            await websocket.send_json({"type": "snapshot", **state, "revision": current_revision, "can_edit": bool(access.get("can_edit", True))})
            await process_rooms.broadcast(process_id, {"type": "presence", "count": await process_rooms.presence(process_id), "user": user["username"]}, sender=websocket)
            message_window_start = asyncio.get_running_loop().time()
            message_count = 0
            while True:
                try:
                    raw_message = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Long-lived sockets must not outlive a revoked/expired browser session.
                    if not await asyncio.to_thread(user_for_token, session_token):
                        await websocket.close(code=4401, reason="Session expired")
                        return
                    continue
                if len(raw_message.encode("utf-8")) > 65536:
                    await websocket.send_json({"type": "error", "message": "Message exceeds the 64 KB limit"})
                    continue
                try:
                    message = json.loads(raw_message)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON message"})
                    continue
                if not isinstance(message, dict):
                    await websocket.send_json({"type": "error", "message": "Invalid message format"})
                    continue
                # Keep the protocol bounded to protect this small internal service from accidental floods.
                if len(json.dumps(message, ensure_ascii=False).encode("utf-8")) > 65536:
                    await websocket.send_json({"type": "error", "message": "Message exceeds the 64 KB limit"})
                    continue
                now = asyncio.get_running_loop().time()
                if now - message_window_start >= 1.0:
                    message_window_start, message_count = now, 0
                message_count += 1
                if message_count > 80:
                    await websocket.send_json({"type": "error", "message": "Rate limit exceeded"})
                    await asyncio.sleep(0.1)
                    continue

                event_type = message.get("type")
                if event_type == "cursor":
                    try:
                        x = float(message.get("x", 0))
                        y = float(message.get("y", 0))
                    except (TypeError, ValueError):
                        continue
                    coordinate_space = "flow" if message.get("coordinate_space") == "flow" else "normalized"
                    if not (math.isfinite(x) and math.isfinite(y)):
                        continue
                    if coordinate_space == "flow":
                        # React Flow world coordinates can be negative and exceed 1;
                        # bound them only to prevent malformed/absurd payloads.
                        x = min(5_000_000.0, max(-5_000_000.0, x))
                        y = min(5_000_000.0, max(-5_000_000.0, y))
                    else:
                        x = min(1.0, max(0.0, x))
                        y = min(1.0, max(0.0, y))
                    client_id = str(message.get("client_id") or "")[:100]
                    if client_id:
                        connection_client_id = client_id
                    await process_rooms.broadcast(process_id, {"type": "cursor", "x": x, "y": y, "coordinate_space": coordinate_space, "color": str(message.get("color") or "#86d6ff")[:20], "user": user["username"], "client_id": client_id}, sender=websocket)
                    continue

                if event_type != "ops":
                    continue
                try:
                    await asyncio.to_thread(ensure_process_access, process_id, user["id"], True)
                except HTTPException:
                    await websocket.send_json({"type": "error", "message": "Нет прав на редактирование этого процесса"})
                    await websocket.close(code=4403, reason="Read-only access")
                    return
                operations = message.get("operations")
                if not isinstance(operations, list) or not operations or len(operations) > 200:
                    await websocket.send_json({"type": "error", "message": "В пакете должно быть от 1 до 200 операций"})
                    continue
                base_revision = message.get("base_revision", 1)
                try:
                    base_revision = max(1, int(base_revision))
                    path_keys = [collaboration_path_key(op) for op in operations if isinstance(op, dict)]
                    if len(path_keys) != len(operations):
                        raise ValueError("Each operation must be an object")
                    allowed = {"node.add", "node.remove", "edge.add", "edge.remove", "set", "list.add", "list.remove"}
                    if any(str(op.get("type")) not in allowed for op in operations):
                        raise ValueError("Unsupported operation type")
                except (TypeError, ValueError) as exc:
                    await websocket.send_json({"type": "error", "message": f"Некорректная операция: {exc}"})
                    continue

                try:
                    op_id = str(message.get("op_id") or "").strip()[:120]
                    if not op_id:
                        raise ValueError("op_id is required for reliable acknowledgements")
                    result = await asyncio.to_thread(commit_collaboration_operation_batch, process_id, op_id, base_revision, path_keys, operations, user["id"], user["username"])
                    canonical_snapshot = result.get("snapshot")
                    envelope = {"type": "ops", "operations": operations, "revision": result["revision"], "user": user["username"], "op_id": op_id, "created_at": result["updated_at"], "snapshot": canonical_snapshot}
                    await websocket.send_json({"type": "ack", "op_id": op_id, "revision": result["revision"], "conflicts": result["conflicts"], "updated_at": result["updated_at"], "duplicate": result["duplicate"], "snapshot": canonical_snapshot, "operations": operations, "user": user["username"]})
                    if not result["duplicate"]:
                        await process_rooms.broadcast(process_id, envelope, sender=websocket)
                except (ValueError, KeyError, TypeError) as exc:
                    await websocket.send_json({"type": "error", "message": f"Операция не применена: {exc}"})
                except sqlite3.Error:
                    await websocket.send_json({"type": "error", "message": "Не удалось сохранить изменения. Повторите после синхронизации."})
        except asyncio.TimeoutError:
            try:
                await websocket.close(code=4401, reason="Authentication timeout")
            except Exception:
                pass
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("Unexpected WebSocket error for process %s", process_id)
            # Surface a useful status to the browser rather than leaving the sync badge
            # indefinitely in its orange "syncing" state after an unclean close.
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": "Внутренняя ошибка синхронизации. Подробности записаны в лог backend.",
                })
                await websocket.close(code=1011, reason="Internal collaboration error")
            except Exception:
                pass
        finally:
            if registered:
                await process_rooms.disconnect(process_id, websocket)
                await process_rooms.broadcast(process_id, {"type": "presence", "count": await process_rooms.presence(process_id), "user": user["username"] if user else "", "client_id": connection_client_id, "left": True}, sender=websocket)


    return router, router
