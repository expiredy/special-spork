import React from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Blocks, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, Clock3, Copy, Eye, EyeOff, FileJson, FileSpreadsheet, FolderOpen, FolderPlus, GitBranch, Keyboard, Link2, ListChecks, ListTree, LogOut, Menu, MousePointer2, Palette, Plus, Save, Settings2, Share2, ShieldAlert, StickyNote, Tags, Trash2, Undo2, Upload, UserRound, Users, UsersRound, Workflow, Wrench, X, XCircle, Calculator, LayoutGrid } from 'lucide-react';
import * as Model from '../lib/processModel.js';
import { api } from '../lib/api.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function CostPreviewSidebar({ nodes, team, tools, roleGrades, summary, currency, onClose }) {
  const teamById = Object.fromEntries(team.map((item) => [String(item.id), item]));
  const toolsById = Object.fromEntries(tools.map((item) => [String(item.id), item]));
  const gradesById = Object.fromEntries(roleGrades.map((item) => [String(item.id), item]));
  const costed = nodes.filter((node) => !['group', 'sticker', 'risk'].includes(node.type)).map((node) => ({ node, metric: getNodeCost(node, teamById, toolsById, gradesById) }));
  const goalContributions = summary.financial_goal_contributions || [];
  const goalTotal = Number(summary.financial_goal_total) || 0;
  return <aside className="cost-preview-sidebar">
    <div className="inspector-top"><div><span className="eyebrow">LIVE ESTIMATE</span><h3>Предпросмотр сметы</h3></div><button className="icon-button" onClick={onClose} title="Закрыть смету"><X size={16} /></button></div>
    <div className="estimate-total"><span>Базовая смета · самый дорогой сценарий</span><strong>{RUB.format(summary.cost)} {currency === 'RUB' ? '₽' : currency}</strong><small>{HOURS.format(summary.hours)} ч трудоёмкости · {RUB.format(summary.laborCost || 0)} труд · {RUB.format(summary.toolCost || 0)} инструменты</small></div>
    <div className="estimate-note">Альтернативы не суммируются: для базовой сметы выбирается самый дорогой маршрут. Инструменты распределяются по календарным дням этапа.</div>
    {goalContributions.length > 0 && <div className="estimate-goal-section"><div className="section-divider"><span>Финансовые цели</span><strong>{RUB.format(goalTotal)} {currency === 'RUB' ? '₽' : currency}</strong></div>{goalContributions.map((goal) => <div className="estimate-goal-row" key={goal.goal_id}><div><strong>{goal.goal_name}</strong><small>{HOURS.format(goal.rate_percent)}% сметы в месяц · {HOURS.format(goal.months)} мес.</small></div><div><strong>{RUB.format(goal.monthly_contribution)} {goal.currency || currency}</strong><small>≈ {RUB.format(goal.contribution)} за процесс</small></div></div>)}</div>}
    <div className="estimate-step-list">{costed.map(({ node, metric }) => <div className="estimate-step-row" key={node.id}>
      <div className="estimate-step-heading"><span className={`estimate-type-dot estimate-${node.type}`} /> <strong>{node.data?.name || 'Без названия'}</strong></div>
      <div className="estimate-row-breakdown"><span>Труд · {HOURS.format(metric.hours)} ч</span><strong>{RUB.format(metric.laborCost)} {currency}</strong></div>
      <div className="estimate-row-breakdown"><span>Инструменты</span><strong>{RUB.format(metric.toolCost)} {currency}</strong></div>
      <div className="estimate-row-total"><span>Себестоимость этапа</span><strong>{RUB.format(metric.cost)} {currency}</strong></div>
    </div>)}</div>
    <div className="estimate-bottom"><span>Все этапы с альтернативами</span><strong>{RUB.format(costed.reduce((sum, item) => sum + item.metric.cost, 0))} {currency}</strong><span>Итого с финансовыми целями</span><strong>{RUB.format(summary.total_with_financial_goals ?? summary.cost)} {currency}</strong></div>
  </aside>;
}
