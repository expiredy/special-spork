import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

os.environ.setdefault("FLOWCOST_DB_PATH", str(Path(tempfile.gettempdir()) / "flowcost-tests.sqlite3"))

from fastapi.testclient import TestClient
from app.main import app, calculate_graph, build_xlsx, list_team, list_tools, list_role_grades, make_export_sheets, apply_financial_goal_allocations, apply_collaboration_operation, apply_collaboration_batch, collaboration_path_key, db_conn


class CostingTests(unittest.TestCase):
    def test_cors_headers_are_present_on_early_401_auth_middleware_responses(self):
        # A stale token is a normal 401 response; browsers must be allowed to read
        # its detail rather than misreporting it as a CORS/network failure.
        with TestClient(app) as client:
            response = client.get("/api/auth/me", headers={"Origin": "http://localhost:5173"})
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:5173")
            self.assertIn("истекла", response.json()["detail"])

            preflight = client.options("/api/auth/me", headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            })
            self.assertEqual(preflight.status_code, 200)
            self.assertEqual(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173")

            invalid_login = client.post(
                "/api/auth/login",
                headers={"Origin": "http://localhost:5173"},
                json={"username": "no-such-flowcost-user", "password": "not-a-real-password"},
            )
            self.assertEqual(invalid_login.status_code, 401)
            self.assertEqual(invalid_login.headers.get("access-control-allow-origin"), "http://localhost:5173")
            self.assertEqual(invalid_login.json()["detail"], "Неверный логин или пароль.")

            untrusted = client.get("/api/auth/me", headers={"Origin": "https://untrusted.invalid"})
            self.assertEqual(untrusted.status_code, 401)
            self.assertIsNone(untrusted.headers.get("access-control-allow-origin"))

    def test_decision_uses_costliest_alternative_and_counts_shared_continuation_once(self):
        team = [{"id": "dev", "name": "Dev", "role": "Developer", "hourly_rate": 100, "currency": "RUB", "active": True}]
        graph = {
            "nodes": [
                {"id": "start", "type": "start", "data": {"name": "Start", "assignments": []}},
                {"id": "choice", "type": "decision", "data": {"name": "Choice", "assignments": []}},
                {"id": "cheap", "type": "task", "data": {"name": "Cheap route", "assignments": [{"member_id": "dev", "hours": 1}]}},
                {"id": "expensive", "type": "task", "data": {"name": "Expensive route", "assignments": [{"member_id": "dev", "hours": 4}]}},
                {"id": "common", "type": "task", "data": {"name": "Common continuation", "assignments": [{"member_id": "dev", "hours": 2}]}},
                {"id": "end", "type": "end", "data": {"name": "End", "assignments": []}},
            ],
            "edges": [
                {"source": "start", "target": "choice"},
                {"source": "choice", "target": "cheap", "label": "No"},
                {"source": "choice", "target": "expensive", "label": "Yes"},
                {"source": "cheap", "target": "common"},
                {"source": "expensive", "target": "common"},
                {"source": "common", "target": "end"},
            ],
        }
        grades = [{"id": "grade-dev", "role": "Developer", "grade": "Middle", "hourly_rate": 100, "currency": "RUB", "is_default": True}]
        result = calculate_graph(graph, team, role_grades=grades)
        self.assertEqual(result["max_scenario_cost"], 600)
        self.assertEqual(result["max_scenario_hours"], 6)
        self.assertEqual(result["max_path"], ["Start", "Choice", "Expensive route", "Common continuation", "End"])
        self.assertEqual(result["all_steps_cost_including_alternatives"], 700)

    def test_data_flow_edge_does_not_change_process_cost_route(self):
        team = [{"id": "dev", "name": "Dev", "role": "Developer", "hourly_rate": 100, "currency": "RUB", "active": True}]
        graph = {
            "nodes": [
                {"id": "start", "type": "start", "data": {"name": "Start", "assignments": []}},
                {"id": "task-a", "type": "task", "data": {"name": "Task A", "assignments": [{"member_id": "dev", "hours": 2}]}},
                {"id": "task-b", "type": "task", "data": {"name": "Task B", "assignments": [{"member_id": "dev", "hours": 3}]}},
                {"id": "sticker", "type": "sticker", "data": {"name": "Brainstorm note", "assignments": [{"member_id": "dev", "hours": 99}]}},
                {"id": "risk", "type": "risk", "data": {"name": "Risk note", "assignments": [{"member_id": "dev", "hours": 99}]}},
                {"id": "group", "type": "group", "data": {"name": "A group", "assignments": []}},
            ],
            "edges": [
                {"source": "start", "target": "task-a"},
                {"source": "task-a", "target": "task-b", "dataFlow": True, "sourceHandle": "out-port-x", "targetHandle": "in-port-y"},
            ],
        }
        grades = [{"id": "grade-dev", "role": "Developer", "grade": "Middle", "hourly_rate": 100, "currency": "RUB", "is_default": True}]
        result = calculate_graph(graph, team, role_grades=grades)
        # Data lineage and annotation shapes should not create a process continuation or be costed.
        self.assertEqual(result["max_scenario_cost"], 300)
        self.assertEqual(result["max_scenario_hours"], 3)
        self.assertNotIn("Brainstorm note", result["max_path"])
        self.assertNotIn("Risk note", result["max_path"])

    def test_export_formats_port_lists_and_task_names(self):
        process = {
            "id": "export-test", "name": "Export test", "description": "", "edges": [],
            "nodes": [{"id": "task", "type": "task", "data": {
                "name": "Create draft", "inputs": [{"id": "in1", "label": "Approved brief"}],
                "outputs": [{"id": "out1", "label": "Draft file"}], "plannedDays": 1,
                "assignments": [{"task": "Write copy", "member_id": "dev", "hours": 2}], "checklist": []
            }}]
        }
        team = [{"id": "dev", "name": "Dev", "role": "Writer", "hourly_rate": 100, "currency": "RUB", "active": True}]
        summary = calculate_graph(process, team)
        sheets = make_export_sheets(process, team, summary)
        steps = sheets[1]["rows"][2]
        self.assertEqual(steps[4], "Approved brief")
        self.assertEqual(steps[5], "Draft file")
        self.assertIn("Write copy", steps[6])

    def test_unknown_team_member_creates_warning(self):
        graph = {"nodes": [{"id": "task", "type": "task", "data": {"name": "Assign me", "assignments": [{"member_id": "missing", "hours": 2}]}}], "edges": []}
        result = calculate_graph(graph, [])
        self.assertEqual(result["max_scenario_cost"], 0)
        self.assertTrue(any("не найдены участники" in warning for warning in result["warnings"]))

    def test_starter_process_is_not_seeded_or_retained(self):
        with db_conn() as conn:
            starter = conn.execute("SELECT id FROM processes WHERE id = 'demo-landing'").fetchone()
        self.assertIsNone(starter)


    def test_role_grade_overrides_person_rate_and_tool_cost_is_prorated(self):
        team = [{"id": "designer", "name": "Designer", "role": "Design", "hourly_rate": 100, "currency": "RUB", "active": True}]
        grades = [{"id": "design-senior", "role": "Design", "grade": "Senior", "hourly_rate": 250, "currency": "RUB"}]
        tools = [{"id": "figma", "name": "Figma", "monthly_price": 300, "currency": "RUB", "active": True}]
        graph = {"nodes": [{"id": "task", "type": "task", "data": {"name": "Design", "plannedDays": 15, "tools": [{"tool_id": "figma"}], "assignments": [{"task": "UI design", "member_id": "designer", "grade_id": "design-senior", "hours": 4}]}}], "edges": []}
        result = calculate_graph(graph, team, tools=tools, role_grades=grades)
        self.assertAlmostEqual(result["max_scenario_cost"], 1147.84, places=2)
        step = result["steps"][0]
        self.assertEqual(step["labor_cost"], 1000)
        self.assertAlmostEqual(step["tool_cost"], 147.84, places=2)


    def test_default_grade_is_used_when_task_has_no_explicit_grade(self):
        team = [{"id": "dev", "name": "Dev", "role": "Developer", "active": True}]
        grades = [{"id": "grade-default", "role": "Developer", "grade": "Middle", "hourly_rate": 220, "currency": "RUB", "is_default": True}]
        graph = {"nodes": [{"id": "task", "type": "task", "data": {"name": "Task", "assignments": [{"member_id": "dev", "hours": 3}]}}], "edges": []}
        result = calculate_graph(graph, team, role_grades=grades)
        self.assertEqual(result["max_scenario_cost"], 660)

    def test_excel_exports_only_custom_fields_marked_for_export(self):
        process = {"id": "custom-export", "name": "Custom export", "description": "", "edges": [], "nodes": [{"id": "task", "type": "task", "data": {
            "name": "Review", "assignments": [{"task": "QA", "member_id": "dev", "hours": 1, "custom_fields": [
                {"label": "External status", "value": "Approved", "export_to_excel": True},
                {"label": "Private note", "value": "Internal only", "export_to_excel": False}
            ]}]
        }}]}
        team = [{"id": "dev", "name": "Dev", "role": "QA", "hourly_rate": 100, "currency": "RUB", "active": True}]
        sheets = make_export_sheets(process, team, calculate_graph(process, team))
        stage_rows = sheets[1]["rows"]
        self.assertIn("External status: Approved", str(stage_rows[2]))
        self.assertNotIn("Private note", str(stage_rows[2]))

    def test_financial_goal_contribution_is_per_calendar_month(self):
        summary = {"max_scenario_cost": 100000, "max_scenario_days": 60.875}
        goals = [{"id": "goal-c-level", "name": "Фонд зарплат C-level", "target_monthly_amount": 500000, "currency": "RUB", "active": True}]
        result = apply_financial_goal_allocations(summary, {"financial_goal_allocations": [{"goal_id": "goal-c-level", "rate_percent": 5}]}, goals)
        self.assertAlmostEqual(result["scenario_duration_months"], 2.0, places=3)
        self.assertAlmostEqual(result["financial_goal_contributions"][0]["monthly_contribution"], 5000, places=2)
        self.assertAlmostEqual(result["financial_goal_total"], 10000, places=2)
        self.assertAlmostEqual(result["total_with_financial_goals"], 110000, places=2)

    def test_collaboration_can_update_nested_custom_field_by_stable_id(self):
        state = {"nodes": [{"id": "n1", "type": "task", "data": {"assignments": [{"id": "work-1", "custom_fields": [{"id": "field-1", "label": "Status", "value": "Draft"}]}]}}], "edges": [], "settings": {}, "name": "Test", "description": "", "folder": ""}
        apply_collaboration_operation(state, {"type": "set", "entity": "node", "entity_id": "n1", "path": ["data", "assignments", "@work-1", "custom_fields", "@field-1", "value"], "value": "Approved"})
        self.assertEqual(state["nodes"][0]["data"]["assignments"][0]["custom_fields"][0]["value"], "Approved")
        apply_collaboration_operation(state, {"type": "list.add", "entity": "node", "entity_id": "n1", "path": ["data", "assignments", "@work-1", "custom_fields"], "item": {"id": "field-2", "label": "Internal", "value": "note"}})
        self.assertEqual(len(state["nodes"][0]["data"]["assignments"][0]["custom_fields"]), 2)
        apply_collaboration_operation(state, {"type": "list.remove", "entity": "node", "entity_id": "n1", "path": ["data", "assignments", "@work-1", "custom_fields"], "item_id": "field-2"})
        self.assertEqual(len(state["nodes"][0]["data"]["assignments"][0]["custom_fields"]), 1)


    def test_stale_edit_to_concurrently_deleted_node_does_not_break_batch(self):
        state = {"nodes": [], "edges": [], "settings": {}, "name": "Test", "description": "", "folder": ""}
        operation = {"type": "set", "entity": "node", "entity_id": "deleted-node", "path": ["data", "name"], "value": "Stale local edit"}
        # The current state represents another collaborator's accepted deletion.
        # A matching conflict means deletion wins and the stale edit becomes a no-op.
        apply_collaboration_batch(state, [operation], [collaboration_path_key(operation)])
        self.assertEqual(state["nodes"], [])

    def test_stale_edit_to_deleted_nested_task_does_not_break_batch(self):
        state = {"nodes": [{"id": "node-1", "type": "task", "data": {"assignments": []}}], "edges": [], "settings": {}, "name": "Test", "description": "", "folder": ""}
        operation = {"type": "set", "entity": "node", "entity_id": "node-1", "path": ["data", "assignments", "@work-1", "hours"], "value": 4}
        apply_collaboration_batch(state, [operation], [collaboration_path_key(operation)])
        self.assertEqual(state["nodes"][0]["data"]["assignments"], [])

    def test_xlsx_is_valid_zip_package_with_all_worksheets(self):
        # Build an explicit fixture rather than depending on a seeded starter process.
        process = {
            "id": "xlsx-test", "name": "Export test", "description": "", "folder": "Tests", "settings": {},
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "data": {"name": "Старт", "assignments": []}},
                {"id": "task", "type": "task", "position": {"x": 200, "y": 0}, "data": {"name": "Подготовка", "assignments": []}},
                {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"name": "Готово", "assignments": []}},
            ],
            "edges": [{"id": "edge-1", "source": "start", "target": "task"}, {"id": "edge-2", "source": "task", "target": "end"}],
        }
        team = list_team()
        summary = calculate_graph(process, team)
        content = build_xlsx(make_export_sheets(process, team, summary))
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            self.assertIsNone(archive.testzip())
            workbook = archive.read("xl/workbook.xml").decode("utf-8")
            self.assertIn("Этапы", workbook)
            self.assertIn("Маршрут стоимости", workbook)
            self.assertIn("xl/worksheets/sheet5.xml", archive.namelist())


if __name__ == "__main__":
    unittest.main()
