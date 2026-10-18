import React, { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, LoaderCircle, Mail, RefreshCw, ShieldCheck, UserRoundCheck, X } from 'lucide-react';
import { api } from '../lib/api.js';

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function AdminRegistrationsPage() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const result = await api('/api/admin/registrations');
      setRegistrations(Array.isArray(result) ? result : []);
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить регистрации. Проверьте, что вы вошли под администратором.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const action = async (registration, type) => {
    setBusyId(registration.id);
    setError('');
    setNotice('');
    try {
      if (type === 'set-email') {
        const email = window.prompt(`Укажите email для аккаунта «${registration.username}». На этот адрес будет отправлена новая ссылка подтверждения.`, registration.email || '');
        if (email === null) return;
        const result = await api(`/api/admin/registrations/${encodeURIComponent(registration.id)}/set-email`, {
          method: 'POST', body: JSON.stringify({ email: email.trim() }),
        });
        setNotice(result.email_delivery === 'unavailable'
          ? `Email аккаунта ${registration.username} обновлён, но письмо не отправлено. Проверьте SMTP в backend/.env и нажмите «Повторить письмо».`
          : result.email_delivery === 'logged'
            ? `SMTP не настроен. Ссылка подтверждения для ${registration.username} записана в консоль backend (только локальная разработка).`
            : `Письмо для ${registration.username} отправлено. Пользователь должен подтвердить адрес, после чего вы сможете одобрить регистрацию.`);
      } else {
        const labels = { approve: 'approve', reject: 'reject', resend: 'resend-verification' };
        const result = await api(`/api/admin/registrations/${encodeURIComponent(registration.id)}/${labels[type]}`, {
          method: 'POST', body: JSON.stringify({}),
        });
        if (type === 'approve') setNotice(`Аккаунт ${registration.username} одобрен.`);
        else if (type === 'reject') setNotice(`Регистрация ${registration.username} отклонена.`);
        else setNotice(result.email_delivery === 'unavailable' ? 'Почта недоступна. Проверьте настройки SMTP в backend/.env.' : result.email_delivery === 'logged' ? 'SMTP не настроен. Ссылка подтверждения записана в консоль backend (только локальная разработка).' : `Письмо подтверждения отправлено аккаунту ${registration.username}.`);
      }
      await refresh(true);
    } catch (err) {
      setError(err.message || 'Не удалось выполнить действие.');
    } finally {
      setBusyId('');
    }
  };

  const pendingVerified = registrations.filter((item) => item.approval_status === 'pending' && item.email_verified_at).length;
  return <div className="team-page admin-registrations-page">
    <div className="page-heading online-page-heading">
      <div><span className="eyebrow">АДМИНИСТРИРОВАНИЕ</span><h1><ShieldCheck size={24} /> Регистрации</h1><p>Пользователь должен подтвердить email, прежде чем вы сможете одобрить доступ к FlowCost.</p></div>
      <div className="online-heading-status"><span className="online-count-pill">{pendingVerified} готовы к одобрению</span><button className="icon-button" onClick={() => void refresh(true)} title="Обновить список" disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button></div>
    </div>
    {error && <div className="error-banner"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Закрыть сообщение"><X size={14} /></button></div>}
    {notice && <div className="auth-notice is-success"><Check size={15} /><span>{notice}</span></div>}
    {loading ? <div className="online-empty"><LoaderCircle className="spin" size={20} /><span>Загружаем регистрации…</span></div> : registrations.length === 0 ? <div className="online-empty"><UserRoundCheck size={24} /><strong>Нет ожидающих регистраций</strong><span>Новые аккаунты появятся здесь после регистрации.</span></div> : <div className="registration-list">
      {registrations.map((registration) => {
        const busy = busyId === registration.id;
        const verified = Boolean(registration.email_verified_at && registration.email);
        const rejected = registration.approval_status === 'rejected';
        return <article className="registration-card" key={registration.id}>
          <div className="registration-avatar"><UserRoundCheck size={18} /></div>
          <div className="registration-identity"><strong>{registration.username}</strong><span><Mail size={12} /> {registration.email || 'Email не указан'}</span><small><Clock3 size={12} /> Регистрация: {displayDate(registration.created_at)}</small></div>
          <div className="registration-status-column"><span className={`registration-status ${verified ? 'is-verified' : 'is-pending'}`}>{verified ? 'Email подтверждён' : 'Email не подтверждён'}</span><small>{rejected ? 'Регистрация отклонена' : verified ? 'Ожидает решения администратора' : 'Одобрение пока недоступно'}</small></div>
          <div className="registration-actions">
            {!verified && <button className="button secondary small" disabled={busy} onClick={() => void action(registration, 'set-email')}><Mail size={13} /> {registration.email ? 'Изменить email' : 'Добавить email'}</button>}
            {!verified && Boolean(registration.email) && !rejected && <button className="button secondary small" disabled={busy} onClick={() => void action(registration, 'resend')}><RefreshCw size={13} /> Повторить письмо</button>}
            {verified && <button className="button primary small" disabled={busy || rejected} onClick={() => void action(registration, 'approve')}><Check size={13} /> Одобрить</button>}
            {!rejected && <button className="icon-button danger-quiet" title="Отклонить регистрацию" aria-label={`Отклонить ${registration.username}`} disabled={busy} onClick={() => void action(registration, 'reject')}><X size={14} /></button>}
            {busy && <LoaderCircle className="spin" size={14} />}
          </div>
        </article>;
      })}
    </div>}
    <div className="online-page-footnote">Администраторская учётная запись создаётся из настроек FLOWCOST_ADMIN_* в backend/.env. Одобрение возможно только после подтверждения email.</div>
  </div>;
}
