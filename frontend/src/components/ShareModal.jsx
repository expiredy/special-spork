import React, { useState, useEffect } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Blocks, CheckCircle2, ChevronDown, CircleDollarSign, CircleHelp, Clock3, Copy, Eye, EyeOff, FileJson, FileSpreadsheet, FolderOpen, FolderPlus, GitBranch, Keyboard, Link2, ListChecks, ListTree, LogOut, Menu, MousePointer2, Palette, Plus, Save, Settings2, Share2, ShieldAlert, StickyNote, Tags, Trash2, Undo2, Upload, UserRound, Users, UsersRound, Workflow, Wrench, X, XCircle, Calculator, LayoutGrid } from 'lucide-react';
import * as Model from '../lib/processModel.js';
import { api } from '../lib/api.js';
const { TYPE_LABELS, TYPE_ICONS, COLOR_PRESETS, RUB, HOURS, DEFAULT_COLOR_BY_TYPE, makeId, newPort, normalizePortList, colorStyle, isDataFlowEdge, defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode, getNodeCost, calculateLocal, applyFinancialGoalsLocal, nodeMissingFields } = Model;

export function ShareModal({ process, onClose }) {
  const [username, setUsername] = useState('');
  const [permission, setPermission] = useState('edit');
  const [shares, setShares] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setShares(await api(`/api/processes/${process.id}/share`)); } catch (err) { setError(err.message); } };
  useEffect(() => { refresh(); }, [process.id]);
  const add = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`/api/processes/${process.id}/share`, { method: 'POST', body: JSON.stringify({ username, permission }) }); setUsername(''); await refresh(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async (userId) => { try { await api(`/api/processes/${process.id}/share/${userId}`, { method: 'DELETE' }); await refresh(); } catch (err) { setError(err.message); } };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card share-modal">
    <div className="modal-heading"><div><span className="eyebrow">СОВМЕСТНАЯ РАБОТА</span><h2>Доступ к процессу</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div>
    <p className="field-help">Пригласите зарегистрированного пользователя по логину. Редакторы синхронизируют изменения и видят курсоры друг друга.</p>
    <form className="share-invite-form" onSubmit={add}><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Логин пользователя" required /><select value={permission} onChange={(e) => setPermission(e.target.value)}><option value="edit">Редактирование</option><option value="view">Только просмотр</option></select><button className="button primary" disabled={busy}><Plus size={14} /> Добавить</button></form>
    {error && <div className="error-banner">{error}</div>}
    <div className="share-list">{shares.map((share) => <div className="share-row" key={share.id}><div className="share-avatar">{share.username.slice(0, 1).toUpperCase()}</div><div><strong>{share.username}</strong><small>{share.email || 'Email не указан'} · {share.permission === 'view' ? 'просмотр' : 'редактирование'}</small></div><button className="icon-button danger-quiet" title="Убрать доступ" onClick={() => remove(share.id)}><XCircle size={15} /></button></div>)}{shares.length === 0 && <div className="soft-note">К процессу пока никто не приглашён.</div>}</div>
  </div></div>;
}
