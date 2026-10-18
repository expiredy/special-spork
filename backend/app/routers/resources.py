from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException

def create_resources_router(context: dict[str, Any]):
    db_conn = context["db_conn"]
    now_iso = context["now_iso"]
    new_id = context["new_id"]
    get_team = context["get_team"]
    get_tools = context["get_tools"]
    get_role_grades = context["get_role_grades"]
    get_financial_goals = context["get_financial_goals"]
    safe_float = context["safe_float"]
    router = APIRouter()

    @router.get("/api/team")
    def list_team() -> list[dict[str, Any]]:
        return get_team()


    @router.post("/api/team")
    def create_team_member(payload: dict[str, Any]) -> dict[str, Any]:
        stamp = now_iso()
        member_id = new_id("member-")
        name = str(payload.get("name") or "Новый участник").strip()[:200]
        role = str(payload.get("role") or "").strip()[:200]
        if not name or not role:
            raise HTTPException(status_code=400, detail="Укажите имя участника и роль.")
        if not any(item["role"].casefold() == role.casefold() for item in get_role_grades()):
            raise HTTPException(status_code=400, detail="Сначала создайте роль и хотя бы один грейд со ставкой.")
        with db_conn() as conn:
            # Legacy rate columns are retained for database compatibility, but not used in calculations.
            conn.execute("INSERT INTO team_members VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (member_id, name, role, 0.0, "RUB", 1, 0, stamp, stamp))
        return next(item for item in get_team() if item["id"] == member_id)


    @router.put("/api/team/{member_id}")
    def update_team_member(member_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        members = {str(item["id"]): item for item in get_team()}
        if member_id not in members:
            raise HTTPException(status_code=404, detail="Участник не найден")
        old = members[member_id]
        name = str(payload.get("name", old["name"]) or "Без имени").strip()[:200]
        role = str(payload.get("role", old["role"]) or "").strip()[:200]
        if not role or not any(item["role"].casefold() == role.casefold() for item in get_role_grades()):
            raise HTTPException(status_code=400, detail="Выберите роль, у которой настроен хотя бы один грейд.")
        active = 1 if payload.get("active", old["active"]) else 0
        stamp = now_iso()
        with db_conn() as conn:
            conn.execute("UPDATE team_members SET name=?, role=?, hourly_rate=0, currency='RUB', active=?, updated_at=? WHERE id=?", (name, role, active, stamp, member_id))
        return next(item for item in get_team() if item["id"] == member_id)


    @router.delete("/api/team/{member_id}")
    def delete_team_member(member_id: str) -> dict[str, bool]:
        with db_conn() as conn:
            row = conn.execute("SELECT is_demo FROM team_members WHERE id=?", (member_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Участник не найден")
            conn.execute("DELETE FROM team_members WHERE id=?", (member_id,))
        return {"ok": True}


    @router.get("/api/tools")
    def list_tools() -> list[dict[str, Any]]:
        return get_tools()


    @router.post("/api/tools")
    def create_tool(payload: dict[str, Any]) -> dict[str, Any]:
        stamp = now_iso(); tool_id = new_id("tool-")
        name = str(payload.get("name") or "Новый инструмент").strip()[:200]
        if not name:
            raise HTTPException(status_code=400, detail="Введите название инструмента.")
        with db_conn() as conn:
            conn.execute("INSERT INTO tools VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (tool_id, name, str(payload.get("description") or "")[:1000], safe_float(payload.get("monthly_price")), str(payload.get("currency") or "RUB")[:8], 1 if payload.get("active", True) else 0, stamp, stamp))
        return next(item for item in get_tools() if item["id"] == tool_id)


    @router.put("/api/tools/{tool_id}")
    def update_tool(tool_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        old = next((item for item in get_tools() if item["id"] == tool_id), None)
        if not old:
            raise HTTPException(status_code=404, detail="Инструмент не найден")
        stamp = now_iso()
        with db_conn() as conn:
            conn.execute("UPDATE tools SET name=?, description=?, monthly_price=?, currency=?, active=?, updated_at=? WHERE id=?", (str(payload.get("name", old["name"]) or old["name"]).strip()[:200], str(payload.get("description", old["description"]) or "")[:1000], safe_float(payload.get("monthly_price", old["monthly_price"])), str(payload.get("currency", old["currency"]) or "RUB")[:8], 1 if payload.get("active", old["active"]) else 0, stamp, tool_id))
        return next(item for item in get_tools() if item["id"] == tool_id)


    @router.delete("/api/tools/{tool_id}")
    def delete_tool(tool_id: str) -> dict[str, bool]:
        with db_conn() as conn:
            result = conn.execute("DELETE FROM tools WHERE id=?", (tool_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Инструмент не найден")
        return {"ok": True}


    @router.get("/api/roles/grades")
    def list_role_grades() -> list[dict[str, Any]]:
        return get_role_grades()


    @router.post("/api/roles/grades")
    def create_role_grade(payload: dict[str, Any]) -> dict[str, Any]:
        stamp = now_iso(); grade_id = new_id("grade-")
        role = str(payload.get("role") or "").strip()[:200]
        grade = str(payload.get("grade") or "").strip()[:100]
        if not role or not grade:
            raise HTTPException(status_code=400, detail="Укажите роль и грейд.")
        rate = safe_float(payload.get("hourly_rate"))
        currency = str(payload.get("currency") or "RUB")[:8]
        with db_conn() as conn:
            existing = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE", (role,)).fetchone()["n"]
            existing_default = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE AND is_default = 1", (role,)).fetchone()["n"]
            is_default = 1 if payload.get("is_default") or int(existing) == 0 or int(existing_default) == 0 else 0
            if is_default:
                conn.execute("UPDATE role_grades SET is_default = 0 WHERE role = ? COLLATE NOCASE", (role,))
            try:
                conn.execute("INSERT INTO role_grades (id, role, grade, hourly_rate, currency, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (grade_id, role, grade, rate, currency, is_default, stamp, stamp))
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=409, detail="Такой грейд уже есть у этой роли.")
        return next(item for item in get_role_grades() if item["id"] == grade_id)


    @router.put("/api/roles/grades/{grade_id}")
    def update_role_grade(grade_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        old = next((item for item in get_role_grades() if item["id"] == grade_id), None)
        if not old:
            raise HTTPException(status_code=404, detail="Грейд не найден")
        stamp = now_iso()
        role = str(payload.get("role", old["role"]) or old["role"]).strip()[:200]
        grade = str(payload.get("grade", old["grade"]) or old["grade"]).strip()[:100]
        rate = safe_float(payload.get("hourly_rate", old["hourly_rate"]))
        currency = str(payload.get("currency", old["currency"]) or "RUB")[:8]
        wants_default = bool(payload.get("is_default", old["is_default"]))
        with db_conn() as conn:
            is_role_default = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE AND is_default = 1 AND id != ?", (role, grade_id)).fetchone()["n"]
            if wants_default or not is_role_default:
                conn.execute("UPDATE role_grades SET is_default = 0 WHERE role = ? COLLATE NOCASE", (role,))
                wants_default = True
            try:
                conn.execute("UPDATE role_grades SET role=?, grade=?, hourly_rate=?, currency=?, is_default=?, updated_at=? WHERE id=?", (role, grade, rate, currency, 1 if wants_default else 0, stamp, grade_id))
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=409, detail="Такой грейд уже есть у этой роли.")
            # Guarantee exactly one default grade for both the old and new role, if grades remain.
            for affected_role in {old["role"], role}:
                count = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE", (affected_role,)).fetchone()["n"]
                defaults = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE AND is_default = 1", (affected_role,)).fetchone()["n"]
                if count and not defaults:
                    first = conn.execute("SELECT id FROM role_grades WHERE role = ? COLLATE NOCASE ORDER BY created_at, id LIMIT 1", (affected_role,)).fetchone()
                    conn.execute("UPDATE role_grades SET is_default = 1 WHERE id = ?", (first["id"],))
        return next(item for item in get_role_grades() if item["id"] == grade_id)


    @router.delete("/api/roles/grades/{grade_id}")
    def delete_role_grade(grade_id: str) -> dict[str, bool]:
        old = next((item for item in get_role_grades() if item["id"] == grade_id), None)
        if not old:
            raise HTTPException(status_code=404, detail="Грейд не найден")
        with db_conn() as conn:
            count_before = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE", (old["role"],)).fetchone()["n"]
            if int(count_before) == 1:
                members_using_role = conn.execute("SELECT COUNT(*) AS n FROM team_members WHERE role = ? COLLATE NOCASE", (old["role"],)).fetchone()["n"]
                if int(members_using_role) > 0:
                    raise HTTPException(status_code=400, detail="Нельзя удалить последний грейд роли, пока у неё есть участники команды. Сначала назначьте им другую роль.")
            conn.execute("DELETE FROM role_grades WHERE id=?", (grade_id,))
            count = conn.execute("SELECT COUNT(*) AS n FROM role_grades WHERE role = ? COLLATE NOCASE", (old["role"],)).fetchone()["n"]
            if count and not conn.execute("SELECT COUNT(*) FROM role_grades WHERE role = ? COLLATE NOCASE AND is_default = 1", (old["role"],)).fetchone()[0]:
                first = conn.execute("SELECT id FROM role_grades WHERE role = ? COLLATE NOCASE ORDER BY created_at, id LIMIT 1", (old["role"],)).fetchone()
                conn.execute("UPDATE role_grades SET is_default = 1 WHERE id = ?", (first["id"],))
        return {"ok": True}


    @router.get("/api/financial-goals")
    def list_financial_goals() -> list[dict[str, Any]]:
        return get_financial_goals()


    @router.post("/api/financial-goals")
    def create_financial_goal(payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()[:200]
        if not name:
            raise HTTPException(status_code=400, detail="Введите название финансовой цели.")
        stamp = now_iso(); goal_id = new_id("goal-")
        with db_conn() as conn:
            conn.execute("INSERT INTO financial_goals (id, name, description, target_monthly_amount, opening_balance, currency, active, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)", (goal_id, name, str(payload.get("description") or "")[:1000], safe_float(payload.get("target_monthly_amount")), safe_float(payload.get("opening_balance")), str(payload.get("currency") or "RUB")[:8], 1 if payload.get("active", True) else 0, stamp, stamp))
        return next(item for item in get_financial_goals() if item["id"] == goal_id)


    @router.put("/api/financial-goals/{goal_id}")
    def update_financial_goal(goal_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        old = next((item for item in get_financial_goals() if item["id"] == goal_id), None)
        if not old:
            raise HTTPException(status_code=404, detail="Финансовая цель не найдена")
        stamp = now_iso()
        with db_conn() as conn:
            conn.execute("UPDATE financial_goals SET name=?, description=?, target_monthly_amount=?, opening_balance=?, currency=?, active=?, updated_at=? WHERE id=?", (str(payload.get("name", old["name"]) or old["name"]).strip()[:200], str(payload.get("description", old["description"]) or "")[:1000], safe_float(payload.get("target_monthly_amount", old["target_monthly_amount"])), safe_float(payload.get("opening_balance", old["opening_balance"])), str(payload.get("currency", old["currency"]) or "RUB")[:8], 1 if payload.get("active", old["active"]) else 0, stamp, goal_id))
        return next(item for item in get_financial_goals() if item["id"] == goal_id)


    @router.delete("/api/financial-goals/{goal_id}")
    def delete_financial_goal(goal_id: str) -> dict[str, bool]:
        with db_conn() as conn:
            result = conn.execute("DELETE FROM financial_goals WHERE id=?", (goal_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Финансовая цель не найдена")
        return {"ok": True}



    return router, {"list_team": list_team, "list_tools": list_tools, "list_role_grades": list_role_grades}
