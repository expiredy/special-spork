import React from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Blocks, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, Clock3, Copy, Eye, EyeOff, FileJson, FileSpreadsheet, FolderOpen, FolderPlus, GitBranch, Keyboard, Link2, ListChecks, ListTree, LogOut, Menu, MousePointer2, Palette, Plus, Save, Settings2, Share2, ShieldAlert, StickyNote, Tags, Trash2, Undo2, Ungroup, Upload, UserRound, Users, UsersRound, Workflow, Wrench, X, XCircle, Calculator, LayoutGrid } from 'lucide-react';
import * as Model from '../lib/processModel.js';
import { api } from '../lib/api.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function NodeEditor({ node, nodes, edges, team, tools, roleGrades, onChange, onDelete, onAddAssignment, onPatchAssignment, onRemoveAssignment, onPatchEdge, onPatchPort, onAddPort, onRemovePort, onRemoveConnection, onClose, onUngroup }) {
  if (!node) return <aside className="inspector empty-inspector"><div className="inspector-empty-icon"><Settings2 size={23} /></div><strong>Выберите элемент на холсте</strong><p>Здесь появятся описание, входы и выходы, задачи, оценки, риски и чек-листы.</p><div className="hint-box">Перетаскивайте связь от выхода одного узла к входу другого, чтобы синхронизировать данные.</div></aside>;
  const data = node.data || {};
  const outEdges = edges.filter((edge) => edge.source === node.id && !isDataFlowEdge(edge));
  const inPorts = normalizePortList(data.inputs, node.id, 'input');
  const outPorts = normalizePortList(data.outputs, node.id, 'output');
  const update = (field, value) => onChange({ ...data, [field]: value });
  const selectedTypeLabel = TYPE_LABELS[node.type] || node.type;
  const linkedInput = (portId) => edges.find((edge) => isDataFlowEdge(edge) && edge.target === node.id && edge.targetHandle === `in-${portId}`);
  const style = colorStyle(data, node.type === 'risk' ? 'red' : node.type === 'sticker' ? 'yellow' : 'slate');
  return (
    <aside className="inspector">
      <div className="inspector-top"><div><span className="eyebrow">НАСТРОЙКА ЭЛЕМЕНТА</span><h3>{selectedTypeLabel}</h3></div><button className="icon-button" onClick={onClose} title="Закрыть"><X size={16} /></button></div>
      <label className="field-label">{node.type === 'sticker' ? 'Заголовок заметки' : node.type === 'group' ? 'Название группы' : 'Название'}<input value={data.name || ''} onChange={(e) => update('name', e.target.value)} placeholder="Название элемента" /></label>
      <div className="palette-section"><div className="section-caption"><Palette size={13} /> Цвет элемента</div><div className="color-palette">{COLOR_PRESETS.map((color) => <button type="button" key={color.id} className={`color-swatch ${(data.colorPreset || DEFAULT_COLOR_BY_TYPE[node.type] || 'slate') === color.id ? 'active' : ''}`} style={{ background: color.bg, borderColor: color.border }} title={color.name} aria-label={color.name} onClick={() => update('colorPreset', color.id)} />)}</div></div>
      {node.type === 'group' ? <>
        <label className="field-label">Описание группы<textarea rows="3" value={data.description || ''} onChange={(e) => update('description', e.target.value)} placeholder="Какие этапы объединены и зачем?" /></label>
        <div className="hint-box">Группа объединяет элементы для удобства на холсте. Выберите несколько этапов с помощью Shift, затем нажмите Ctrl+G. Группа не влияет на расчёт стоимости.</div>
        <div className="inspector-actions"><button className="button secondary" onClick={onUngroup}><Ungroup size={15} /> Разгруппировать</button></div>
      </> : node.type === 'sticker' ? <>
        <label className="field-label">Заметка / идея<textarea rows="8" value={data.description || ''} onChange={(e) => update('description', e.target.value)} placeholder="Черновая мысль, вопрос, гипотеза…" /></label>
        <div className="hint-box">Стикер — свободная заметка для мозгового штурма. Он не влияет на стоимость и трудоёмкость процесса.</div>
        <div className="inspector-actions"><button className="button subtle-danger" onClick={onDelete}><Trash2 size={15} /> Удалить заметку</button></div>
      </> : <>
        {node.type === 'risk' ? <>
          <label className="field-label">Комментарий / описание риска<textarea rows="4" value={data.riskCommentary || ''} onChange={(e) => update('riskCommentary', e.target.value)} placeholder="Что может пойти не так, почему и на что повлияет?" /></label>
          <label className="field-label">Возможное решение<textarea rows="4" value={data.riskSolution || ''} onChange={(e) => update('riskSolution', e.target.value)} placeholder="Как снизить вероятность или влияние риска?" /></label>
          <label className="field-label">Уровень риска<select value={data.riskSeverity || 'high'} onChange={(e) => update('riskSeverity', e.target.value)}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></label>
        </> : <label className="field-label">Описание<textarea rows="3" value={data.description || ''} onChange={(e) => update('description', e.target.value)} placeholder="Что конкретно происходит на этом шаге?" /></label>}
        {node.type !== 'risk' && <>
        <div className="port-editor-section">
          <div className="section-divider"><span>Входные данные</span><button className="text-button" onClick={() => onAddPort('inputs')}><Plus size={13} /> Добавить</button></div>
          <p className="field-help">Вход может быть связан с выходом другого элемента. Название связанного входа будет синхронизироваться автоматически.</p>
          {inPorts.map((port) => {
            const edge = linkedInput(port.id);
            const sourceNode = edge && nodes.find((item) => item.id === edge.source);
            const sourcePort = edge && sourceNode && normalizePortList(sourceNode.data?.outputs, sourceNode.id, 'output').find((item) => item.id === String(edge.sourceHandle || '').replace(/^out-/, ''));
            return <div className={`port-edit-row ${edge ? 'linked' : ''}`} key={port.id}>
              <input value={edge ? (sourcePort?.label || port.label || '') : port.label} disabled={Boolean(edge)} onChange={(e) => onPatchPort('inputs', port.id, e.target.value)} placeholder="Например, согласованный бриф" />
              {edge ? <div className="port-link-meta">↖ {sourceNode?.data?.name || 'Связанный элемент'}{sourcePort?.label ? ` · ${sourcePort.label}` : ''}<button className="icon-button tiny danger-quiet" title="Разорвать связь" onClick={() => onRemoveConnection(edge.id)}><X size={12} /></button></div> : null}
              {!edge && <button className="icon-button tiny danger-quiet" title="Удалить вход" onClick={() => onRemovePort('inputs', port.id)}><Trash2 size={12} /></button>}
            </div>;
          })}
          {inPorts.length === 0 && <div className="soft-note">Входные данные не указаны.</div>}
        </div>
        <div className="port-editor-section">
          <div className="section-divider"><span>Результаты / выходы</span><button className="text-button" onClick={() => onAddPort('outputs')}><Plus size={13} /> Добавить</button></div>
          {outPorts.map((port) => <div className="port-edit-row" key={port.id}><input value={port.label} onChange={(e) => onPatchPort('outputs', port.id, e.target.value)} placeholder="Например, прототип согласован" /><button className="icon-button tiny danger-quiet" title="Удалить выход" onClick={() => onRemovePort('outputs', port.id)}><Trash2 size={12} /></button></div>)}
          {outPorts.length === 0 && <div className="soft-note">Выходы не указаны.</div>}
        </div>
        <label className="field-label short-field">Длительность по календарю, дней<input type="number" min="0" step="0.25" value={data.plannedDays ?? 0} onChange={(e) => update('plannedDays', Number(e.target.value))} /></label>
        <div className="section-divider"><span>Инструменты этапа</span><span className="section-count">{(data.tools || []).length}</span></div>
        <p className="field-help">Стоимость лицензии распределяется пропорционально календарным дням этапа.</p>
        <div className="stage-tools-list">{tools.filter((item) => item.active).map((tool) => {
          const selected = (data.tools || []).some((binding) => String(typeof binding === 'object' ? binding.tool_id : binding) === String(tool.id));
          return <label className="stage-tool-option" key={tool.id}><input type="checkbox" checked={selected} onChange={(e) => update('tools', e.target.checked ? [...(data.tools || []), { tool_id: tool.id }] : (data.tools || []).filter((binding) => String(typeof binding === 'object' ? binding.tool_id : binding) !== String(tool.id)))} /><span>{tool.name}<small>{RUB.format(tool.monthly_price)} {tool.currency}/мес.</small></span></label>;
        })}{tools.filter((item) => item.active).length === 0 && <div className="soft-note">Добавьте инструменты во вкладке «Ресурсы и финансовые цели».</div>}</div>
        <div className="section-divider"><span>Задачи и оценка</span><button className="text-button" onClick={onAddAssignment}><Plus size={13} /> Добавить задачу</button></div>
        {(data.assignments || []).length === 0 && <div className="soft-note">Добавьте отдельную работу. Каждая задача назначается одному сотруднику и имеет собственную оценку часов.</div>}
        {(data.assignments || []).map((assignment, index) => {
          const person = team.find((member) => String(member.id) === String(assignment.member_id));
          const matchingGrades = roleGrades.filter((grade) => !person?.role || grade.role.toLowerCase() === person.role.toLowerCase());
          const selectedGrade = matchingGrades.find((grade) => String(grade.id) === String(assignment.grade_id));
          const customFields = assignment.custom_fields || [];
          const patchCustomField = (fieldIndex, patch) => onPatchAssignment(index, { custom_fields: customFields.map((field, itemIndex) => itemIndex === fieldIndex ? { ...field, ...patch } : field) });
          return <div className="work-item-row" key={`${node.id}-${index}`}>
            <div className="work-item-heading"><span className="work-item-number">{index + 1}</span><input aria-label="Название задачи" value={assignment.task || ''} onChange={(e) => onPatchAssignment(index, { task: e.target.value })} placeholder={`Задача ${index + 1}`} /><button className="icon-button tiny danger-quiet" title="Удалить задачу" onClick={() => onRemoveAssignment(index)}><Trash2 size={13} /></button></div>
            <label className="compact-field">Цель задачи<input value={assignment.goal || ''} onChange={(e) => onPatchAssignment(index, { goal: e.target.value })} placeholder="Зачем выполняем эту работу?" /></label>
            <label className="compact-field">Ожидаемый результат<textarea rows="2" value={assignment.expected_result || ''} onChange={(e) => onPatchAssignment(index, { expected_result: e.target.value })} placeholder="Что должно быть получено после выполнения?" /></label>
            <div className="work-item-fields"><select value={assignment.member_id || ''} onChange={(e) => { const m = team.find((item) => String(item.id) === e.target.value); onPatchAssignment(index, { member_id: e.target.value, role: m?.role || '', name: m?.name || '', grade_id: defaultGradeForRole(m?.role, roleGrades)?.id || '' }); }}><option value="">Исполнитель</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name}{member.active ? '' : ' · неактивен'}</option>)}</select><div className="hours-input"><input aria-label="Часы задачи" type="number" min="0" step="0.5" value={assignment.hours ?? 0} onChange={(e) => onPatchAssignment(index, { hours: Number(e.target.value) })} /><span>ч</span></div></div>
            <div className="work-item-fields grade-fields"><select value={assignment.grade_id || ''} onChange={(e) => onPatchAssignment(index, { grade_id: e.target.value })}><option value="">Выберите грейд</option>{matchingGrades.map((grade) => <option key={grade.id} value={grade.id}>{grade.grade} · {RUB.format(grade.hourly_rate)} {grade.currency}/ч</option>)}</select><div className="grade-label">Грейд</div></div>
            <div className="assignment-rate">{selectedGrade ? `${RUB.format(selectedGrade.hourly_rate)} ${selectedGrade.currency}/ч · ${selectedGrade.grade}` : person ? 'Для роли не настроен грейд' : 'Выберите исполнителя'}{person?.role ? ` · ${person.role}` : ''}</div>
            <label className="compact-field tag-field"><span><Tags size={12} /> Теги задачи</span><input value={(assignment.tags || []).join(', ')} onChange={(e) => onPatchAssignment(index, { tags: e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} placeholder="контент, клиент, срочно" /></label>
            <div className="section-divider custom-fields-heading"><span>Дополнительные поля</span><button className="text-button" onClick={() => onPatchAssignment(index, { custom_fields: [...customFields, { id: makeId('custom'), label: 'Новое поле', type: 'text', options: [], value: '', show_in_editor: true, show_on_node: true, export_to_excel: true }] })}><Plus size={12} /> Добавить поле</button></div>
            {customFields.map((field, fieldIndex) => <div className="custom-field-card" key={field.id || fieldIndex}>
              <div className="custom-field-top"><input value={field.label || ''} onChange={(e) => patchCustomField(fieldIndex, { label: e.target.value })} placeholder="Название поля" /><select value={field.type || 'text'} onChange={(e) => patchCustomField(fieldIndex, { type: e.target.value, value: e.target.value === 'toggle' ? Boolean(field.value) : e.target.value === 'multilist' ? (Array.isArray(field.value) ? field.value : []) : String(field.value ?? '') })}><option value="text">Текст</option><option value="number">Число</option><option value="toggle">Переключатель</option><option value="multilist">Мультисписок</option></select><button className="icon-button tiny danger-quiet" title="Удалить поле" onClick={() => onPatchAssignment(index, { custom_fields: customFields.filter((_, i) => i !== fieldIndex) })}><Trash2 size={12} /></button></div>
              {field.show_in_editor !== false ? <>
                {field.type === 'toggle' ? <label className="inline-check"><input type="checkbox" checked={Boolean(field.value)} onChange={(e) => patchCustomField(fieldIndex, { value: e.target.checked })} /> Включено</label> : field.type === 'multilist' ? <>
                  <input className="custom-options-input" value={(field.options || []).join(', ')} onChange={(e) => patchCustomField(fieldIndex, { options: e.target.value.split(',').map((option) => option.trim()).filter(Boolean), value: (Array.isArray(field.value) ? field.value : []).filter((value) => e.target.value.split(',').map((option) => option.trim()).includes(value)) })} placeholder="Значения через запятую: Да, Нет, Не требуется" />
                  <select multiple size="3" value={Array.isArray(field.value) ? field.value : []} onChange={(e) => patchCustomField(fieldIndex, { value: Array.from(e.target.selectedOptions).map((option) => option.value) })}>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
                </> : <input type={field.type === 'number' ? 'number' : 'text'} value={field.value ?? ''} onChange={(e) => patchCustomField(fieldIndex, { value: field.type === 'number' ? Number(e.target.value) : e.target.value })} placeholder="Значение" />}
              </> : <div className="soft-note custom-field-hidden-note">Значение скрыто в редакторе. Включите показ, чтобы редактировать его.</div>}
              <div className="custom-field-flags"><label><input type="checkbox" checked={field.show_in_editor !== false} onChange={(e) => patchCustomField(fieldIndex, { show_in_editor: e.target.checked })} /> Показывать при открытии</label><label><input type="checkbox" checked={Boolean(field.show_on_node)} onChange={(e) => patchCustomField(fieldIndex, { show_on_node: e.target.checked })} /> На карточке</label><label><input type="checkbox" checked={Boolean(field.export_to_excel)} onChange={(e) => patchCustomField(fieldIndex, { export_to_excel: e.target.checked })} /> В Excel</label></div>
            </div>)}
          </div>;
        })}
        <div className="section-divider checklist-heading"><span>Чек-лист: критерии готовности</span><button className="text-button" onClick={() => update('checklist', [...(data.checklist || []), ''])}><Plus size={13} /> Добавить пункт</button></div>
        {(data.checklist || []).map((item, index) => <div className="checklist-item-row" key={`check-${node.id}-${index}`}><span>{index + 1}</span><input value={item} onChange={(e) => update('checklist', (data.checklist || []).map((value, i) => i === index ? e.target.value : value))} placeholder={`Критерий готовности ${index + 1}`} /><button className="icon-button tiny danger-quiet" title="Удалить пункт" onClick={() => update('checklist', (data.checklist || []).filter((_, i) => i !== index))}><Trash2 size={12} /></button></div>)}
        {(data.checklist || []).length === 0 && <div className="soft-note">Добавьте конкретные критерии, по которым можно принять результат этапа.</div>}
        </>}
        {node.type === 'risk' && <div className="hint-box decision-hint"><ShieldAlert size={15} /><span>Карточка риска не влияет на стоимость. Для расчёта меры реагирования добавьте отдельную задачу в процесс.</span></div>}
        {node.type === 'decision' && <div className="hint-box decision-hint"><GitBranch size={15} /><span>Каждый обычный выход из «Решения» — альтернативный сценарий. Для бюджета берётся самый дорогой маршрут, а не сумма всех вариантов.</span></div>}
        {outEdges.length > 0 && <div className="section-divider"><span>Переходы процесса</span></div>}
        {outEdges.map((edge) => <label className="field-label edge-label-field" key={edge.id}><span>→ {nodes.find((item) => item.id === edge.target)?.data?.name || 'Следующий этап'}</span><input value={edge.label || ''} onChange={(e) => onPatchEdge(edge.id, e.target.value)} placeholder="Условие / подпись перехода" /></label>)}
        <div className="inspector-actions"><button className="button subtle-danger" onClick={onDelete}><Trash2 size={15} /> Удалить элемент</button></div>
      </>}
    </aside>
  );
}
