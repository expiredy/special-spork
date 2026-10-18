from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

def create_process_router(context: dict[str, Any]):
    app = context["app"]
    db_conn = context["db_conn"]
    now_iso = context["now_iso"]
    new_id = context["new_id"]
    process_from_row = context["process_from_row"]
    get_process_or_404 = context["get_process_or_404"]
    ensure_process_access = context["ensure_process_access"]
    owner_only = context["owner_only"]
    process_rooms = context["process_rooms"]
    get_team = context["get_team"]
    get_tools = context["get_tools"]
    get_role_grades = context["get_role_grades"]
    get_financial_goals = context["get_financial_goals"]
    calculate_graph = context["calculate_graph"]
    apply_financial_goal_allocations = context["apply_financial_goal_allocations"]
    build_xlsx = context["build_xlsx"]
    make_export_sheets = context["make_export_sheets"]
    router = APIRouter()

    @router.get("/api/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "app": "FlowCost", "version": app.version}


    @router.get("/api/processes")
    def list_processes(request: Request = None) -> list[dict[str, Any]]:
        with db_conn() as conn:
            if request is None:  # convenient for internal code and unit tests
                rows = conn.execute("SELECT * FROM processes ORDER BY updated_at DESC").fetchall()
            else:
                user_id = request.state.user["id"]
                rows = conn.execute(
                    """SELECT DISTINCT p.* FROM processes p
                       LEFT JOIN process_shares s ON s.process_id = p.id AND s.user_id = ?
                       WHERE p.visibility = 'public' OR p.owner_id = ? OR s.user_id = ?
                       ORDER BY CASE WHEN p.owner_id = ? THEN 0 WHEN s.user_id IS NOT NULL THEN 1 ELSE 2 END,
                                p.updated_at DESC""",
                    (user_id, user_id, user_id, user_id),
                ).fetchall()
        return [process_from_row(row) for row in rows]


    @router.post("/api/processes")
    def create_process(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        name = str(payload.get("name") or "Новый процесс").strip()[:200]
        description = str(payload.get("description") or "").strip()
        folder = str(payload.get("folder") or "").strip()[:100]
        visibility = "public" if str(payload.get("visibility") or "private").lower() == "public" else "private"
        graph = {"nodes": payload.get("nodes") or [], "edges": payload.get("edges") or [], "settings": payload.get("settings") or {}}
        stamp = now_iso()
        process_id = new_id("proc-")
        with db_conn() as conn:
            conn.execute(
                "INSERT INTO processes (id, name, description, graph_json, created_at, updated_at, folder, owner_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (process_id, name, description, json.dumps(graph, ensure_ascii=False), stamp, stamp, folder, request.state.user["id"], visibility),
            )
        return get_process_or_404(process_id)


    @router.get("/api/processes/{process_id}")
    def get_process(process_id: str, request: Request) -> dict[str, Any]:
        return ensure_process_access(process_id, request.state.user["id"], write=False)


    @router.put("/api/processes/{process_id}")
    async def update_process(process_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        existing = ensure_process_access(process_id, request.state.user["id"], write=True)
        name = str(payload.get("name", existing["name"]) or "Новый процесс").strip()[:200]
        description = str(payload.get("description", existing["description"]) or "").strip()
        folder = str(payload.get("folder", existing.get("folder", "")) or "").strip()[:100]
        graph = {"nodes": payload.get("nodes", existing["nodes"]) or [], "edges": payload.get("edges", existing["edges"]) or [], "settings": payload.get("settings", existing.get("settings", {})) or {}}
        expected_revision = payload.get("expected_revision")
        stamp = now_iso()
        with db_conn() as conn:
            current = conn.execute("SELECT revision FROM processes WHERE id = ?", (process_id,)).fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="Процесс не найден")
            if expected_revision is not None and int(expected_revision) != int(current["revision"]):
                raise HTTPException(status_code=409, detail="Процесс уже изменён другим участником. Обновите состояние, чтобы не перезаписать чужие изменения.")
            new_revision = int(current["revision"]) + 1
            conn.execute("UPDATE processes SET name = ?, description = ?, graph_json = ?, folder = ?, updated_at = ?, revision = ? WHERE id = ?", (name, description, json.dumps(graph, ensure_ascii=False), folder, stamp, new_revision, process_id))
            conn.execute("INSERT INTO process_path_versions (process_id, path_key, revision) VALUES (?, '*', ?) ON CONFLICT(process_id, path_key) DO UPDATE SET revision=excluded.revision", (process_id, new_revision))
            conn.execute("INSERT INTO process_events (process_id, revision, user_id, username, operations_json, conflicts_json, created_at) VALUES (?, ?, ?, ?, ?, '[]', ?)", (process_id, new_revision, request.state.user["id"], request.state.user["username"], '[{"type":"snapshot.replace"}]', stamp))
        updated = get_process_or_404(process_id)
        await process_rooms.broadcast(process_id, {"type": "snapshot", "process": updated, "saved_by": request.state.user["username"], "nodes": updated["nodes"], "edges": updated["edges"], "settings": updated["settings"], "name": updated["name"], "description": updated["description"], "folder": updated["folder"], "revision": updated["revision"]})
        return updated


    @router.delete("/api/processes/{process_id}")
    async def delete_process(process_id: str, request: Request) -> dict[str, bool]:
        owner_only(process_id, request.state.user["id"])
        with db_conn() as conn:
            conn.execute("DELETE FROM processes WHERE id = ?", (process_id,))
        # Notify editors that the canonical process no longer exists. Without this,
        # open tabs can remain on a stale graph and attempt to save into a deleted row.
        await process_rooms.broadcast(process_id, {
            "type": "process_deleted",
            "process_id": process_id,
            "deleted_by": request.state.user["username"],
        })
        return {"ok": True}


    @router.post("/api/processes/{process_id}/duplicate")
    def duplicate_process(process_id: str, payload: dict[str, Any] | None = None, request: Request = None) -> dict[str, Any]:
        process = ensure_process_access(process_id, request.state.user["id"], write=False)
        stamp = now_iso()
        process_id_new = new_id("proc-")
        body = payload or {}
        name = str(body.get("name") or f"{process['name']} — копия")[:200]
        with db_conn() as conn:
            conn.execute("INSERT INTO processes (id, name, description, graph_json, created_at, updated_at, folder, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (process_id_new, name, process["description"], json.dumps({"nodes": process["nodes"], "edges": process["edges"], "settings": process.get("settings", {})}, ensure_ascii=False), stamp, stamp, process.get("folder", ""), request.state.user["id"]))
        return get_process_or_404(process_id_new)


    @router.post("/api/import/json")
    def import_process(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        process_payload = payload.get("process", payload)
        nodes = process_payload.get("nodes") or []
        edges = process_payload.get("edges") or []
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise HTTPException(status_code=400, detail="nodes и edges должны быть списками")
        stamp = now_iso()
        process_id = new_id("proc-")
        graph = {"nodes": nodes, "edges": edges, "settings": process_payload.get("settings") or {}}
        with db_conn() as conn:
            conn.execute("INSERT INTO processes (id, name, description, graph_json, created_at, updated_at, folder, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (process_id, str(process_payload.get("name") or "Импортированный процесс")[:200], str(process_payload.get("description") or ""), json.dumps(graph, ensure_ascii=False), stamp, stamp, str(process_payload.get("folder") or "Импорт")[:100], request.state.user["id"]))
        return get_process_or_404(process_id)


    @router.get("/api/processes/{process_id}/share")
    def list_process_shares(process_id: str, request: Request) -> list[dict[str, Any]]:
        owner_only(process_id, request.state.user["id"])
        with db_conn() as conn:
            rows = conn.execute("SELECT u.id, u.username, u.email, s.permission, s.created_at FROM process_shares s JOIN users u ON u.id = s.user_id WHERE s.process_id = ? ORDER BY u.username COLLATE NOCASE", (process_id,)).fetchall()
        return [dict(row) for row in rows]


    @router.post("/api/processes/{process_id}/share")
    def share_process(process_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        owner_only(process_id, request.state.user["id"])
        username = str(payload.get("username") or "").strip()
        permission = "view" if payload.get("permission") == "view" else "edit"
        with db_conn() as conn:
            user = conn.execute("SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Пользователь с таким логином не найден. Попросите его сначала зарегистрироваться.")
            if user["id"] == request.state.user["id"]:
                raise HTTPException(status_code=400, detail="Нельзя добавлять себя в список участников процесса.")
            conn.execute("INSERT INTO process_shares (process_id, user_id, permission, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(process_id, user_id) DO UPDATE SET permission = excluded.permission", (process_id, user["id"], permission, now_iso()))
        return {"id": user["id"], "username": user["username"], "email": user["email"], "permission": permission}


    @router.delete("/api/processes/{process_id}/share/{user_id}")
    def unshare_process(process_id: str, user_id: str, request: Request) -> dict[str, bool]:
        owner_only(process_id, request.state.user["id"])
        with db_conn() as conn:
            conn.execute("DELETE FROM process_shares WHERE process_id = ? AND user_id = ?", (process_id, user_id))
        return {"ok": True}


    @router.post("/api/processes/{process_id}/access-request")
    def request_process_access(process_id: str, request: Request) -> dict[str, Any]:
        requester = request.state.user
        stamp = now_iso()
        with db_conn() as conn:
            process = conn.execute(
                "SELECT p.id, p.owner_id, p.name, u.username AS owner_username FROM processes p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?",
                (process_id,),
            ).fetchone()
            if not process:
                raise HTTPException(status_code=404, detail="Процесс не найден")
            if process["owner_id"] is None:
                raise HTTPException(status_code=400, detail="У этого публичного процесса нет владельца, который может выдать доступ на редактирование.")
            if process["owner_id"] == requester["id"]:
                raise HTTPException(status_code=400, detail="Вы уже владелец этого процесса")
            share = conn.execute("SELECT permission FROM process_shares WHERE process_id = ? AND user_id = ?", (process_id, requester["id"])).fetchone()
            if share and share["permission"] == "edit":
                return {"status": "already_shared", "permission": "edit", "owner_username": process["owner_username"]}
            previous = conn.execute("SELECT status, requested_permission FROM process_access_requests WHERE process_id = ? AND requester_id = ?", (process_id, requester["id"])).fetchone()
            if previous and previous["status"] == "pending":
                return {"status": "pending", "permission": previous["requested_permission"], "owner_username": process["owner_username"]}
            conn.execute(
                """INSERT INTO process_access_requests (process_id, requester_id, status, requested_permission, created_at, updated_at)
                   VALUES (?, ?, 'pending', 'edit', ?, ?)
                   ON CONFLICT(process_id, requester_id) DO UPDATE SET status='pending', requested_permission='edit', created_at=excluded.created_at, updated_at=excluded.updated_at""",
                (process_id, requester["id"], stamp, stamp),
            )
        return {"status": "pending", "permission": "edit", "owner_username": process["owner_username"]}


    @router.get("/api/access-requests/incoming")
    def incoming_access_requests(request: Request) -> list[dict[str, Any]]:
        with db_conn() as conn:
            rows = conn.execute(
                """SELECT r.process_id, r.requester_id, r.requested_permission, r.created_at,
                          p.name AS process_name, u.username AS requester_username, u.email AS requester_email
                   FROM process_access_requests r
                   JOIN processes p ON p.id = r.process_id
                   JOIN users u ON u.id = r.requester_id
                   WHERE p.owner_id = ? AND r.status = 'pending'
                   ORDER BY r.created_at DESC""",
                (request.state.user["id"],),
            ).fetchall()
        return [dict(row) for row in rows]


    @router.post("/api/processes/{process_id}/access-requests/{requester_id}/decision")
    async def decide_access_request(process_id: str, requester_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        owner_only(process_id, request.state.user["id"])
        decision = str(payload.get("decision") or "").lower()
        if decision not in {"approve", "reject"}:
            raise HTTPException(status_code=400, detail="decision должен быть approve или reject")
        permission = "view" if payload.get("permission") == "view" else "edit"
        stamp = now_iso()
        with db_conn() as conn:
            access_request = conn.execute(
                "SELECT status FROM process_access_requests WHERE process_id = ? AND requester_id = ?",
                (process_id, requester_id),
            ).fetchone()
            if not access_request:
                raise HTTPException(status_code=404, detail="Запрос доступа не найден")
            if access_request["status"] != "pending":
                return {"ok": True, "status": access_request["status"]}
            if decision == "approve":
                conn.execute(
                    "INSERT INTO process_shares (process_id, user_id, permission, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(process_id, user_id) DO UPDATE SET permission=excluded.permission",
                    (process_id, requester_id, permission, stamp),
                )
                next_status = "approved"
            else:
                next_status = "rejected"
            conn.execute(
                "UPDATE process_access_requests SET status = ?, updated_at = ? WHERE process_id = ? AND requester_id = ?",
                (next_status, stamp, process_id, requester_id),
            )
        if decision == "approve":
            await process_rooms.broadcast(process_id, {"type": "access_changed", "user_id": requester_id, "permission": permission, "by": request.state.user["username"]})
        return {"ok": True, "status": next_status, "permission": permission if decision == "approve" else None}


    @router.get("/api/processes/{process_id}/export.json")
    def export_json(process_id: str, request: Request) -> Response:
        process = ensure_process_access(process_id, request.state.user["id"], write=False)
        team = get_team()
        tools = get_tools()
        grades = get_role_grades()
        financial_goals = get_financial_goals()
        summary = apply_financial_goal_allocations(calculate_graph(process, team, tools=tools, role_grades=grades), process.get("settings", {}), financial_goals)
        payload = {
            "format": "flowcost.process.v3",
            "exported_at": now_iso(),
            "process": {"id": process["id"], "name": process["name"], "description": process["description"], "folder": process.get("folder", ""), "settings": process.get("settings", {}), "nodes": process["nodes"], "edges": process["edges"]},
            "team": team,
            "tools": tools,
            "role_grades": grades,
            "financial_goals": financial_goals,
            "cost_summary": summary,
            "integration_note": "Neutral interchange schema. Buildn-specific field mapping has not been asserted; adapt to a confirmed Buildn import schema before importing directly.",
        }
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        return Response(body, media_type="application/json; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="flowcost-process.json"'})


    @router.get("/api/processes/{process_id}/export.xlsx")
    def export_xlsx(process_id: str, request: Request) -> Response:
        process = ensure_process_access(process_id, request.state.user["id"], write=False)
        team = get_team()
        tools = get_tools()
        grades = get_role_grades()
        financial_goals = get_financial_goals()
        summary = apply_financial_goal_allocations(calculate_graph(process, team, tools=tools, role_grades=grades), process.get("settings", {}), financial_goals)
        content = build_xlsx(make_export_sheets(process, team, summary, tools, grades, financial_goals))
        return Response(content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="flowcost-{process_id}.xlsx"'})


    @router.get("/api/processes/{process_id}/cost")
    def process_cost(process_id: str, request: Request) -> dict[str, Any]:
        process = ensure_process_access(process_id, request.state.user["id"], write=False)
        summary = calculate_graph(process, get_team(), tools=get_tools(), role_grades=get_role_grades())
        return apply_financial_goal_allocations(summary, process.get("settings", {}), get_financial_goals())



    @router.get("/api/processes/{process_id}/ops/{op_id}")
    def collaboration_operation_receipt(process_id: str, op_id: str, request: Request) -> dict[str, Any]:
        ensure_process_access(process_id, request.state.user["id"], write=False)
        with db_conn() as conn:
            row = conn.execute("SELECT revision, conflicts_json, updated_at FROM process_op_receipts WHERE process_id = ? AND op_id = ?", (process_id, op_id[:120])).fetchone()
        if not row:
            return {"committed": False}
        return {"committed": True, "revision": int(row["revision"]), "conflicts": json.loads(row["conflicts_json"] or "[]"), "updated_at": row["updated_at"]}


    @router.get("/api/processes/{process_id}/history")
    def process_history(process_id: str, request: Request) -> list[dict[str, Any]]:
        ensure_process_access(process_id, request.state.user["id"], write=False)
        with db_conn() as conn:
            rows = conn.execute("SELECT revision, username, operations_json, conflicts_json, created_at FROM process_events WHERE process_id = ? ORDER BY revision DESC LIMIT 100", (process_id,)).fetchall()
        return [{"revision": row["revision"], "username": row["username"], "operations": json.loads(row["operations_json"]), "conflicts": json.loads(row["conflicts_json"]), "created_at": row["created_at"]} for row in rows]



    return router, {"list_processes": list_processes}
