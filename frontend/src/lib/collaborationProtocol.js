export function stateFromParts(parts) {
  const nodes = (parts.nodes || []).map((node) => {
    const { selected, dragging, resizing, measured, ...persisted } = node;
    return persisted;
  });
  const edges = (parts.edges || []).map((edge) => {
    const { selected, ...persisted } = edge;
    return persisted;
  });
  return { nodes, edges, settings: parts.settings || { financial_goal_allocations: [] }, name: parts.name || 'Новый процесс', description: parts.description || '', folder: parts.folder || '' };
}

export function operationForValue(entity, entityId, path, previous, next, ops) {
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  if (previous && next && typeof previous === 'object' && typeof next === 'object' && !Array.isArray(previous) && !Array.isArray(next)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (!(key in next)) ops.push({ type: 'set', entity, entity_id: entityId, path: [...path, key], unset: true });
      else if (!(key in previous)) ops.push({ type: 'set', entity, entity_id: entityId, path: [...path, key], value: next[key] });
      else operationForValue(entity, entityId, [...path, key], previous[key], next[key], ops);
    }
    return;
  }
  if (Array.isArray(previous) && Array.isArray(next) && [...previous, ...next].every((item) => item && typeof item === 'object' && !Array.isArray(item) && item.id !== undefined)) {
    const oldById = new Map(previous.map((item) => [String(item.id), item]));
    const newById = new Map(next.map((item) => [String(item.id), item]));
    for (const [id] of oldById) if (!newById.has(id)) ops.push({ type: 'list.remove', entity, entity_id: entityId, path, item_id: id });
    for (const [id, item] of newById) {
      if (!oldById.has(id)) ops.push({ type: 'list.add', entity, entity_id: entityId, path, item });
      else operationForValue(entity, entityId, [...path, `@${id}`], oldById.get(id), item, ops);
    }
    return;
  }
  ops.push({ type: 'set', entity, entity_id: entityId, path, value: next });
}

export function diffCollaborativeState(previous, next) {
  if (!previous) return [];
  const operations = [];
  const diffEntities = (kind, oldList, newList) => {
    const oldById = new Map((oldList || []).map((item) => [String(item.id), item]));
    const newById = new Map((newList || []).map((item) => [String(item.id), item]));
    for (const [id] of oldById) if (!newById.has(id)) operations.push({ type: `${kind}.remove`, [`${kind}_id`]: id });
    for (const [id, item] of newById) {
      if (!oldById.has(id)) operations.push({ type: `${kind}.add`, [kind]: item });
      else operationForValue(kind, id, [], oldById.get(id), item, operations);
    }
  };
  diffEntities('node', previous.nodes, next.nodes);
  diffEntities('edge', previous.edges, next.edges);
  for (const field of ['name', 'description', 'folder', 'settings']) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) {
      operationForValue('process', '', [field], previous[field], next[field], operations);
    }
  }
  return operations;
}

export function updatePathInPlace(root, path, value, unset = false) {
  if (!path?.length) return;
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(parent) && segment.startsWith('@')) parent = parent.find((item) => String(item.id) === segment.slice(1));
    else parent = parent?.[segment];
    if (parent == null) return;
  }
  const final = path[path.length - 1];
  if (Array.isArray(parent) && final.startsWith('@')) {
    const index = parent.findIndex((item) => String(item.id) === final.slice(1));
    if (index < 0) return;
    if (unset) parent.splice(index, 1); else parent[index] = value;
  } else if (parent && typeof parent === 'object') {
    if (unset) delete parent[final]; else parent[final] = value;
  }
}

export function applyOperationsToState(source, operations) {
  const state = JSON.parse(JSON.stringify(source));
  for (const op of operations || []) {
    if (op.type === 'node.add') {
      const i = state.nodes.findIndex((item) => String(item.id) === String(op.node.id));
      if (i < 0) state.nodes.push(op.node); else state.nodes[i] = op.node;
    } else if (op.type === 'node.remove') state.nodes = state.nodes.filter((item) => String(item.id) !== String(op.node_id));
    else if (op.type === 'edge.add') {
      const i = state.edges.findIndex((item) => String(item.id) === String(op.edge.id));
      if (i < 0) state.edges.push(op.edge); else state.edges[i] = op.edge;
    } else if (op.type === 'edge.remove') state.edges = state.edges.filter((item) => String(item.id) !== String(op.edge_id));
    else if (['set', 'list.add', 'list.remove'].includes(op.type)) {
      let target;
      if (op.entity === 'node') target = state.nodes.find((item) => String(item.id) === String(op.entity_id));
      else if (op.entity === 'edge') target = state.edges.find((item) => String(item.id) === String(op.entity_id));
      else target = state;
      if (!target) continue;
      if (op.type === 'set') updatePathInPlace(target, op.path, op.value, Boolean(op.unset));
      else {
        let list = target;
        for (const segment of op.path || []) {
          if (Array.isArray(list) && String(segment).startsWith('@')) list = list.find((item) => String(item.id) === String(segment).slice(1));
          else list = list?.[segment];
        }
        if (!Array.isArray(list)) continue;
        if (op.type === 'list.add') {
          const index = list.findIndex((item) => String(item.id) === String(op.item.id));
          if (index < 0) list.push(op.item); else list[index] = op.item;
        } else {
          const index = list.findIndex((item) => String(item.id) === String(op.item_id));
          if (index >= 0) list.splice(index, 1);
        }
      }
    }
  }
  return state;
}

async function api(path, options = {}) {
  const token = localStorage.getItem('flowcost_token');
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try { const data = await response.json(); message = data.detail || message; } catch { /* keep fallback */ }
    throw new Error(message);
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.blob();
}
