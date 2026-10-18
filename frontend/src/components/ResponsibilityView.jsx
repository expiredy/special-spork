import React from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Blocks, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, Clock3, Copy, Eye, EyeOff, FileJson, FileSpreadsheet, FolderOpen, FolderPlus, GitBranch, Keyboard, Link2, ListChecks, ListTree, LogOut, Menu, MousePointer2, Palette, Plus, Save, Settings2, Share2, ShieldAlert, StickyNote, Tags, Trash2, Undo2, Upload, UserRound, Users, UsersRound, Workflow, Wrench, X, XCircle, Calculator, LayoutGrid } from 'lucide-react';
import * as Model from '../lib/processModel.js';
import { api } from '../lib/api.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function ResponsibilityView({ nodes, team, roleGrades, onPatchAssignment, onOpenNode }) {
  const lanes = new Map();
  const stageNodes = nodes.filter((node) => !['start', 'end', 'sticker', 'risk', 'group'].includes(node.type));
  for (const node of stageNodes) {
    const assignments = node.data?.assignments || [];
    if (!assignments.length) {
      const key = 'Без исполнителя';
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push({ node, assignment: { task: 'Задачи не добавлены', hours: 0 }, index: -1, placeholder: true });
    }
    assignments.forEach((assignment, index) => {
      const person = team.find((member) => String(member.id) === String(assignment.member_id));
      const laneName = person?.role || assignment.role || (person ? person.name : 'Без исполнителя');
      if (!lanes.has(laneName)) lanes.set(laneName, []);
      lanes.get(laneName).push({ node, assignment, index, person });
    });
  }
  const roleGradeOptions = roleGrades;
  return <div className="responsibility-board">
    <div className="responsibility-board-heading"><div><span className="eyebrow">BPMN-INSPIRED VIEW</span><h2>Зоны ответственности</h2><p>Представление генерируется из задач этапов. Правки в карточках синхронизируются с исходными узлами процесса.</p></div><span className="autogen-badge"><CheckCircle2 size={13} /> Автогенерация из canvas</span></div>
    {[...lanes.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([laneName, items]) => <section className="responsibility-lane" key={laneName}>
      <div className="responsibility-lane-label"><div className="lane-icon"><UsersRound size={16} /></div><div><strong>{laneName}</strong><small>{items.length} задач</small></div></div>
      <div className="responsibility-lane-content">{items.sort((a, b) => (a.node.position?.x || 0) - (b.node.position?.x || 0)).map(({ node, assignment, index, placeholder, person }) => {
        const patch = (value) => index >= 0 && onPatchAssignment(node.id, index, value);
        const activeRole = person?.role || assignment.role || '';
        const availableGrades = roleGradeOptions.filter((grade) => !activeRole || grade.role.toLowerCase() === activeRole.toLowerCase());
        return <article className={`responsibility-task-card ${placeholder ? 'is-placeholder' : ''}`} key={`${node.id}-${index}`}>
          <button className="responsibility-stage-link" onClick={() => onOpenNode(node.id)} title="Открыть исходный этап"><span>{node.data?.name || 'Этап без названия'}</span><ChevronDown size={12} /></button>
          {placeholder ? <div className="responsibility-no-task">Задачи пока не распределены по исполнителям.</div> : <>
            <label className="compact-field">Задача<input value={assignment.task || ''} onChange={(e) => patch({ task: e.target.value })} placeholder="Название задачи" /></label>
            <label className="compact-field">Цель<input value={assignment.goal || ''} onChange={(e) => patch({ goal: e.target.value })} placeholder="Цель" /></label>
            <label className="compact-field">Результат<textarea rows="2" value={assignment.expected_result || ''} onChange={(e) => patch({ expected_result: e.target.value })} placeholder="Ожидаемый результат" /></label>
            <div className="responsibility-assignment-row"><select value={assignment.member_id || ''} onChange={(e) => { const member = team.find((item) => item.id === e.target.value); patch({ member_id: e.target.value, role: member?.role || '', name: member?.name || '', grade_id: defaultGradeForRole(member?.role, roleGrades)?.id || '' }); }}><option value="">Исполнитель</option>{team.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select><div className="hours-input"><input type="number" min="0" step="0.5" aria-label="Оценка часов" value={assignment.hours ?? 0} onChange={(e) => patch({ hours: Number(e.target.value) })} /><span>ч</span></div></div>
            <select className="responsibility-grade" value={assignment.grade_id || ''} onChange={(e) => patch({ grade_id: e.target.value })}><option value="">Выберите грейд</option>{availableGrades.map((grade) => <option value={grade.id} key={grade.id}>{grade.grade} · {RUB.format(grade.hourly_rate)} {grade.currency}/ч</option>)}</select>
            {(assignment.tags || []).length > 0 && <div className="node-tag-list">{assignment.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          </>}
        </article>;
      })}</div>
    </section>)}
    {lanes.size === 0 && <div className="soft-note">Добавьте задачи в этапы — здесь автоматически появятся полосы ответственности.</div>}
  </div>;
}
