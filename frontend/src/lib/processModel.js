export const TYPE_LABELS = { start: 'Старт', task: 'Задача', decision: 'Решение', end: 'Завершение', subprocess: 'Подпроцесс', sticker: 'Заметка', risk: 'Риск', group: 'Группа' };
export const TYPE_ICONS = { start: '●', task: '▰', decision: '◇', end: '■', subprocess: '▣', sticker: '✎', risk: '!', group: '▱' };
export const COLOR_PRESETS = [
  { id: 'slate', name: 'Графит', bg: '#20252d', border: '#657080', accent: '#d9e2ef', soft: '#343b47' },
  { id: 'blue', name: 'Синий', bg: '#172a40', border: '#3e83c4', accent: '#a8d5ff', soft: '#234665' },
  { id: 'purple', name: 'Фиолетовый', bg: '#2a203b', border: '#9366ce', accent: '#ddc2ff', soft: '#45305f' },
  { id: 'green', name: 'Зелёный', bg: '#1c3028', border: '#4b9b76', accent: '#a8ebc4', soft: '#294b3a' },
  { id: 'yellow', name: 'Жёлтый', bg: '#342d19', border: '#c4a23d', accent: '#ffe895', soft: '#51451f' },
  { id: 'orange', name: 'Оранжевый', bg: '#3a281f', border: '#cf814b', accent: '#ffc39a', soft: '#5c3a28' },
  { id: 'red', name: 'Красный', bg: '#3b2026', border: '#d85e6d', accent: '#ffadb6', soft: '#612d37' },
  { id: 'pink', name: 'Розовый', bg: '#382132', border: '#c76aa9', accent: '#ffc2e7', soft: '#58304b' },
];
export const RUB = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const HOURS = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
export const DEFAULT_COLOR_BY_TYPE = { start: 'green', task: 'slate', decision: 'yellow', end: 'green', subprocess: 'blue', sticker: 'yellow', risk: 'red', group: 'slate' };

export function makeId(prefix = 'id') { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`; }
export function newPort(label = '') { return { id: makeId('port'), label }; }
export function normalizePortList(value, nodeId, field) {
  if (Array.isArray(value)) return value.map((item, index) => {
    if (typeof item === 'string') return { id: `legacy-${field}-${nodeId}-${index}`, label: item };
    return { id: item?.id || `legacy-${field}-${nodeId}-${index}`, label: String(item?.label ?? item?.name ?? '') };
  });
  const label = String(value ?? '').trim();
  return label ? [{ id: `legacy-${field}-${nodeId}`, label }] : [];
}
export function colorStyle(data, fallback = 'slate') {
  const color = COLOR_PRESETS.find((item) => item.id === (data?.colorPreset || fallback)) || COLOR_PRESETS[0];
  return { '--node-bg': color.bg, '--node-border': color.border, '--node-accent': color.accent, '--node-soft': color.soft };
}
export function isDataFlowEdge(edge) {
  return Boolean(edge.dataFlow) || (String(edge.sourceHandle || '').startsWith('out-') && String(edge.targetHandle || '').startsWith('in-'));
}

export function defaultGradeForRole(role, roleGrades) {
  const matching = roleGrades.filter((grade) => String(grade.role || '').trim().toLocaleLowerCase() === String(role || '').trim().toLocaleLowerCase());
  return matching.find((grade) => grade.is_default) || matching[0] || null;
}

export function normalizeProcessEdges(rawEdges) {
  return (rawEdges || []).map((edge) => isDataFlowEdge(edge)
    ? { ...edge, dataFlow: true, className: 'data-flow-edge' }
    : { ...edge, sourceHandle: edge.sourceHandle || 'flow-out', targetHandle: edge.targetHandle || 'flow-in', className: 'process-flow-edge' });
}

export function normalizeProcessNodes(rawNodes, team, roleGrades) {
  return (rawNodes || []).map((node) => {
    const data = node.data || {};
    if (!Array.isArray(data.assignments)) return node;
    return {
      ...node,
      data: {
        ...data,
        assignments: data.assignments.map((assignment, index) => {
          const member = team.find((person) => String(person.id) === String(assignment.member_id || ''));
          const matching = roleGrades.find((grade) => String(grade.id) === String(assignment.grade_id || '') && String(grade.role).toLowerCase() === String(member?.role || '').toLowerCase());
          const fallback = defaultGradeForRole(member?.role, roleGrades);
          return { ...assignment, id: assignment.id || `work-${node.id}-${index}`, grade_id: matching?.id || fallback?.id || '' };
        }),
      },
    };
  });
}

export function newNode(type, index, data = {}) {
  const defaults = {
    start: { name: 'Старт процесса', description: '', inputs: [], outputs: [newPort('Карточка запроса')], checklist: [], assignments: [], tools: [], plannedDays: 0, colorPreset: 'green' },
    task: { name: 'Новый этап', description: '', inputs: [newPort('Исходные данные')], outputs: [newPort('Результат этапа')], checklist: [], assignments: [], tools: [], plannedDays: 1, colorPreset: 'slate' },
    decision: { name: 'Условие / решение', description: 'Опишите, по какому правилу выбирается ветка.', inputs: [newPort('Критерии решения')], outputs: [newPort('Выбранный сценарий')], checklist: [], assignments: [], tools: [], plannedDays: 0, colorPreset: 'yellow' },
    end: { name: 'Завершение', description: '', inputs: [newPort('Финальный результат')], outputs: [], checklist: [], assignments: [], tools: [], plannedDays: 0, colorPreset: 'green' },
    subprocess: { name: 'Встроенный процесс', description: '', inputs: [newPort('Входные данные')], outputs: [newPort('Результат процесса')], checklist: [], assignments: [], tools: [], plannedDays: 0, colorPreset: 'blue' },
    sticker: { name: 'Идея', description: 'Запишите мысль…', inputs: [], outputs: [], checklist: [], assignments: [], plannedDays: 0, colorPreset: 'yellow' },
    risk: { name: 'Новый риск', description: '', riskCommentary: '', riskSolution: '', riskSeverity: 'high', inputs: [], outputs: [], checklist: [], assignments: [], plannedDays: 0, colorPreset: 'red' },
    group: { name: 'Группа этапов', description: 'Связанные этапы процесса', inputs: [], outputs: [], checklist: [], assignments: [], plannedDays: 0, colorPreset: 'slate' },
  };
  return {
    id: makeId('n'), type,
    position: { x: 180 + (index % 4) * 70, y: 120 + Math.floor(index / 4) * 100 },
    ...(type === 'group' ? { style: { width: 360, height: 230 }, zIndex: -1 } : {}),
    data: { ...defaults[type], ...data },
  };
}

export function getNodeCost(node, teamById, toolsById = {}, gradesById = {}, depth = 0) {
  const data = node.data || {};
  if (['sticker', 'risk', 'group'].includes(node.type)) return { hours: 0, cost: 0, laborCost: 0, toolCost: 0 };
  let hours = 0;
  let laborCost = 0;
  for (const assignment of data.assignments || []) {
    const h = Math.max(0, Number(assignment.hours) || 0);
    hours += h;
    const person = teamById[String(assignment.member_id || '')];
    const selected = gradesById[String(assignment.grade_id || '')];
    const selectedMatchesRole = selected && person && String(selected.role).toLowerCase() === String(person.role || '').toLowerCase();
    const grade = selectedMatchesRole ? selected : defaultGradeForRole(person?.role, Object.values(gradesById));
    laborCost += h * (Number(grade?.hourly_rate) || 0);
  }
  const days = Math.max(0, Number(data.plannedDays) || 0);
  const toolCost = (data.tools || []).reduce((sum, binding) => {
    const toolId = String(typeof binding === 'object' ? binding.tool_id : binding);
    const tool = toolsById[toolId];
    return sum + (tool?.active === false ? 0 : Math.max(0, Number(tool?.monthly_price) || 0) * days / 30.4375);
  }, 0);
  let cost = laborCost + toolCost;
  if (node.type === 'subprocess' && data.subprocess_snapshot?.nodes?.length && depth < 5) {
    const inner = calculateLocal(data.subprocess_snapshot.nodes, data.subprocess_snapshot.edges || [], Object.values(teamById), Object.values(toolsById), Object.values(gradesById), depth + 1);
    hours += inner.hours;
    cost += inner.cost;
  }
  return { hours, cost, laborCost, toolCost };
}

export function calculateLocal(nodes, edges, team, tools = [], roleGrades = [], depth = 0) {
  const teamById = Object.fromEntries(team.map((member) => [String(member.id), member]));
  const toolsById = Object.fromEntries(tools.map((item) => [String(item.id), item]));
  const gradesById = Object.fromEntries(roleGrades.map((item) => [String(item.id), item]));
  const costNodes = nodes.filter((node) => !['group', 'sticker', 'risk'].includes(node.type));
  const byId = Object.fromEntries(costNodes.map((node) => [String(node.id), node]));
  const outgoing = Object.fromEntries(costNodes.map((node) => [String(node.id), []]));
  const indegree = Object.fromEntries(costNodes.map((node) => [String(node.id), 0]));
  edges.filter((edge) => !isDataFlowEdge(edge)).forEach((edge) => {
    if (outgoing[edge.source] && byId[edge.target]) { outgoing[edge.source].push(edge.target); indegree[edge.target] += 1; }
  });
  const weights = Object.fromEntries(costNodes.map((node) => [String(node.id), getNodeCost(node, teamById, toolsById, gradesById, depth)]));
  const visiting = new Set();
  const memo = new Map();
  let cycle = false;
  function route(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) { cycle = true; return { cost: 0, hours: 0, path: [] }; }
    visiting.add(id);
    const children = outgoing[id].map(route);
    const best = children.length ? children.sort((a, b) => b.cost - a.cost || b.hours - a.hours)[0] : { cost: 0, hours: 0, path: [] };
    visiting.delete(id);
    const result = { cost: weights[id].cost + best.cost, hours: weights[id].hours + best.hours, path: [id, ...best.path] };
    memo.set(id, result);
    return result;
  }
  const roots = costNodes.filter((node) => indegree[node.id] === 0).map((node) => String(node.id));
  let winner = (roots.length ? roots : costNodes.map((node) => String(node.id))).map(route).sort((a, b) => b.cost - a.cost || b.hours - a.hours)[0] || { cost: 0, hours: 0, path: [] };
  if (cycle) winner = { cost: Object.values(weights).reduce((sum, item) => sum + item.cost, 0), hours: Object.values(weights).reduce((sum, item) => sum + item.hours, 0), path: costNodes.map((node) => String(node.id)) };
  const pathNodes = winner.path.map((id) => byId[id]).filter(Boolean);
  return {
    cost: winner.cost, hours: winner.hours, path: winner.path,
    days: pathNodes.reduce((sum, node) => sum + Math.max(0, Number(node.data?.plannedDays) || 0), 0),
    laborCost: pathNodes.reduce((sum, node) => sum + (weights[node.id]?.laborCost || 0), 0),
    toolCost: pathNodes.reduce((sum, node) => sum + (weights[node.id]?.toolCost || 0), 0),
  };
}

export function applyFinancialGoalsLocal(baseSummary, settings, goals) {
  const months = Math.max(0, Number(baseSummary.days) || 0) / 30.4375;
  const baseCost = Math.max(0, Number(baseSummary.cost) || 0);
  const goalById = Object.fromEntries((goals || []).map((goal) => [String(goal.id), goal]));
  const financial_goal_contributions = ((settings?.financial_goal_allocations) || []).flatMap((allocation) => {
    const goal = goalById[String(allocation.goal_id || '')];
    if (!goal || !goal.active) return [];
    const rate = Math.min(100, Math.max(0, Number(allocation.rate_percent) || 0));
    const monthly_contribution = baseCost * rate / 100;
    return [{
      goal_id: goal.id, goal_name: goal.name, rate_percent: rate, months,
      base_cost: baseCost, monthly_contribution,
      contribution: monthly_contribution * months,
      target_monthly_amount: Number(goal.target_monthly_amount) || 0,
      currency: goal.currency || 'RUB',
    }];
  });
  const financial_goal_total = financial_goal_contributions.reduce((sum, item) => sum + item.contribution, 0);
  return { ...baseSummary, financial_goal_contributions, financial_goal_total, total_with_financial_goals: baseCost + financial_goal_total, scenario_duration_months: months };
}

export function nodeMissingFields(node) {
  const data = node.data || {};
  const missing = [];
  if (!String(data.name || '').trim()) missing.push('название');
  if (['task', 'decision', 'start', 'end', 'subprocess'].includes(node.type)) {
    if (node.type === 'task' && !String(data.description || '').trim()) missing.push('описание');
    if (node.type !== 'start' && !normalizePortList(data.inputs, node.id, 'input').some((item) => item.label.trim())) missing.push('вход');
    if (node.type !== 'end' && !normalizePortList(data.outputs, node.id, 'output').some((item) => item.label.trim())) missing.push('выход');
    if (node.type === 'task') {
      const assignments = data.assignments || [];
      if (!assignments.length) missing.push('задачи');
      if (assignments.some((item) => !String(item.task || '').trim())) missing.push('название задачи');
      if (assignments.some((item) => !String(item.member_id || '').trim())) missing.push('исполнитель');
      if (assignments.some((item) => !String(item.grade_id || '').trim())) missing.push('грейд');
      if (assignments.some((item) => !String(item.goal || '').trim())) missing.push('цель задачи');
      if (assignments.some((item) => !String(item.expected_result || '').trim())) missing.push('ожидаемый результат');
    }
  }
  if (node.type === 'risk') {
    if (!String(data.riskCommentary || '').trim()) missing.push('описание риска');
    if (!String(data.riskSolution || '').trim()) missing.push('решение');
  }
  return [...new Set(missing)];
}
