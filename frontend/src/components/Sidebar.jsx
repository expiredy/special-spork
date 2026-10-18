import React from 'react';
import { FolderOpen, Link2, LogOut, Plus, ShieldCheck, Trash2, Users, UsersRound, Workflow } from 'lucide-react';

export function Sidebar({ processes, activeProcessId, onSelect, onNew, onDelete, page, teamTab = 'team', setPage, open, setSortOrder, sortOrder, user, onLogout, onCopyLink }) {
  if (!open) return null;
  const folders = new Map();
  for (const process of processes) {
    const folder = process.folder?.trim() || 'Без папки';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push(process);
  }
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Workflow size={20} /></div><div><strong>FlowCost</strong><span>process studio · v0.5.4</span></div></div>
    <div className="sidebar-section-label">ПРОЦЕССЫ <button title="Новый процесс" className="icon-button mini" onClick={onNew}><Plus size={15} /></button></div>
    <div className="process-sort"><label>Сортировка<select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}><option value="updated">По изменению</option><option value="name">По названию</option><option value="folder">По папкам</option></select></label></div>
    <div className="process-list">
      {[...folders.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([folder, items]) => <div className="process-folder" key={folder}>
        <div className="process-folder-heading"><FolderOpen size={13} /><span>{folder}</span><small>{items.length}</small></div>
        {items.map((process) => <div className={`process-list-row ${page === 'canvas' && process.id === activeProcessId ? 'active' : ''}`} key={process.id}>
          <button className={`process-list-item ${page === 'canvas' && process.id === activeProcessId ? 'active' : ''}`} onClick={() => onSelect(process.id)} title={`Открыть процесс · ${process.id}`}>
            <span className="list-item-icon"><Workflow size={15} /></span><span className="list-item-text"><strong>{process.name}</strong><small>{process.visibility === 'public' ? 'Видимый всем' : 'Закрытый'} · {process.nodes?.length || 0} узлов</small></span>
          </button>
          <button className="process-link-button" title="Скопировать прямую ссылку на процесс" aria-label={`Скопировать ссылку: ${process.name}`} onClick={() => onCopyLink(process.id)}><Link2 size={13} /></button>
          {process.owner_id === user?.id && <button className="process-delete-button" title={`Удалить процесс «${process.name}»`} aria-label={`Удалить процесс: ${process.name}`} onClick={() => onDelete?.(process.id)}><Trash2 size={13} /></button>}
        </div>)}
      </div>)}
      {processes.length === 0 && <div className="soft-note">Пока нет процессов. Создайте первый.</div>}
    </div>
    <div className="sidebar-bottom">
      <button className={`nav-link ${page === 'team' && teamTab !== 'online' && teamTab !== 'admin' ? 'active' : ''}`} onClick={() => setPage('team')}><Users size={17} /> Ресурсы и ставки</button>
      <button className={`nav-link ${page === 'team' && teamTab === 'online' ? 'active' : ''}`} onClick={() => setPage('online')}><UsersRound size={17} /> Коллеги онлайн</button>
      {user?.is_admin && <button className={`nav-link ${page === 'team' && teamTab === 'admin' ? 'active' : ''}`} onClick={() => setPage('admin')}><ShieldCheck size={17} /> Регистрации</button>}
      <div className="user-sidebar-row"><span className="user-avatar">{user?.username?.slice(0, 1).toUpperCase() || 'U'}</span><div><strong>{user?.username || 'Пользователь'}</strong><small>Личное пространство</small></div><button className="icon-button mini" title="Выйти" onClick={onLogout}><LogOut size={14} /></button></div>
      <div className="sidebar-footnote"><span className="live-dot" /> Автосохранение · SQLite<br />Общий доступ — по логину.</div>
    </div>
  </aside>;
}
