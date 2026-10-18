"""Pure collaboration operation and conflict helpers."""
from __future__ import annotations

import sqlite3
from typing import Any

def apply_path_value(root: Any, path: list[str], value: Any = None, unset: bool = False) -> None:
    """Apply a small path update. List elements are addressed by stable @<id> selectors."""
    if not path:
        raise ValueError("A field update must include a path")
    parent = root
    for token in path[:-1]:
        if isinstance(parent, list):
            if not token.startswith("@"):
                raise ValueError("List traversal must use a stable @id selector")
            item_id = token[1:]
            parent = next((item for item in parent if isinstance(item, dict) and str(item.get("id")) == item_id), None)
        elif isinstance(parent, dict):
            parent = parent.get(token)
        else:
            parent = None
        if parent is None:
            raise ValueError("Update path does not exist")
    final = path[-1]
    if isinstance(parent, dict):
        if unset:
            parent.pop(final, None)
        else:
            parent[final] = value
        return
    if isinstance(parent, list) and final.startswith("@"):
        item_id = final[1:]
        index = next((i for i, item in enumerate(parent) if isinstance(item, dict) and str(item.get("id")) == item_id), None)
        if index is None:
            raise ValueError("List item does not exist")
        if unset:
            parent.pop(index)
        else:
            parent[index] = value
        return
    raise ValueError("Update path target is not an object field")


def collaboration_path_key(op: dict[str, Any]) -> str:
    kind = str(op.get("type", ""))
    if kind.startswith("node."):
        base = f"node/{str(op.get('node_id') or (op.get('node') or {}).get('id') or '')}"
    elif kind.startswith("edge."):
        base = f"edge/{str(op.get('edge_id') or (op.get('edge') or {}).get('id') or '')}"
    elif kind in {"set", "list.add", "list.remove"}:
        entity = str(op.get("entity", "process"))
        entity_id = str(op.get("entity_id", ""))
        base = f"{entity}/{entity_id}"
        path = [str(part) for part in op.get("path", [])]
        if kind == "list.add":
            path += ["@" + str((op.get("item") or {}).get("id", ""))]
        elif kind == "list.remove":
            path += ["@" + str(op.get("item_id", ""))]
        if path:
            base += "/" + "/".join(path)
    else:
        raise ValueError("Unsupported collaboration operation")
    return base.rstrip("/")


def collaboration_target_available(state: dict[str, Any], op: dict[str, Any]) -> bool:
    """Return whether an operation still targets an existing object/path.

    This is used only when a stale operation conflicts with a concurrent deletion:
    deletion wins rather than leaving the whole socket batch rejected.
    """
    kind = str(op.get("type", ""))
    if kind in {"node.add", "node.remove", "edge.add", "edge.remove"}:
        return True
    entity = str(op.get("entity", "process"))
    entity_id = str(op.get("entity_id", ""))
    if entity == "node":
        target: Any = next((item for item in state.get("nodes", []) if str(item.get("id")) == entity_id), None)
    elif entity == "edge":
        target = next((item for item in state.get("edges", []) if str(item.get("id")) == entity_id), None)
    elif entity == "process":
        target = state
    else:
        return False
    if target is None:
        return False
    path = op.get("path", [])
    if not isinstance(path, list) or not path:
        return False
    is_list_op = kind in {"list.add", "list.remove"}
    traverse_path = path if is_list_op else path[:-1]
    for segment in traverse_path:
        if isinstance(target, dict):
            target = target.get(segment)
        elif isinstance(target, list) and isinstance(segment, str) and segment.startswith("@"):
            target = next((item for item in target if isinstance(item, dict) and str(item.get("id")) == segment[1:]), None)
        else:
            return False
        if target is None:
            return False
    if is_list_op:
        return isinstance(target, list)
    final = path[-1]
    return isinstance(target, dict) or (isinstance(target, list) and isinstance(final, str) and final.startswith("@") and any(isinstance(item, dict) and str(item.get("id")) == final[1:] for item in target))


def apply_collaboration_batch(state: dict[str, Any], operations: list[dict[str, Any]], conflicts: list[str]) -> None:
    """Apply a batch while allowing a conflicting deletion to win over stale edits."""
    conflict_set = set(conflicts)
    for operation in operations:
        path_key = collaboration_path_key(operation)
        if path_key in conflict_set and not collaboration_target_available(state, operation):
            continue
        apply_collaboration_operation(state, operation)


def apply_collaboration_operation(state: dict[str, Any], op: dict[str, Any]) -> None:
    """Apply one operation to a process state. The API persists the result transactionally."""
    kind = str(op.get("type", ""))
    if kind == "node.add":
        node = op.get("node")
        if not isinstance(node, dict) or not node.get("id"):
            raise ValueError("node.add needs a node with an id")
        nodes = state["nodes"]
        existing = next((i for i, item in enumerate(nodes) if str(item.get("id")) == str(node["id"])), None)
        if existing is None:
            nodes.append(node)
        else:
            nodes[existing] = node
        return
    if kind == "node.remove":
        state["nodes"] = [node for node in state["nodes"] if str(node.get("id")) != str(op.get("node_id", ""))]
        return
    if kind == "edge.add":
        edge = op.get("edge")
        if not isinstance(edge, dict) or not edge.get("id"):
            raise ValueError("edge.add needs an edge with an id")
        edges = state["edges"]
        existing = next((i for i, item in enumerate(edges) if str(item.get("id")) == str(edge["id"])), None)
        if existing is None:
            edges.append(edge)
        else:
            edges[existing] = edge
        return
    if kind == "edge.remove":
        state["edges"] = [edge for edge in state["edges"] if str(edge.get("id")) != str(op.get("edge_id", ""))]
        return
    if kind in {"set", "list.add", "list.remove"}:
        entity = str(op.get("entity", "process"))
        entity_id = str(op.get("entity_id", ""))
        if entity == "node":
            root = next((item for item in state["nodes"] if str(item.get("id")) == entity_id), None)
        elif entity == "edge":
            root = next((item for item in state["edges"] if str(item.get("id")) == entity_id), None)
        elif entity == "process":
            root = state
        else:
            raise ValueError("Unknown collaboration entity")
        if root is None:
            raise ValueError("Collaboration target does not exist")
        path = op.get("path", [])
        if not isinstance(path, list) or not path or len(path) > 24 or any(not isinstance(part, str) or len(part) > 200 for part in path):
            raise ValueError("Invalid collaboration path")
        if kind == "set":
            apply_path_value(root, path, op.get("value"), bool(op.get("unset")))
            return
        target = root
        for token in path:
            if isinstance(target, dict):
                target = target.get(token)
            elif isinstance(target, list) and token.startswith("@"):
                target = next((item for item in target if isinstance(item, dict) and str(item.get("id")) == token[1:]), None)
            else:
                target = None
            if target is None:
                raise ValueError("List path does not exist")
        if not isinstance(target, list):
            raise ValueError("list.add/list.remove target must be a list")
        if kind == "list.add":
            item = op.get("item")
            if not isinstance(item, dict) or not item.get("id"):
                raise ValueError("list.add needs an item with an id")
            index = next((i for i, current in enumerate(target) if isinstance(current, dict) and str(current.get("id")) == str(item["id"])), None)
            if index is None:
                target.append(item)
            else:
                target[index] = item
        else:
            item_id = str(op.get("item_id", ""))
            target[:] = [item for item in target if not isinstance(item, dict) or str(item.get("id")) != item_id]
        return
    raise ValueError("Unsupported collaboration operation")


def operation_conflict_paths(conn: sqlite3.Connection, process_id: str, base_revision: int, path_keys: list[str]) -> list[str]:
    rows = conn.execute("SELECT path_key FROM process_path_versions WHERE process_id = ? AND revision > ?", (process_id, base_revision)).fetchall()
    changed = [str(row["path_key"]) for row in rows]
    conflicts: list[str] = []
    for path_key in path_keys:
        if any(old == "*" or path_key == old or path_key.startswith(old + "/") or old.startswith(path_key + "/") for old in changed):
            conflicts.append(path_key)
    return sorted(set(conflicts))


