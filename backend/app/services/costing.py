"""Pure cost calculation helpers used by API routes and exports."""
from __future__ import annotations

from typing import Any

def safe_float(value: Any, default: float = 0) -> float:
    try:
        result = float(value)
        return result if result >= 0 else default
    except (TypeError, ValueError):
        return default


def calculate_graph(
    graph: dict[str, Any],
    team: list[dict[str, Any]],
    depth: int = 0,
    tools: list[dict[str, Any]] | None = None,
    role_grades: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Calculate a costliest single route; decision branches are alternatives (XOR).

    Tool costs are prorated by planned calendar days: monthly price * days / 30.4375.
    Labour rates come exclusively from role grades. A member's role default grade is used only to normalise legacy tasks that do not yet store a grade id.
    """
    nodes = graph.get("nodes", []) or []
    edges = graph.get("edges", []) or []
    tools = tools or []
    role_grades = role_grades or []
    team_by_id = {str(member["id"]): member for member in team}
    tool_by_id = {str(item["id"]): item for item in tools}
    grade_by_id = {str(item["id"]): item for item in role_grades}
    default_grade_by_role: dict[str, dict[str, Any]] = {}
    for grade_item in role_grades:
        role_key = str(grade_item.get("role", "")).strip().casefold()
        if role_key and (grade_item.get("is_default") or role_key not in default_grade_by_role):
            default_grade_by_role[role_key] = grade_item
    annotation_types = {"sticker", "risk", "group"}
    node_by_id = {str(node.get("id")): node for node in nodes if node.get("id") is not None and node.get("type") not in annotation_types}
    all_node_ids = {str(node.get("id")) for node in nodes if node.get("id") is not None}
    outgoing: dict[str, list[dict[str, Any]]] = {key: [] for key in node_by_id}
    indegree: dict[str, int] = {key: 0 for key in node_by_id}
    warnings: list[str] = []
    active_currencies = {str(item.get("currency", "RUB")) for item in tools if item.get("active", True)}
    active_currencies |= {str(item.get("currency", "RUB")) for item in role_grades}
    if len(active_currencies) > 1:
        warnings.append("В команде, грейдах и инструментах есть ставки в разных валютах; стоимость суммируется без конвертации.")

    for edge in edges:
        source, target = str(edge.get("source", "")), str(edge.get("target", ""))
        source_handle = str(edge.get("sourceHandle") or "")
        target_handle = str(edge.get("targetHandle") or "")
        is_data_flow = bool(edge.get("dataFlow")) or (source_handle.startswith("out-") and target_handle.startswith("in-"))
        if is_data_flow:
            continue
        if source in outgoing and target in node_by_id:
            outgoing[source].append(edge)
            indegree[target] += 1
        elif source in all_node_ids and target in all_node_ids:
            continue
        else:
            warnings.append(f"Связь {edge.get('id', '')} ведёт к отсутствующему этапу.")

    node_metrics: dict[str, dict[str, Any]] = {}
    for node_id, node in node_by_id.items():
        data = node.get("data") or {}
        assignments = data.get("assignments") or []
        own_hours = 0.0
        labor_cost = 0.0
        missing: list[str] = []
        for assignment in assignments:
            member_id = str(assignment.get("member_id", ""))
            hours = safe_float(assignment.get("hours", 0))
            own_hours += hours
            member = team_by_id.get(member_id)
            if not member:
                if member_id:
                    missing.append(member_id)
                continue
            grade = grade_by_id.get(str(assignment.get("grade_id", "")))
            if grade is None and member:
                grade = default_grade_by_role.get(str(member.get("role", "")).strip().casefold())
            if grade is None:
                missing.append(f"{member.get('name', member_id)} (не назначен грейд)")
            else:
                if str(grade.get("role", "")).strip().casefold() != str(member.get("role", "")).strip().casefold():
                    missing.append(f"{member.get('name', member_id)} (грейд не соответствует роли)")
                else:
                    labor_cost += hours * safe_float(grade.get("hourly_rate"))
        planned_days = safe_float(data.get("plannedDays", 0))
        tool_cost = 0.0
        chosen_tools: list[dict[str, Any]] = []
        for binding in data.get("tools", []) or []:
            tool_id = str(binding.get("tool_id") if isinstance(binding, dict) else binding)
            tool = tool_by_id.get(tool_id)
            if tool and tool.get("active", True):
                prorated = safe_float(tool.get("monthly_price")) * planned_days / 30.4375
                tool_cost += prorated
                chosen_tools.append({"id": tool_id, "name": tool.get("name", "Инструмент"), "monthly_price": safe_float(tool.get("monthly_price")), "prorated_cost": round(prorated, 2), "currency": tool.get("currency", "RUB")})
        sub_cost = 0.0
        sub_hours = 0.0
        if node.get("type") == "subprocess" and depth < 5:
            snapshot = data.get("subprocess_snapshot") or {}
            if snapshot.get("nodes"):
                sub_summary = calculate_graph(snapshot, team, depth + 1, tools, role_grades)
                sub_cost = safe_float(sub_summary.get("max_scenario_cost"))
                sub_hours = safe_float(sub_summary.get("max_scenario_hours"))
                warnings.extend([f"Подпроцесс «{data.get('name', node_id)}»: {w}" for w in sub_summary.get("warnings", [])])
        own_cost = labor_cost + tool_cost
        node_metrics[node_id] = {
            "id": node_id,
            "name": data.get("name") or data.get("label") or node_id,
            "type": node.get("type", "task"),
            "hours": own_hours + sub_hours,
            "cost": own_cost + sub_cost,
            "own_hours": own_hours,
            "own_cost": own_cost,
            "labor_cost": labor_cost,
            "tool_cost": round(tool_cost, 2),
            "planned_days": planned_days,
            "tools": chosen_tools,
            "assignments": assignments,
            "missing_members": missing,
        }
        if missing:
            warnings.append(f"Этап «{node_metrics[node_id]['name']}»: не найдены участники {', '.join(missing)}.")

    state: dict[str, int] = {key: 0 for key in node_by_id}
    cycle = False

    def detect(current: str) -> None:
        nonlocal cycle
        if state[current] == 1:
            cycle = True
            return
        if state[current] == 2:
            return
        state[current] = 1
        for edge in outgoing[current]:
            detect(str(edge["target"]))
        state[current] = 2

    for node_id in node_by_id:
        if state[node_id] == 0:
            detect(node_id)
    if cycle:
        warnings.append("Обнаружен цикл/возвратная связь. Для MVP стоимость рассчитана консервативно по всем этапам; циклы лучше разбирать на следующем шаге.")
        all_ids = list(node_by_id)
        path_ids = all_ids
        max_cost = sum(node_metrics[n]["cost"] for n in all_ids)
        max_hours = sum(node_metrics[n]["hours"] for n in all_ids)
    else:
        memo: dict[str, dict[str, Any]] = {}

        def best_route(current: str) -> dict[str, Any]:
            if current in memo:
                return memo[current]
            metric = node_metrics[current]
            children = [best_route(str(edge["target"])) for edge in outgoing[current]]
            if children:
                winner = max(children, key=lambda item: (item["cost"], item["hours"]))
                result = {"cost": metric["cost"] + winner["cost"], "hours": metric["hours"] + winner["hours"], "path": [current] + winner["path"]}
            else:
                result = {"cost": metric["cost"], "hours": metric["hours"], "path": [current]}
            memo[current] = result
            return result

        roots = [node_id for node_id, degree in indegree.items() if degree == 0]
        if not roots and node_by_id:
            roots = list(node_by_id)
        if len(roots) > 1:
            warnings.append("В графе несколько независимых стартовых точек; для итоговой оценки выбрана самая дорогая точка входа.")
        candidates = [best_route(root) for root in roots]
        winner = max(candidates, key=lambda item: (item["cost"], item["hours"])) if candidates else {"cost": 0, "hours": 0, "path": []}
        max_cost, max_hours, path_ids = winner["cost"], winner["hours"], winner["path"]

    for node_id, edges_out in outgoing.items():
        if len(edges_out) > 1 and node_by_id[node_id].get("type") != "decision":
            warnings.append(f"Этап «{node_metrics[node_id]['name']}» имеет несколько выходов, но не отмечен как «Решение». В MVP ветки считаются альтернативами.")

    path_rows = [node_metrics[n] for n in path_ids if n in node_metrics]
    max_scenario_days = sum(safe_float(item.get("planned_days")) for item in path_rows)
    all_cost = sum(item["cost"] for item in node_metrics.values())
    all_hours = sum(item["hours"] for item in node_metrics.values())
    all_tool_cost = sum(item["tool_cost"] for item in node_metrics.values())
    return {
        "max_scenario_cost": round(max_cost, 2),
        "max_scenario_hours": round(max_hours, 2),
        "max_scenario_days": round(max_scenario_days, 2),
        "all_steps_cost_including_alternatives": round(all_cost, 2),
        "all_steps_hours_including_alternatives": round(all_hours, 2),
        "all_tools_cost_including_alternatives": round(all_tool_cost, 2),
        "max_path_ids": path_ids,
        "max_path": [node_metrics[n]["name"] for n in path_ids if n in node_metrics],
        "steps": list(node_metrics.values()),
        "path_steps": path_rows,
        "warnings": list(dict.fromkeys(warnings)),
    }




def apply_financial_goal_allocations(summary: dict[str, Any], settings: dict[str, Any] | None, goals: list[dict[str, Any]]) -> dict[str, Any]:
    """A configured rate is added per calendar month against the base process estimate.

    contribution = base worst-case estimate * rate_percent / 100 * max-route duration in months.
    """
    settings = settings or {}
    goal_by_id = {str(goal["id"]): goal for goal in goals}
    months = safe_float(summary.get("max_scenario_days")) / 30.4375
    base_cost = safe_float(summary.get("max_scenario_cost"))
    items: list[dict[str, Any]] = []
    for allocation in settings.get("financial_goal_allocations", []) or []:
        if not isinstance(allocation, dict):
            continue
        goal = goal_by_id.get(str(allocation.get("goal_id", "")))
        if not goal or not goal.get("active", True):
            continue
        rate = safe_float(allocation.get("rate_percent"))
        # The percentage is set aside from the base estimate every calendar month
        # while the process is expected to run. Monthly inflow is separate from
        # the total lifetime allocation, which scales with route duration.
        monthly_contribution = base_cost * rate / 100.0
        contribution = monthly_contribution * months
        items.append({
            "goal_id": goal["id"], "goal_name": goal["name"], "rate_percent": rate,
            "months": round(months, 3), "base_cost": round(base_cost, 2),
            "monthly_contribution": round(monthly_contribution, 2),
            "contribution": round(contribution, 2), "currency": goal.get("currency", "RUB"),
            "target_monthly_amount": safe_float(goal.get("target_monthly_amount")),
        })
    result = dict(summary)
    result["financial_goal_contributions"] = items
    result["financial_goal_total"] = round(sum(item["contribution"] for item in items), 2)
    result["total_with_financial_goals"] = round(base_cost + result["financial_goal_total"], 2)
    result["scenario_duration_months"] = round(months, 3)
    return result


