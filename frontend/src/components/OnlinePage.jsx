import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Check, Clock3, Eye, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, UsersRound, X } from 'lucide-react';
import { api } from '../lib/api.js';

function formatTime(value) {
  if (!value) return 'только что';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'только что';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

export function OnlinePage({ currentUser, onOpenProcess }) {
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionState, setActionState] = useState({});
  const [lastChecked, setLastChecked] = useState(null);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [presence, incoming] = await Promise.all([
        api('/api/presence/online'),
        api('/api/access-requests/incoming'),
      ]);
      setUsers(Array.isArray(presence.users) ? presence.users : []);
      setRequests(Array.isArray(incoming) ? incoming : []);
      setLastChecked(presence.checked_at || new Date().toISOString());
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить список коллег.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const timer = setInterval(() => void refresh(true), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const setBusy = (key, value) => setActionState((state) => ({ ...state, [key]: value }));

  const requestAccess = async (process) => {
    const key = `request:${process.id}`;
    setBusy(key, 'busy');
    try {
      const result = await api(`/api/processes/${encodeURIComponent(process.id)}/access-request`, {
        method: 'POST', body: JSON.stringify({}),
      });
      setBusy(key, result.status === 'already_shared' ? 'shared' : 'sent');
      await refresh(true);
    } catch (err) {
      setError(err.message || 'Не удалось запросить доступ.');
      setBusy(key, 'error');
    }
  };

  const decideRequest = async (request, decision, permission = 'edit') => {
    const key = `decision:${request.process_id}:${request.requester_id}`;
    setBusy(key, `${decision}-busy`);
    try {
      await api(`/api/processes/${encodeURIComponent(request.process_id)}/access-requests/${encodeURIComponent(request.requester_id)}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, permission }),
      });
      setBusy(key, decision);
      await refresh(true);
    } catch (err) {
      setError(err.message || 'Не удалось обработать запрос.');
      setBusy(key, 'error');
    }
  };

  const accountCount = users.length;
  return <div className="team-page online-page">
    <div className="page-heading online-page-heading">
      <div>
        <span className="eyebrow">РАБОТА В КОМАНДЕ</span>
        <h1><UsersRound size={24} /> Коллеги онлайн</h1>
        <p>Здесь видно, кто сейчас работает в FlowCost и какой процесс редактирует. Чтобы работать над одним графом, откройте одну и ту же ссылку на процесс.</p>
      </div>
      <div className="online-heading-status"><span className="live-dot" /> {accountCount} {accountCount === 1 ? 'аккаунт' : accountCount >= 2 && accountCount <= 4 ? 'аккаунта' : 'аккаунтов'} онлайн <button className="icon-button" onClick={() => void refresh(true)} title="Обновить список" disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button></div>
    </div>

    {error && <div className="error-banner"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Закрыть сообщение"><X size={14} /></button></div>}

    {requests.length > 0 && <section className="online-section">
      <div className="online-section-heading"><div><span className="eyebrow">ТРЕБУЕТСЯ РЕШЕНИЕ</span><h2><ShieldCheck size={18} /> Запросы доступа</h2></div><span className="online-count-pill">{requests.length}</span></div>
      <div className="access-request-list">
        {requests.map((item) => {
          const key = `decision:${item.process_id}:${item.requester_id}`;
          const busy = String(actionState[key] || '').endsWith('-busy');
          return <article className="access-request-card" key={`${item.process_id}:${item.requester_id}`}>
            <div className="online-avatar">{String(item.requester_username || '?').slice(0, 1).toUpperCase()}</div>
            <div className="access-request-copy"><strong>{item.requester_username}</strong><span>просит доступ к «{item.process_name}»</span><small><Clock3 size={11} /> {formatTime(item.created_at)}</small></div>
            <div className="access-request-actions">
              <button className="button primary small" disabled={busy} onClick={() => decideRequest(item, 'approve', 'edit')}><Check size={13} /> Редактирование</button>
              <button className="button secondary small" disabled={busy} onClick={() => decideRequest(item, 'approve', 'view')}><Eye size={13} /> Просмотр</button>
              <button className="icon-button danger-quiet" disabled={busy} title="Отклонить" onClick={() => decideRequest(item, 'reject')}><X size={14} /></button>
            </div>
          </article>;
        })}
      </div>
    </section>}

    <section className="online-section">
      <div className="online-section-heading"><div><span className="eyebrow">ПРИСУТСТВИЕ</span><h2><Activity size={18} /> Активные аккаунты</h2></div><small>{lastChecked ? `Обновлено ${formatTime(lastChecked)}` : 'Обновление каждые 5 секунд'}</small></div>
      {loading ? <div className="online-empty"><LoaderCircle className="spin" size={20} /><span>Загружаем присутствие…</span></div> : users.length === 0 ? <div className="online-empty"><UsersRound size={24} /><strong>Пока никого не видно</strong><span>Список обновляется автоматически, пока приложение открыто у участников.</span></div> : <div className="online-user-grid">
        {users.map((person) => <article className={`online-user-card ${person.id === currentUser?.id ? 'is-self' : ''}`} key={person.id}>
          <div className="online-user-heading"><div className="online-avatar online-avatar-large">{String(person.username || '?').slice(0, 1).toUpperCase()}</div><div className="online-user-identity"><strong>{person.username}{person.id === currentUser?.id ? ' (вы)' : ''}</strong><span><i className="presence-dot" /> В сети · {person.session_count} {person.session_count === 1 ? 'вкладка' : 'вкладок'}</span></div></div>
          <div className="online-user-processes">
            {person.processes?.length ? person.processes.map((process) => {
              const key = `request:${process.id}`;
              const state = actionState[key];
              return <div className="online-process-row" key={process.id}>
                <div className="online-process-icon">{process.can_open ? <Activity size={15} /> : <LockKeyhole size={15} />}</div>
                <div className="online-process-details"><strong>{process.name}</strong><small>{process.can_open ? (process.can_edit ? 'Доступно редактирование' : 'Только просмотр') : `Процесс владельца ${process.owner_username}`}</small></div>
                {process.can_open && <button className="button secondary small" onClick={() => onOpenProcess(process.id)}><ArrowUpRight size={13} /> Открыть</button>}
                {process.can_request_access && !process.can_edit && <button className="button primary small" disabled={state === 'busy' || state === 'sent' || process.request_status === 'pending'} onClick={() => requestAccess(process)}>{state === 'busy' ? <LoaderCircle className="spin" size={13} /> : state === 'sent' || process.request_status === 'pending' ? <Check size={13} /> : <UsersRound size={13} />}{state === 'sent' || process.request_status === 'pending' ? 'Запрос отправлен' : state === 'shared' ? 'Уже доступен' : 'Запросить доступ'}</button>}
              </div>;
            }) : <div className="online-not-editing">Сейчас не редактирует процесс</div>}
          </div>
        </article>)}
      </div>}
    </section>
    <div className="online-page-footnote">Приватные процессы не открываются автоматически: владелец должен выдать доступ или одобрить запрос. Это защищает сметы и внутренние данные команды.</div>
  </div>;
}
