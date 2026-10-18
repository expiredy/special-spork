import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { AlertCircle, Blocks, ListChecks } from 'lucide-react';
import * as Model from '../lib/processModel.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function ProcessNode({ id, data, type, selected }) {
  const tasks = (data.assignments || []).filter((item) => item.member_id || item.task || Number(item.hours) > 0);
  const checklist = (data.checklist || []).length;
  const missing = nodeMissingFields({ id, type, data });
  const inputs = data.__visibleInputs || normalizePortList(data.inputs, id, 'input');
  const outputs = data.__visibleOutputs || normalizePortList(data.outputs, id, 'output');
  const style = colorStyle(data, DEFAULT_COLOR_BY_TYPE[type] || 'slate');
  if (type === 'group') {
    return <div className={`group-node ${selected ? 'node-selected' : ''}`} style={style}>
      <div className="group-node-heading"><Blocks size={15} /><span>{data.name || 'Группа этапов'}</span></div>
      {data.description && <div className="group-node-description">{data.description}</div>}
    </div>;
  }
  if (type === 'sticker') {
    return <div className={`process-node sticker-node ${selected ? 'node-selected' : ''}`} style={style}>
      <div className="sticker-pin">✦</div><div className="node-title">{data.name || 'Идея'}</div>
      <div className="sticker-content">{data.description || 'Запишите мысль…'}</div>
      <div className="sticker-foot">ЗАМЕТКА НА ХОЛСТЕ</div>
    </div>;
  }
  const taskPreview = tasks.slice(0, 2).map((item, index) => `${item.task || `Задача ${index + 1}`} · ${item.name || item.role || 'Без исполнителя'} · ${item.hours || 0} ч`).join(' / ');
  const taskTags = [...new Set(tasks.flatMap((item) => item.tags || []))].slice(0, 4);
  const visibleFields = tasks.flatMap((item) => (item.custom_fields || []).filter((field) => field.show_on_node && field.label && field.value !== undefined && field.value !== '').map((field) => ({ label: field.label, value: field.type === 'toggle' ? (field.value ? 'Да' : 'Нет') : Array.isArray(field.value) ? field.value.join(', ') : String(field.value) }))).slice(0, 2);
  return (
    <div className={`process-node node-${type} ${type === 'risk' ? `risk-node risk-${data.riskSeverity || 'high'}` : ''} ${selected ? 'node-selected' : ''}`} style={style}>
      {type !== 'start' && type !== 'risk' && <Handle id="flow-in" type="target" position={Position.Left} className="flow-handle" style={{ top: 22 }} />}
      <div className="node-overline"><span className="node-symbol">{TYPE_ICONS[type] || '▰'}</span><span>{TYPE_LABELS[type] || 'Этап'}</span>{type === 'risk' && <span className="risk-severity">{data.riskSeverity === 'low' ? 'НИЗКИЙ' : data.riskSeverity === 'medium' ? 'СРЕДНИЙ' : 'ВЫСОКИЙ'}</span>}</div>
      <div className="node-title">{data.name || data.label || 'Без названия'}</div>
      {missing.length > 0 && <div className="node-validation-alert" title={`Не заполнено: ${missing.join(', ')}`}><AlertCircle size={11} /> Не заполнено полей: {missing.length}</div>}
      {type === 'risk' ? <>
        {data.riskCommentary && <div className="risk-preview"><strong>Риск</strong><span>{data.riskCommentary}</span></div>}
        {data.riskSolution && <div className="risk-solution-preview"><strong>Решение</strong><span>{data.riskSolution}</span></div>}
      </> : data.description && <div className="node-description">{data.description}</div>}
      {tasks.slice(0, 1).map((item, index) => <div className="node-goal-preview" key={`goal-${index}`}>
        {item.goal && <div><strong>Цель</strong><span>{item.goal}</span></div>}
        {item.expected_result && <div><strong>Результат</strong><span>{item.expected_result}</span></div>}
      </div>)}
      {taskTags.length > 0 && <div className="node-tag-list">{taskTags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      {visibleFields.length > 0 && <div className="node-custom-preview">{visibleFields.map((field) => <div key={`${field.label}-${field.value}`}><strong>{field.label}</strong><span>{field.value}</span></div>)}</div>}
      {(inputs.length > 0 || outputs.length > 0) && <div className="node-ports">
        {inputs.length > 0 && <div className="node-port-group"><div className="port-heading">ВХОД</div>{inputs.slice(0, 4).map((port) => <div className={`node-port-row input-port-row ${port.linked ? 'port-linked' : ''}`} key={port.id} title={port.linked ? `Источник: ${port.sourceName}` : port.label}>
          <Handle id={`in-${port.id}`} type="target" position={Position.Left} className="data-port-handle" />
          <span className="port-label">{port.label || 'Входные данные'}</span>{port.linked && <span className="port-origin">{port.sourceName}</span>}
        </div>)}</div>}
        {outputs.length > 0 && <div className="node-port-group"><div className="port-heading">ВЫХОД</div>{outputs.slice(0, 4).map((port) => <div className="node-port-row output-port-row" key={port.id} title={port.label}>
          <span className="port-label">{port.label || 'Результат'}</span><Handle id={`out-${port.id}`} type="source" position={Position.Right} className="data-port-handle" />
        </div>)}</div>}
        {(inputs.length > 4 || outputs.length > 4) && <div className="ports-overflow">+ ещё элементы · полный список в настройках</div>}
      </div>}
      <div className="node-meta">
        {taskPreview && <span className="node-tasks-preview">{taskPreview}{tasks.length > 2 ? ` · +${tasks.length - 2} задач` : ''}</span>}
        {checklist > 0 && <span className="node-checklist"><ListChecks size={12} /> {checklist}</span>}
      </div>
      {type !== 'end' && type !== 'risk' && <Handle id="flow-out" type="source" position={Position.Right} className="flow-handle" style={{ top: 22 }} />}
    </div>
  );
}
export function nodePortData(nodes, edges) {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const data = node.data || {};
    const inputs = normalizePortList(data.inputs, node.id, 'input').map((port) => {
      const edge = edges.find((item) => isDataFlowEdge(item) && item.target === node.id && item.targetHandle === `in-${port.id}`);
      if (!edge) return port;
      const source = byId[edge.source];
      const sourcePortId = String(edge.sourceHandle || '').replace(/^out-/, '');
      const output = source ? normalizePortList(source.data?.outputs, source.id, 'output').find((item) => item.id === sourcePortId) : null;
      return { ...port, label: output?.label || port.label || 'Связанный выход', linked: true, sourceName: source?.data?.name || 'Предыдущий этап' };
    });
    return { ...node, data: { ...data, __visibleInputs: inputs, __visibleOutputs: normalizePortList(data.outputs, node.id, 'output') } };
  });
}
export const nodeTypes = { start: ProcessNode, task: ProcessNode, decision: ProcessNode, end: ProcessNode, subprocess: ProcessNode, sticker: ProcessNode, risk: ProcessNode, group: ProcessNode };
