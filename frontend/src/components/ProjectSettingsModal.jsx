import React, { useState } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Blocks, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, Clock3, Copy, Eye, EyeOff, FileJson, FileSpreadsheet, FolderOpen, FolderPlus, GitBranch, Keyboard, Link2, ListChecks, ListTree, LogOut, Menu, MousePointer2, Palette, Plus, Save, Settings2, Share2, ShieldAlert, StickyNote, Tags, Trash2, Undo2, Upload, UserRound, Users, UsersRound, Workflow, Wrench, X, XCircle, Calculator, LayoutGrid } from 'lucide-react';
import * as Model from '../lib/processModel.js';
import { api } from '../lib/api.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function ProjectSettingsModal({ settings, goals, baseCost, durationDays, onSave, onClose }) {
  const [allocations, setAllocations] = useState(() => (settings?.financial_goal_allocations || []).map((item) => ({ ...item })));
  const activeGoals = goals.filter((goal) => goal.active);
  const addAllocation = () => {
    const assigned = new Set(allocations.map((item) => String(item.goal_id)));
    const nextGoal = activeGoals.find((goal) => !assigned.has(String(goal.id)));
    if (!nextGoal) return;
    setAllocations((items) => [...items, { id: makeId('allocation'), goal_id: nextGoal.id, rate_percent: 5 }]);
  };
  const updateAllocation = (id, patch) => setAllocations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeAllocation = (id) => setAllocations((items) => items.filter((item) => item.id !== id));
  const months = Math.max(0, Number(durationDays) || 0) / 30.4375;
  const totalContribution = allocations.reduce((sum, item) => sum + (Math.max(0, Number(baseCost) || 0) * Math.min(100, Math.max(0, Number(item.rate_percent) || 0)) / 100 * months), 0);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card project-settings-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-heading"><div><span className="eyebrow">НАСТРОЙКИ СМЕТЫ</span><h2>Финансовые цели проекта</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div>
    <div className="resource-rule"><CircleDollarSign size={16} /><span>Для каждой цели задаётся процент от базовой сметы, резервируемый <strong>за каждый календарный месяц</strong> проекта. Формула: базовая смета × ставка × длительность критического маршрута в месяцах.</span></div>
    {activeGoals.length === 0 ? <div className="empty-state-card compact"><strong>Нет активных финансовых целей</strong><p>Откройте «Ресурсы и финансовые цели» и создайте цель, например фонд зарплат C-level.</p></div> : <>
      <div className="project-allocation-list">{allocations.map((allocation) => {
        const goal = activeGoals.find((item) => String(item.id) === String(allocation.goal_id));
        const rate = Math.min(100, Math.max(0, Number(allocation.rate_percent) || 0));
        const monthly = (Math.max(0, Number(baseCost) || 0) * rate / 100);
        const otherAssigned = new Set(allocations.filter((item) => item.id !== allocation.id).map((item) => String(item.goal_id)));
        return <div className="project-allocation-row" key={allocation.id}>
          <label className="field-label">Финансовая цель<select value={allocation.goal_id || ''} onChange={(event) => updateAllocation(allocation.id, { goal_id: event.target.value })}>{goal ? <option value={goal.id}>{goal.name}</option> : null}{activeGoals.filter((item) => String(item.id) === String(allocation.goal_id) || !otherAssigned.has(String(item.id))).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="field-label allocation-rate">% в месяц<input type="number" min="0" max="100" step="0.25" value={allocation.rate_percent ?? 0} onChange={(event) => updateAllocation(allocation.id, { rate_percent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /></label>
          <div className="allocation-preview"><small>В месяц</small><strong>{RUB.format(monthly)} ₽</strong><small>За процесс ≈ {RUB.format(monthly * months)} ₽</small></div>
          <button className="icon-button danger-quiet" title="Удалить начисление" onClick={() => removeAllocation(allocation.id)}><Trash2 size={15} /></button>
        </div>;
      })}</div>
      <button className="button secondary" onClick={addAllocation} disabled={allocations.length >= activeGoals.length}><Plus size={15} /> Добавить финансовую цель</button>
    </>}
    <div className="allocation-summary"><div><small>Базовая смета</small><strong>{RUB.format(baseCost || 0)} ₽</strong></div><div><small>Календарная длительность</small><strong>{HOURS.format(durationDays || 0)} дн. · {HOURS.format(months)} мес.</strong></div><div><small>Дополнительный резерв по цели</small><strong>{RUB.format(totalContribution)} ₽</strong></div></div>
    <p className="field-help">Резерв добавляется поверх базовой внутренней себестоимости. Это плановое начисление: оно само по себе не переводит деньги и не подтверждает факт пополнения счёта.</p>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>Отмена</button><button className="button primary" onClick={() => onSave({ financial_goal_allocations: allocations.map((item) => ({ ...item, rate_percent: Math.min(100, Math.max(0, Number(item.rate_percent) || 0)) })) })}><Save size={15} /> Сохранить настройки</button></div>
  </div></div>;
}
