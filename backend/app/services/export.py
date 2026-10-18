"""Excel export generation kept independent from FastAPI route handlers."""
from __future__ import annotations

import io
import zipfile
from datetime import datetime
from typing import Any
from xml.etree import ElementTree as ET

from .costing import safe_float

def xlsx_col(index: int) -> str:
    result = ""
    while index:
        index, rem = divmod(index - 1, 26)
        result = chr(65 + rem) + result
    return result


def xlsx_xml_text(value: Any) -> tuple[str, str]:
    if value is None:
        return "inlineStr", ""
    if isinstance(value, bool):
        return "b", "1" if value else "0"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "n", str(value)
    return "inlineStr", str(value)


def serialize_package_xml(element: ET.Element, namespace: str) -> bytes:
    raw = ET.tostring(element, encoding="utf-8", xml_declaration=True)
    raw = raw.replace(f' xmlns:ns0="{namespace}"'.encode(), f' xmlns="{namespace}"'.encode())
    raw = raw.replace(b"<ns0:", b"<").replace(b"</ns0:", b"</")
    return raw


def build_xlsx(sheets: list[dict[str, Any]]) -> bytes:
    """Small dependency-free OOXML exporter for the app's XLSX download endpoint."""
    ns_main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    ns_rel_doc = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    suffix = next((sheet.get("currency_suffix") for sheet in sheets if "currency_suffix" in sheet), "₽")
    if suffix:
        money_format = f'#,##0.00 "{suffix}";[Red]-#,##0.00 "{suffix}"'
    else:
        money_format = "#,##0.00;[Red]-#,##0.00"
    ns_rel_pkg = "http://schemas.openxmlformats.org/package/2006/relationships"
    ET.register_namespace("", ns_main)
    ET.register_namespace("r", ns_rel_doc)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        content_types = ET.Element("{http://schemas.openxmlformats.org/package/2006/content-types}Types")
        ET.SubElement(content_types, "{http://schemas.openxmlformats.org/package/2006/content-types}Default", {"Extension": "rels", "ContentType": "application/vnd.openxmlformats-package.relationships+xml"})
        ET.SubElement(content_types, "{http://schemas.openxmlformats.org/package/2006/content-types}Default", {"Extension": "xml", "ContentType": "application/xml"})
        ET.SubElement(content_types, "{http://schemas.openxmlformats.org/package/2006/content-types}Override", {"PartName": "/xl/workbook.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"})
        ET.SubElement(content_types, "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}Relationship", {}) if False else None
        ET.SubElement(content_types, "{http://schemas.openxmlformats.org/package/2006/content-types}Override", {"PartName": "/xl/styles.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"})
        for i in range(len(sheets)):
            ET.SubElement(content_types, "{http://schemas.openxmlformats.org/package/2006/content-types}Override", {"PartName": f"/xl/worksheets/sheet{i+1}.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"})
        archive.writestr("[Content_Types].xml", serialize_package_xml(content_types, "http://schemas.openxmlformats.org/package/2006/content-types"))

        root_rels = ET.Element("{http://schemas.openxmlformats.org/package/2006/relationships}Relationships")
        ET.SubElement(root_rels, "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship", {"Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "Target": "xl/workbook.xml"})
        archive.writestr("_rels/.rels", serialize_package_xml(root_rels, "http://schemas.openxmlformats.org/package/2006/relationships"))

        workbook = ET.Element(f"{{{ns_main}}}workbook", {f"{{{ns_rel_doc}}}":{""} } if False else {})
        book_sheets = ET.SubElement(workbook, f"{{{ns_main}}}sheets")
        for i, sheet in enumerate(sheets, start=1):
            ET.SubElement(book_sheets, f"{{{ns_main}}}sheet", {"name": sheet["name"][:31], "sheetId": str(i), f"{{{ns_rel_doc}}}id": f"rId{i}"})
        archive.writestr("xl/workbook.xml", ET.tostring(workbook, encoding="utf-8", xml_declaration=True))
        workbook_rels = ET.Element("{http://schemas.openxmlformats.org/package/2006/relationships}Relationships")
        for i in range(1, len(sheets) + 1):
            ET.SubElement(workbook_rels, "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship", {"Id": f"rId{i}", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "Target": f"worksheets/sheet{i}.xml"})
        ET.SubElement(workbook_rels, "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship", {"Id": f"rId{len(sheets)+1}", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "Target": "styles.xml"})
        archive.writestr("xl/_rels/workbook.xml.rels", serialize_package_xml(workbook_rels, "http://schemas.openxmlformats.org/package/2006/relationships"))

        styles = ET.Element(f"{{{ns_main}}}styleSheet")
        numfmts = ET.SubElement(styles, f"{{{ns_main}}}numFmts", {"count": "1"})
        ET.SubElement(numfmts, f"{{{ns_main}}}numFmt", {"numFmtId": "164", "formatCode": money_format})
        fonts = ET.SubElement(styles, f"{{{ns_main}}}fonts", {"count": "3"})
        f0 = ET.SubElement(fonts, f"{{{ns_main}}}font"); ET.SubElement(f0, f"{{{ns_main}}}sz", {"val": "10"}); ET.SubElement(f0, f"{{{ns_main}}}name", {"val": "Aptos"})
        f1 = ET.SubElement(fonts, f"{{{ns_main}}}font"); ET.SubElement(f1, f"{{{ns_main}}}b"); ET.SubElement(f1, f"{{{ns_main}}}sz", {"val": "16"}); ET.SubElement(f1, f"{{{ns_main}}}color", {"rgb": "FFFFFFFF"}); ET.SubElement(f1, f"{{{ns_main}}}name", {"val": "Aptos Display"})
        f2 = ET.SubElement(fonts, f"{{{ns_main}}}font"); ET.SubElement(f2, f"{{{ns_main}}}b"); ET.SubElement(f2, f"{{{ns_main}}}color", {"rgb": "FFFFFFFF"}); ET.SubElement(f2, f"{{{ns_main}}}name", {"val": "Aptos"})
        fills = ET.SubElement(styles, f"{{{ns_main}}}fills", {"count": "3"})
        fill0 = ET.SubElement(fills, f"{{{ns_main}}}fill"); ET.SubElement(fill0, f"{{{ns_main}}}patternFill", {"patternType": "none"})
        fill1 = ET.SubElement(fills, f"{{{ns_main}}}fill"); ET.SubElement(fill1, f"{{{ns_main}}}patternFill", {"patternType": "solid"}); ET.SubElement(list(fill1)[0], f"{{{ns_main}}}fgColor", {"rgb": "FF173A32"}); ET.SubElement(list(fill1)[0], f"{{{ns_main}}}bgColor", {"indexed": "64"})
        fill2 = ET.SubElement(fills, f"{{{ns_main}}}fill"); ET.SubElement(fill2, f"{{{ns_main}}}patternFill", {"patternType": "solid"}); ET.SubElement(list(fill2)[0], f"{{{ns_main}}}fgColor", {"rgb": "FF236A59"}); ET.SubElement(list(fill2)[0], f"{{{ns_main}}}bgColor", {"indexed": "64"})
        borders = ET.SubElement(styles, f"{{{ns_main}}}borders", {"count": "1"})
        border = ET.SubElement(borders, f"{{{ns_main}}}border"); ET.SubElement(border, f"{{{ns_main}}}left"); ET.SubElement(border, f"{{{ns_main}}}right"); ET.SubElement(border, f"{{{ns_main}}}top"); ET.SubElement(border, f"{{{ns_main}}}bottom"); ET.SubElement(border, f"{{{ns_main}}}diagonal")
        cell_styles = ET.SubElement(styles, f"{{{ns_main}}}cellStyleXfs", {"count": "1"}); ET.SubElement(cell_styles, f"{{{ns_main}}}xf", {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0"})
        xfs = ET.SubElement(styles, f"{{{ns_main}}}cellXfs", {"count": "4"})
        xf_default = ET.SubElement(xfs, f"{{{ns_main}}}xf", {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0", "xfId": "0", "applyAlignment": "1"})
        ET.SubElement(xf_default, f"{{{ns_main}}}alignment", {"vertical": "top", "wrapText": "1"})
        xf_title = ET.SubElement(xfs, f"{{{ns_main}}}xf", {"numFmtId": "0", "fontId": "1", "fillId": "1", "borderId": "0", "xfId": "0", "applyFill": "1", "applyFont": "1", "applyAlignment": "1"}); ET.SubElement(xf_title, f"{{{ns_main}}}alignment", {"vertical": "center", "wrapText": "1"})
        xf_header = ET.SubElement(xfs, f"{{{ns_main}}}xf", {"numFmtId": "0", "fontId": "2", "fillId": "2", "borderId": "0", "xfId": "0", "applyFill": "1", "applyFont": "1", "applyAlignment": "1"}); ET.SubElement(xf_header, f"{{{ns_main}}}alignment", {"vertical": "center", "wrapText": "1"})
        xf_currency = ET.SubElement(xfs, f"{{{ns_main}}}xf", {"numFmtId": "164", "fontId": "0", "fillId": "0", "borderId": "0", "xfId": "0", "applyNumberFormat": "1"})
        cell_styles2 = ET.SubElement(styles, f"{{{ns_main}}}cellStyles", {"count": "1"}); ET.SubElement(cell_styles2, f"{{{ns_main}}}cellStyle", {"name": "Normal", "xfId": "0", "builtinId": "0"})
        archive.writestr("xl/styles.xml", ET.tostring(styles, encoding="utf-8", xml_declaration=True))

        for sheet_index, sheet in enumerate(sheets, start=1):
            ws = ET.Element(f"{{{ns_main}}}worksheet")
            widths = sheet.get("widths", [])
            if widths:
                cols = ET.SubElement(ws, f"{{{ns_main}}}cols")
                for col_num, width in enumerate(widths, start=1):
                    ET.SubElement(cols, f"{{{ns_main}}}col", {"min": str(col_num), "max": str(col_num), "width": str(width), "customWidth": "1"})
            data = ET.SubElement(ws, f"{{{ns_main}}}sheetData")
            rows = sheet.get("rows", [])
            header_row = sheet.get("header_row", 1)
            title_rows = set(sheet.get("title_rows", [0]))
            currency_cols = set(sheet.get("currency_cols", []))
            currency_cells = set(sheet.get("currency_cells", []))
            for row_i, row_values in enumerate(rows, start=1):
                row_el = ET.SubElement(data, f"{{{ns_main}}}row", {"r": str(row_i)})
                for col_i, value in enumerate(row_values, start=1):
                    if value is None or value == "":
                        continue
                    cell_ref = f"{xlsx_col(col_i)}{row_i}"
                    cell_type, text_value = xlsx_xml_text(value)
                    style_id = 0
                    if row_i - 1 in title_rows:
                        style_id = 1
                    elif header_row is not None and row_i - 1 == header_row:
                        style_id = 2
                    elif (cell_ref in currency_cells or col_i in currency_cols) and isinstance(value, (int, float)):
                        style_id = 3
                    cell_attrs = {"r": cell_ref}
                    if cell_type != "n":
                        cell_attrs["t"] = cell_type
                    if style_id:
                        cell_attrs["s"] = str(style_id)
                    cell = ET.SubElement(row_el, f"{{{ns_main}}}c", cell_attrs)
                    if cell_type == "inlineStr":
                        is_el = ET.SubElement(cell, f"{{{ns_main}}}is")
                        t_el = ET.SubElement(is_el, f"{{{ns_main}}}t")
                        if text_value.startswith(" ") or text_value.endswith(" ") or "\n" in text_value:
                            t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                        t_el.text = text_value
                    else:
                        ET.SubElement(cell, f"{{{ns_main}}}v").text = text_value
            ET.SubElement(ws, f"{{{ns_main}}}pageMargins", {"left": "0.25", "right": "0.25", "top": "0.5", "bottom": "0.5", "header": "0.2", "footer": "0.2"})
            archive.writestr(f"xl/worksheets/sheet{sheet_index}.xml", ET.tostring(ws, encoding="utf-8", xml_declaration=True))
    return out.getvalue()


def make_export_sheets(process: dict[str, Any], team: list[dict[str, Any]], summary: dict[str, Any], tools: list[dict[str, Any]] | None = None, role_grades: list[dict[str, Any]] | None = None, financial_goals: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    tools = tools or []
    role_grades = role_grades or []
    financial_goals = financial_goals or []
    team_by_id = {str(item["id"]): item for item in team}
    tools_by_id = {str(item["id"]): item for item in tools}
    grades_by_id = {str(item["id"]): item for item in role_grades}
    currencies = {str(item.get("currency", "RUB")) for item in role_grades}
    currencies |= {str(item.get("currency", "RUB")) for item in tools if item.get("active", True)}
    currency_label = next(iter(currencies)) if len(currencies) == 1 else "без конвертации"
    cost_label = "Стоимость, ₽" if currency_label == "RUB" else f"Стоимость, {currency_label}"
    nodes_by_id = {str(node["id"]): node for node in process["nodes"]}
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    summary_rows = [
        [f"План процесса: {process['name']}"],
        ["Описание", process.get("description", "")],
        ["Экспортирован", stamp],
        [f"Базовая стоимость самого дорогого сценария ({currency_label})", summary["max_scenario_cost"]],
        ["Пополнение финансовых целей", summary.get("financial_goal_total", 0)],
        [f"Итог с финансовыми целями ({currency_label})", summary.get("total_with_financial_goals", summary["max_scenario_cost"])],
        ["Часы самого дорогого сценария", summary["max_scenario_hours"]],
        ["Календарная длительность критического маршрута, дни", summary.get("max_scenario_days", 0)],
        ["Этапов в процессе", sum(1 for node in process["nodes"] if node.get("type") not in {"sticker", "risk", "group"})],
        ["Связей процесса (без связей данных)", sum(1 for edge in process["edges"] if not (bool(edge.get("dataFlow")) or (str(edge.get("sourceHandle") or "").startswith("out-") and str(edge.get("targetHandle") or "").startswith("in-"))))],
        ["Критический по стоимости маршрут", " → ".join(summary["max_path"])],
        ["Расчёт", "Ветви узла «Решение» трактуются как взаимоисключающие: в бюджет включается самый дорогой маршрут."],
        ["Инструменты", "Стоимость лицензии распределяется пропорционально календарной длительности этапа: цена за месяц × дни / 30,4375."],
        ["Предупреждения", "\n".join(summary["warnings"]) or "Нет"],
        [f"Справочно: сумма стоимости всех этапов, включая альтернативные ветви ({currency_label})", summary["all_steps_cost_including_alternatives"]],
        [f"Справочно: стоимость инструментов во всех ветках ({currency_label})", summary.get("all_tools_cost_including_alternatives", 0)],
    ]
    step_rows = [[
        "ID", "Этап", "Тип", "Описание", "Входные данные", "Результат / выход", "Исполнители и задачи", "Часы", cost_label, "Плановая длительность, дни", "Чек-лист", "ID подпроцесса", "Цели задач", "Ожидаемый результат задач", "Теги задач", "Поля задач для выгрузки", "Инструменты", "Стоимость инструментов"
    ]]
    metric_map = {item["id"]: item for item in summary["steps"]}
    type_names = {"start": "Старт", "task": "Задача", "decision": "Решение", "end": "Завершение", "subprocess": "Подпроцесс", "sticker": "Заметка", "risk": "Риск", "group": "Группа"}
    def format_ports(value: Any) -> str:
        if isinstance(value, list):
            labels = []
            for item in value:
                if isinstance(item, dict):
                    label = item.get("label") or item.get("name") or ""
                else:
                    label = str(item or "")
                if str(label).strip():
                    labels.append(str(label).strip())
            return "\n".join(labels)
        return str(value or "")
    def format_node_inputs(node: dict[str, Any]) -> str:
        data = node.get("data") or {}
        raw_ports = data.get("inputs", "")
        if not isinstance(raw_ports, list):
            return format_ports(raw_ports)
        labels: list[str] = []
        for index, port in enumerate(raw_ports):
            if isinstance(port, dict):
                port_id = str(port.get("id", ""))
                label = str(port.get("label") or port.get("name") or "")
            else:
                port_id, label = f"legacy-input-{node.get('id')}-{index}", str(port or "")
            matching_edge = next((edge for edge in process["edges"] if (bool(edge.get("dataFlow")) or (str(edge.get("sourceHandle") or "").startswith("out-") and str(edge.get("targetHandle") or "").startswith("in-"))) and str(edge.get("target")) == str(node.get("id")) and str(edge.get("targetHandle") or "") == f"in-{port_id}"), None)
            if matching_edge:
                source_node = nodes_by_id.get(str(matching_edge.get("source")), {})
                source_data = source_node.get("data") or {}
                source_port_id = str(matching_edge.get("sourceHandle") or "").removeprefix("out-")
                source_ports = source_data.get("outputs", [])
                if isinstance(source_ports, list):
                    source_port = next((item for item in source_ports if isinstance(item, dict) and str(item.get("id", "")) == source_port_id), None)
                    if source_port and (source_port.get("label") or source_port.get("name")):
                        label = str(source_port.get("label") or source_port.get("name"))
            if label.strip():
                labels.append(label.strip())
        return "\n".join(labels)
    for node in process["nodes"]:
        data = node.get("data") or {}
        metric = metric_map.get(str(node.get("id")), {})
        assignees = []
        goals: list[str] = []
        expected: list[str] = []
        tags: list[str] = []
        custom_export: list[str] = []
        for assignment in data.get("assignments", []) or []:
            member = team_by_id.get(str(assignment.get("member_id", "")))
            name = member["name"] if member else f"Неизвестный участник ({assignment.get('member_id', '')})"
            role = member.get("role", "") if member else ""
            grade = grades_by_id.get(str(assignment.get("grade_id", "")))
            grade_text = f" · {grade.get('grade')}" if grade else ""
            task_name = str(assignment.get("task") or "Работа")
            rate = grade.get("hourly_rate", 0) if grade else 0
            assignees.append(f"{task_name} — {name}{f' / {role}' if role else ''}{grade_text}: {safe_float(assignment.get('hours')):g} ч × {safe_float(rate):g}")
            if assignment.get("goal"):
                goals.append(f"{task_name}: {assignment['goal']}")
            if assignment.get("expected_result"):
                expected.append(f"{task_name}: {assignment['expected_result']}")
            tags.extend(str(tag) for tag in (assignment.get("tags") or []) if str(tag).strip())
            for field in assignment.get("custom_fields", []) or []:
                if field.get("export_to_excel") and str(field.get("label") or "").strip():
                    custom_export.append(f"{task_name} / {field['label']}: {field.get('value', '')}")
        tool_names = []
        for binding in data.get("tools", []) or []:
            tool_id = str(binding.get("tool_id") if isinstance(binding, dict) else binding)
            if tool_id in tools_by_id:
                tool_names.append(tools_by_id[tool_id]["name"])
        step_rows.append([
            node.get("id", ""), data.get("name", data.get("label", "")), type_names.get(node.get("type"), node.get("type", "")),
            data.get("description", ""), format_node_inputs(node), format_ports(data.get("outputs", "")), "; ".join(assignees),
            metric.get("hours", 0), metric.get("cost", 0), safe_float(data.get("plannedDays")),
            "\n".join(data.get("checklist", []) or []), data.get("source_process_id", ""),
            "\n".join(goals), "\n".join(expected), ", ".join(dict.fromkeys(tags)), "\n".join(custom_export),
            ", ".join(tool_names), metric.get("tool_cost", 0),
        ])
    team_rows = [["ID", "Участник", "Роль", "Активен", "Демо-данные"]]
    for member in team:
        team_rows.append([member["id"], member["name"], member["role"], "Да" if member["active"] else "Нет", "Да" if member.get("is_demo") else "Нет"])
    edge_rows = [["ID связи", "Тип связи", "Из этапа", "Выходные данные", "Переход / условие", "Входные данные", "В этап"]]
    for edge in process["edges"]:
        source_node = nodes_by_id.get(str(edge.get("source")), {})
        target_node = nodes_by_id.get(str(edge.get("target")), {})
        source_data = source_node.get("data") or {}
        target_data = target_node.get("data") or {}
        source_handle = str(edge.get("sourceHandle") or "")
        target_handle = str(edge.get("targetHandle") or "")
        is_data_flow = bool(edge.get("dataFlow")) or (source_handle.startswith("out-") and target_handle.startswith("in-"))
        source_outputs = format_ports(source_data.get("outputs", ""))
        target_inputs = format_node_inputs(target_node)
        source_port_id = source_handle.removeprefix("out-")
        target_port_id = target_handle.removeprefix("in-")
        if is_data_flow:
            source_outputs = next((str(item.get("label", "")) for item in source_data.get("outputs", []) if isinstance(item, dict) and str(item.get("id", "")) == source_port_id), source_outputs)
            target_inputs = next((str(item.get("label", "")) for item in target_data.get("inputs", []) if isinstance(item, dict) and str(item.get("id", "")) == target_port_id), target_inputs)
        edge_rows.append([edge.get("id", ""), "Данные" if is_data_flow else "Переход", source_data.get("name", edge.get("source", "")), source_outputs if is_data_flow else "", edge.get("label", ""), target_inputs if is_data_flow else "", target_data.get("name", edge.get("target", ""))])
    path_rows = [["№", "Этап", "Тип", "Часы", cost_label]]
    for i, row in enumerate(summary["path_steps"], start=1):
        path_rows.append([i, row["name"], type_names.get(row["type"], row["type"]), row["hours"], row["cost"]])
    path_rows.append(["", "ИТОГО — самый дорогой сценарий", "", summary["max_scenario_hours"], summary["max_scenario_cost"]])
    currency_suffix_map = {"RUB": "₽", "EUR": "€", "USD": "$", "SEK": "kr"}
    currency_suffix = currency_suffix_map.get(currency_label)
    tool_rows = [["ID", "Инструмент", "Описание", "Цена за месяц", "Валюта", "Активен"]]
    tool_rows.extend([[item["id"], item["name"], item.get("description", ""), item.get("monthly_price", 0), item.get("currency", "RUB"), "Да" if item.get("active") else "Нет"] for item in tools])
    grade_rows = [["ID", "Роль", "Грейд", "Ставка за час", "Валюта", "Грейд по умолчанию"]]
    grade_rows.extend([[item["id"], item["role"], item["grade"], item["hourly_rate"], item["currency"], "Да" if item.get("is_default") else "Нет"] for item in role_grades])
    financial_goal_rows = [["ID цели", "Финансовая цель", "Целевой фонд в месяц", "Валюта", "Ставка пополнения в месяц, %", "Длительность маршрута, мес.", "Пополнение в месяц по процессу", "Общее пополнение за проект", "План пополнения в месяц по всем процессам", "Общее пополнение по всем процессам"]]
    contributions = {str(item["goal_id"]): item for item in summary.get("financial_goal_contributions", [])}
    for goal in financial_goals:
        contribution = contributions.get(str(goal["id"]), {})
        financial_goal_rows.append([goal["id"], goal["name"], goal["target_monthly_amount"], goal["currency"], contribution.get("rate_percent", 0), contribution.get("months", summary.get("scenario_duration_months", 0)), contribution.get("monthly_contribution", 0), contribution.get("contribution", 0), goal.get("planned_monthly_contributions", 0), goal.get("planned_contributions", 0)])
    return [
        {"name": "Сводка", "rows": summary_rows, "header_row": None, "title_rows": [0], "widths": [52, 100], "currency_cells": ["B4", "B5", "B6", "B14", "B15"], "currency_suffix": currency_suffix},
        {"name": "Этапы", "rows": [[f"Этапы процесса: {process['name']}"]] + step_rows, "header_row": 1, "title_rows": [0], "widths": [16, 28, 15, 45, 32, 32, 44, 12, 18, 18, 38, 22, 40, 40, 28, 42, 28, 18], "currency_cols": [9, 18], "currency_suffix": currency_suffix},
        {"name": "Команда", "rows": [["Команда и роли (ставки назначаются только на уровне грейдов)"]] + team_rows, "header_row": 1, "title_rows": [0], "widths": [18, 30, 28, 12, 14]},
        {"name": "Связи", "rows": [["Переходы процесса и связи данных"]] + edge_rows, "header_row": 1, "title_rows": [0], "widths": [18, 14, 30, 32, 30, 32, 30]},
        {"name": "Маршрут стоимости", "rows": [["Самый дорогой сценарий"]] + path_rows, "header_row": 1, "title_rows": [0], "widths": [10, 40, 16, 14, 18], "currency_cols": [5], "currency_suffix": currency_suffix},
        {"name": "Инструменты", "rows": [["Каталог инструментов"]] + tool_rows, "header_row": 1, "title_rows": [0], "widths": [18, 30, 42, 18, 12, 12], "currency_cols": [4], "currency_suffix": currency_suffix},
        {"name": "Грейды ролей", "rows": [["Каталог ставок по ролям и грейдам"]] + grade_rows, "header_row": 1, "title_rows": [0], "widths": [18, 30, 22, 18, 12, 20], "currency_cols": [4], "currency_suffix": currency_suffix},
        {"name": "Финансовые цели", "rows": [["Расчёт пополнения финансовых целей"]] + financial_goal_rows, "header_row": 1, "title_rows": [0], "widths": [18, 32, 22, 12, 24, 22, 26, 26, 32, 30], "currency_cols": [3, 7, 8, 9, 10], "currency_suffix": currency_suffix},
    ]


