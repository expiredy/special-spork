import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Blocks, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, Clock3, Copy, Eye, EyeOff, FileJson, FileSpreadsheet, FolderOpen, FolderPlus, GitBranch, Keyboard, Link2, ListChecks, ListTree, LogOut, Menu, MousePointer2, Palette, Plus, Save, Settings2, Share2, ShieldAlert, StickyNote, Tags, Trash2, Undo2, Upload, UserRound, Users, UsersRound, Workflow, Wrench, X, XCircle, Calculator, LayoutGrid } from 'lucide-react';
import * as Model from '../lib/processModel.js';
import { api } from '../lib/api.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function TeamPage({ team, reloadTeam, tools, reloadTools, roleGrades, reloadRoleGrades, financialGoals, reloadFinancialGoals, activeTab = 'team', onTabChange = () => {} }) {
  const [tab, setTab] = useState(activeTab);
  useEffect(() => { setTab(activeTab); }, [activeTab]);
  const switchTab = (nextTab) => { setTab(nextTab); setError(''); onTabChange(nextTab); };
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: '', role: '', active: true });
  const [toolEditingId, setToolEditingId] = useState(null);
  const [toolDraft, setToolDraft] = useState({ name: '', description: '', monthly_price: 0, currency: 'RUB', active: true });
  const [gradeEditingId, setGradeEditingId] = useState(null);
  const [gradeDraft, setGradeDraft] = useState({ role: '', grade: '', hourly_rate: 0, currency: 'RUB', is_default: false });
  const [goalEditingId, setGoalEditingId] = useState(null);
  const [goalDraft, setGoalDraft] = useState({ name: '', description: '', target_monthly_amount: 500000, opening_balance: 0, currency: 'RUB', active: true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const roles = [...new Set(roleGrades.map((item) => String(item.role || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const gradesByRole = new Map();
  roleGrades.forEach((grade) => {
    const key = grade.role || 'Без роли';
    if (!gradesByRole.has(key)) gradesByRole.set(key, []);
    gradesByRole.get(key).push(grade);
  });
  const startNew = () => { setEditingId('new'); setDraft({ name: '', role: roles[0] || '', active: true }); setError(''); };
  const startEdit = (member) => { setEditingId(member.id); setDraft({ name: member.name, role: member.role, active: member.active }); setError(''); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      if (!draft.name.trim()) throw new Error('Введите имя участника.');
      if (!draft.role || !roles.some((role) => role.toLowerCase() === draft.role.toLowerCase())) throw new Error('Сначала выберите роль, у которой настроен хотя бы один грейд.');
      const payload = { name: draft.name.trim(), role: draft.role, active: Boolean(draft.active) };
      if (editingId === 'new') await api('/api/team', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/api/team/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setEditingId(null); await reloadTeam();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const removeMember = async (member) => {
    if (!window.confirm(`Удалить участника «${member.name}»? Задачи в процессах сохранятся, но потребуют нового исполнителя.`)) return;
    try { await api(`/api/team/${member.id}`, { method: 'DELETE' }); await reloadTeam(); } catch (err) { setError(err.message); }
  };
  const saveTool = async () => {
    setSaving(true); setError('');
    try {
      if (!toolDraft.name.trim()) throw new Error('Введите название инструмента.');
      const payload = { ...toolDraft, monthly_price: Number(toolDraft.monthly_price) || 0 };
      if (toolEditingId === 'new') await api('/api/tools', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/api/tools/${toolEditingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setToolEditingId(null); await reloadTools();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const removeTool = async (tool) => { if (!window.confirm(`Удалить инструмент «${tool.name}»?`)) return; try { await api(`/api/tools/${tool.id}`, { method: 'DELETE' }); await reloadTools(); } catch (err) { setError(err.message); } };
  const saveGrade = async () => {
    setSaving(true); setError('');
    try {
      if (!gradeDraft.role.trim() || !gradeDraft.grade.trim()) throw new Error('Укажите название роли и грейда.');
      const existsForRole = roleGrades.some((item) => item.id !== gradeEditingId && item.role.toLowerCase() === gradeDraft.role.trim().toLowerCase());
      const payload = { ...gradeDraft, role: gradeDraft.role.trim(), grade: gradeDraft.grade.trim(), hourly_rate: Number(gradeDraft.hourly_rate) || 0, is_default: Boolean(gradeDraft.is_default) || !existsForRole };
      if (gradeEditingId === 'new') await api('/api/roles/grades', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/api/roles/grades/${gradeEditingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setGradeEditingId(null); await reloadRoleGrades(); await reloadTeam();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const removeGrade = async (grade) => {
    if (!window.confirm(`Удалить грейд «${grade.role} / ${grade.grade}»? Если он используется в задачах, в них будет выбран дефолтный грейд роли.`)) return;
    try { await api(`/api/roles/grades/${grade.id}`, { method: 'DELETE' }); await reloadRoleGrades(); } catch (err) { setError(err.message); }
  };
  const makeDefault = async (grade) => {
    try { await api(`/api/roles/grades/${grade.id}`, { method: 'PUT', body: JSON.stringify({ ...grade, is_default: true }) }); await reloadRoleGrades(); }
    catch (err) { setError(err.message); }
  };
  const saveGoal = async () => {
    setSaving(true); setError('');
    try {
      if (!goalDraft.name.trim()) throw new Error('Введите название финансовой цели.');
      const payload = { ...goalDraft, target_monthly_amount: Number(goalDraft.target_monthly_amount) || 0, opening_balance: Number(goalDraft.opening_balance) || 0 };
      if (goalEditingId === 'new') await api('/api/financial-goals', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/api/financial-goals/${goalEditingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setGoalEditingId(null); await reloadFinancialGoals();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const removeGoal = async (goal) => { if (!window.confirm(`Удалить финансовую цель «${goal.name}»?`)) return; try { await api(`/api/financial-goals/${goal.id}`, { method: 'DELETE' }); await reloadFinancialGoals(); } catch (err) { setError(err.message); } };
  const openNewGrade = (role = '') => { setGradeEditingId('new'); setGradeDraft({ role, grade: '', hourly_rate: 0, currency: 'RUB', is_default: !role || !roles.includes(role) }); setError(''); };
  return <div className="team-page resource-page">
    <div className="page-heading"><div><span className="eyebrow">СПРАВОЧНИКИ И СТАВКИ</span><h1>Ресурсы и финансовые цели</h1><p>У сотрудника нет собственной ставки: стоимость назначается только грейду роли. Финансовые цели позволяют отдельно резервировать часть бюджета каждого проекта.</p></div>
      {tab === 'team' ? <button className="button primary" onClick={roles.length ? startNew : () => openNewGrade()}><Plus size={16} /> Добавить участника</button> : tab === 'tools' ? <button className="button primary" onClick={() => { setToolEditingId('new'); setToolDraft({ name: '', description: '', monthly_price: 0, currency: 'RUB', active: true }); }}><Plus size={16} /> Добавить инструмент</button> : <button className="button primary" onClick={() => { setGoalEditingId('new'); setGoalDraft({ name: '', description: '', target_monthly_amount: 500000, opening_balance: 0, currency: 'RUB', active: true }); }}><Plus size={16} /> Добавить цель</button>}
    </div>
    <div className="resource-tabs">
      <button className={tab === 'team' ? 'active' : ''} onClick={() => switchTab('team')}><Users size={15} /> Команда и грейды</button>
      <button className={tab === 'tools' ? 'active' : ''} onClick={() => switchTab('tools')}><Wrench size={15} /> Инструменты</button>
      <button className={tab === 'goals' ? 'active' : ''} onClick={() => switchTab('goals')}><CircleDollarSign size={15} /> Фин. цели</button>
    </div>
    {team.some((member) => member.is_demo) && <div className="demo-banner"><Activity size={17} /><span><strong>В команде есть демонстрационные участники.</strong> Замените их реальными сотрудниками перед использованием рабочих смет.</span></div>}
    {error && <div className="error-banner">{error}</div>}
    {tab === 'team' && <>
      <div className="resource-rule"><Users size={16} /><span><strong>Команда</strong> — реальные исполнители. Роль выбирается из уже настроенных ролей, собственная ставка сотрудника не задаётся.</span></div>
      <div className="team-table-wrap"><table className="team-table"><thead><tr><th>Участник</th><th>Роль</th><th>Доступность</th><th></th></tr></thead><tbody>
        {team.map((member) => <tr key={member.id}><td><strong>{member.name}</strong>{member.is_demo && <span className="demo-pill">ДЕМО</span>}</td><td>{member.role || '—'}</td><td><span className={`status-pill ${member.active ? 'status-active' : 'status-inactive'}`}>{member.active ? 'Активен' : 'Неактивен'}</span></td><td className="row-actions"><button className="button small secondary" onClick={() => startEdit(member)}>Изменить</button><button className="icon-button danger-quiet" title="Удалить участника" onClick={() => removeMember(member)}><Trash2 size={15} /></button></td></tr>)}
        {team.length === 0 && <tr><td colSpan="4" className="empty-table">Команда пока пустая. Добавьте участника после настройки хотя бы одной роли и её грейда.</td></tr>}
      </tbody></table></div>
      <div className="section-heading-row"><div><h2>Роли и грейды</h2><p>Ставка определяется грейдом. Первый грейд новой роли становится дефолтным; его можно изменить.</p></div><button className="button secondary" onClick={() => openNewGrade()}><Plus size={15} /> Добавить грейд</button></div>
      <div className="team-table-wrap"><table className="team-table"><thead><tr><th>Роль</th><th>Грейд</th><th>Внутренняя ставка</th><th>По умолчанию</th><th></th></tr></thead><tbody>
        {roleGrades.map((grade) => <tr key={grade.id}><td><strong>{grade.role}</strong></td><td>{grade.grade}</td><td><strong>{RUB.format(grade.hourly_rate)} {grade.currency}/ч</strong></td><td>{grade.is_default ? <span className="status-pill status-active">Дефолтный</span> : <button className="text-button" onClick={() => makeDefault(grade)}>Сделать дефолтным</button>}</td><td className="row-actions"><button className="button small secondary" onClick={() => { setGradeEditingId(grade.id); setGradeDraft({ ...grade }); }}>Изменить</button><button className="icon-button danger-quiet" title="Удалить грейд" onClick={() => removeGrade(grade)}><Trash2 size={15} /></button></td></tr>)}
        {roleGrades.length === 0 && <tr><td colSpan="5" className="empty-table">Добавьте первую роль и грейд — без него нельзя назначать стоимость задаче.</td></tr>}
      </tbody></table></div>
    </>}
    {tab === 'tools' && <><div className="resource-rule"><Wrench size={16} /><span>Инструмент назначается этапу. В смету входит доля месячной лицензии: <strong>цена за месяц × календарные дни этапа / 30,4375</strong>.</span></div><div className="team-table-wrap"><table className="team-table"><thead><tr><th>Инструмент</th><th>Описание</th><th>Цена в месяц</th><th>Статус</th><th></th></tr></thead><tbody>{tools.map((tool) => <tr key={tool.id}><td><strong>{tool.name}</strong></td><td>{tool.description || '—'}</td><td><strong>{RUB.format(tool.monthly_price)} {tool.currency}</strong></td><td><span className={`status-pill ${tool.active ? 'status-active' : 'status-inactive'}`}>{tool.active ? 'Активен' : 'Неактивен'}</span></td><td className="row-actions"><button className="button small secondary" onClick={() => { setToolEditingId(tool.id); setToolDraft({ ...tool }); }}>Изменить</button><button className="icon-button danger-quiet" title="Удалить инструмент" onClick={() => removeTool(tool)}><Trash2 size={15} /></button></td></tr>)}{tools.length === 0 && <tr><td colSpan="5" className="empty-table">Инструментов пока нет.</td></tr>}</tbody></table></div></>}
    {tab === 'goals' && <>
      <div className="resource-rule"><CircleDollarSign size={16} /><span>Финансовая цель — внутренний плановый фонд, не банковский счёт и не движение денег. В настройках процесса задаётся процент базовой сметы, резервируемый за каждый календарный месяц проекта.</span></div>
      <div className="financial-goal-grid">{financialGoals.map((goal) => <article className="financial-goal-card" key={goal.id}>
        <div className="financial-goal-card-heading"><div><strong>{goal.name}</strong>{goal.is_demo && <span className="demo-pill">ДЕМО</span>}<small>{goal.description || 'Без описания'}</small></div><span className={`status-pill ${goal.active ? 'status-active' : 'status-inactive'}`}>{goal.active ? 'Активна' : 'Пауза'}</span></div>
        <div className="financial-goal-kpis"><div><small>Цель в месяц</small><strong>{RUB.format(goal.target_monthly_amount)} {goal.currency}</strong></div><div><small>План пополнения / мес.</small><strong>{RUB.format(goal.planned_monthly_contributions || 0)} {goal.currency}</strong></div><div><small>Расчётно за все проекты</small><strong>{RUB.format(goal.planned_contributions || 0)} {goal.currency}</strong></div></div>
        <div className="goal-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, goal.planned_coverage_percent || 0))}%` }} /></div><div className="goal-progress-copy"><span>Покрытие месячной цели</span><strong>{Number(goal.planned_coverage_percent || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</strong></div>
        <div className="financial-goal-card-actions"><button className="button small secondary" onClick={() => { setGoalEditingId(goal.id); setGoalDraft({ ...goal }); }}>Изменить</button><button className="icon-button danger-quiet" title="Удалить финансовую цель" onClick={() => removeGoal(goal)}><Trash2 size={15} /></button></div>
      </article>)}{financialGoals.length === 0 && <div className="empty-state-card"><CircleDollarSign size={25} /><strong>Финансовых целей пока нет</strong><p>Создайте, например, «Фонд зарплат C-level» с целью 500 000 ₽ в месяц.</p></div>}</div>
    </>}
    {editingId && <div className="modal-backdrop" onClick={() => setEditingId(null)}><div className="modal-card" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">КАРТОЧКА УЧАСТНИКА</span><h2>{editingId === 'new' ? 'Новый участник' : 'Редактирование'}</h2></div><button className="icon-button" onClick={() => setEditingId(null)}><X size={17} /></button></div>
      <label className="field-label">Имя участника<input autoFocus value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Например, Мария" /></label>
      <label className="field-label">Роль<select value={draft.role || ''} onChange={(e) => setDraft({ ...draft, role: e.target.value })}><option value="">Выберите роль</option>{roles.map((role) => <option value={role} key={role}>{role}</option>)}</select></label>
      {roles.length === 0 && <div className="warning-banner">Сначала создайте роль и её первый грейд — только после этого можно добавить участника.</div>}
      <label className="checkbox-label"><input type="checkbox" checked={Boolean(draft.active)} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Участник активен</label>
      {error && <div className="error-banner">{error}</div>}<div className="modal-actions"><button className="button secondary" onClick={() => setEditingId(null)}>Отмена</button><button className="button primary" disabled={saving || roles.length === 0} onClick={save}><Save size={15} /> {saving ? 'Сохраняем…' : 'Сохранить'}</button></div></div></div>}
    {toolEditingId && <div className="modal-backdrop" onClick={() => setToolEditingId(null)}><div className="modal-card" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">КАТАЛОГ РЕСУРСОВ</span><h2>{toolEditingId === 'new' ? 'Новый инструмент' : 'Редактирование инструмента'}</h2></div><button className="icon-button" onClick={() => setToolEditingId(null)}><X size={17} /></button></div>
      <label className="field-label">Название<input autoFocus value={toolDraft.name || ''} onChange={(e) => setToolDraft({ ...toolDraft, name: e.target.value })} placeholder="Figma, Tilda, Notion…" /></label><label className="field-label">Описание<textarea rows="2" value={toolDraft.description || ''} onChange={(e) => setToolDraft({ ...toolDraft, description: e.target.value })} placeholder="Для чего используем" /></label><div className="two-col-fields"><label className="field-label">Цена в месяц<input type="number" min="0" value={toolDraft.monthly_price ?? 0} onChange={(e) => setToolDraft({ ...toolDraft, monthly_price: e.target.value })} /></label><label className="field-label">Валюта<select value={toolDraft.currency || 'RUB'} onChange={(e) => setToolDraft({ ...toolDraft, currency: e.target.value })}><option value="RUB">RUB · ₽</option><option value="EUR">EUR · €</option><option value="USD">USD · $</option><option value="SEK">SEK · kr</option></select></label></div><label className="checkbox-label"><input type="checkbox" checked={Boolean(toolDraft.active)} onChange={(e) => setToolDraft({ ...toolDraft, active: e.target.checked })} /> Инструмент активен</label><div className="modal-actions"><button className="button secondary" onClick={() => setToolEditingId(null)}>Отмена</button><button className="button primary" disabled={saving} onClick={saveTool}><Save size={15} /> Сохранить</button></div></div></div>}
    {gradeEditingId && <div className="modal-backdrop" onClick={() => setGradeEditingId(null)}><div className="modal-card" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">ЕДИНЫЙ СПРАВОЧНИК РОЛЕЙ</span><h2>{gradeEditingId === 'new' ? 'Новая роль / грейд' : 'Редактирование грейда'}</h2></div><button className="icon-button" onClick={() => setGradeEditingId(null)}><X size={17} /></button></div>
      <label className="field-label">Роль<input list="flowcost-role-options" autoFocus value={gradeDraft.role || ''} onChange={(e) => setGradeDraft({ ...gradeDraft, role: e.target.value, is_default: !roleGrades.some((item) => item.role.toLowerCase() === e.target.value.trim().toLowerCase()) })} placeholder="Например, Дизайнер" /><datalist id="flowcost-role-options">{roles.map((role) => <option value={role} key={role} />)}</datalist></label>
      <label className="field-label">Грейд<input value={gradeDraft.grade || ''} onChange={(e) => setGradeDraft({ ...gradeDraft, grade: e.target.value })} placeholder="Junior / Middle / Senior" /></label>
      <div className="two-col-fields"><label className="field-label">Ставка за час<input type="number" min="0" step="50" value={gradeDraft.hourly_rate ?? 0} onChange={(e) => setGradeDraft({ ...gradeDraft, hourly_rate: e.target.value })} /></label><label className="field-label">Валюта<select value={gradeDraft.currency || 'RUB'} onChange={(e) => setGradeDraft({ ...gradeDraft, currency: e.target.value })}><option value="RUB">RUB · ₽</option><option value="EUR">EUR · €</option><option value="USD">USD · $</option><option value="SEK">SEK · kr</option></select></label></div>
      <label className="checkbox-label"><input type="checkbox" checked={Boolean(gradeDraft.is_default)} onChange={(e) => setGradeDraft({ ...gradeDraft, is_default: e.target.checked })} /> Использовать по умолчанию для новых задач этой роли</label>
      <p className="field-help">У каждой роли должен быть один дефолтный грейд. Если роль новая, первый грейд автоматически станет дефолтным.</p>
      <div className="modal-actions"><button className="button secondary" onClick={() => setGradeEditingId(null)}>Отмена</button><button className="button primary" disabled={saving} onClick={saveGrade}><Save size={15} /> Сохранить</button></div></div></div>}
    {goalEditingId && <div className="modal-backdrop" onClick={() => setGoalEditingId(null)}><div className="modal-card" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">ПЛАНОВЫЙ ФОНД КОМПАНИИ</span><h2>{goalEditingId === 'new' ? 'Новая финансовая цель' : 'Редактирование цели'}</h2></div><button className="icon-button" onClick={() => setGoalEditingId(null)}><X size={17} /></button></div>
      <label className="field-label">Название цели<input autoFocus value={goalDraft.name || ''} onChange={(e) => setGoalDraft({ ...goalDraft, name: e.target.value })} placeholder="Фонд зарплат C-level" /></label><label className="field-label">Описание<textarea rows="2" value={goalDraft.description || ''} onChange={(e) => setGoalDraft({ ...goalDraft, description: e.target.value })} placeholder="На что нужен резерв" /></label>
      <div className="two-col-fields"><label className="field-label">Цель на месяц<input type="number" min="0" value={goalDraft.target_monthly_amount ?? 0} onChange={(e) => setGoalDraft({ ...goalDraft, target_monthly_amount: e.target.value })} /></label><label className="field-label">Стартовый баланс<input type="number" min="0" value={goalDraft.opening_balance ?? 0} onChange={(e) => setGoalDraft({ ...goalDraft, opening_balance: e.target.value })} /></label></div>
      <label className="field-label">Валюта<select value={goalDraft.currency || 'RUB'} onChange={(e) => setGoalDraft({ ...goalDraft, currency: e.target.value })}><option value="RUB">RUB · ₽</option><option value="EUR">EUR · €</option><option value="USD">USD · $</option><option value="SEK">SEK · kr</option></select></label><label className="checkbox-label"><input type="checkbox" checked={Boolean(goalDraft.active)} onChange={(e) => setGoalDraft({ ...goalDraft, active: e.target.checked })} /> Цель активна для новых смет</label>
      <div className="modal-actions"><button className="button secondary" onClick={() => setGoalEditingId(null)}>Отмена</button><button className="button primary" disabled={saving} onClick={saveGoal}><Save size={15} /> Сохранить</button></div></div></div>}
  </div>;
}
