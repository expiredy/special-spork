import React, { useRef, useState, useEffect } from 'react';
import { CheckCircle2, Mail, ShieldCheck, Workflow } from 'lucide-react';
import { api } from '../lib/api.js';

export function AuthScreen({ onAuthenticated, initialError = '' }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const verificationStartedRef = useRef(false);

  useEffect(() => { if (initialError) setError(initialError); }, [initialError]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const verificationToken = url.searchParams.get('verify_email');
    if (!verificationToken || verificationStartedRef.current) return;
    verificationStartedRef.current = true;
    setBusy(true);
    setError('');
    api('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verificationToken }),
    }).then((result) => {
      setMode('login');
      setNotice({ type: 'success', message: result.message || 'Email подтверждён. Дождитесь одобрения администратора.' });
      setEmail('');
    }).catch((err) => {
      setError(err.message || 'Ссылка подтверждения недействительна или устарела.');
    }).finally(() => {
      url.searchParams.delete('verify_email');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      setBusy(false);
    });
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      if (mode === 'register') {
        const result = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, email, password }),
        });
        setMode('login');
        setResendEmail(email);
        setShowResend(true);
        setNotice({ type: result.email_delivery === 'unavailable' ? 'warning' : 'success', message: result.message });
        setPassword('');
        return;
      }
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem('flowcost_token', result.token);
      localStorage.setItem('flowcost_user', JSON.stringify(result.user));
      await onAuthenticated(result.user);
    } catch (err) {
      setError(err.message);
      if (/ожидает одобрения администратора/i.test(err.message)) {
        setNotice({ type: 'success', message: 'Email уже подтверждён. Администратор должен одобрить регистрацию, прежде чем вы сможете войти.' });
        setShowResend(false);
      } else if (/регистрация отклонена/i.test(err.message)) {
        setShowResend(false);
      } else if (/email|подтверд/i.test(err.message)) {
        setResendEmail(email);
        setShowResend(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ username, email: resendEmail }),
      });
      setNotice({ type: 'success', message: result.message });
    } catch (err) {
      setError(err.message || 'Не удалось запросить письмо.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode((current) => current === 'register' ? 'login' : 'register');
    setError('');
    setNotice(null);
    setShowResend(false);
  };

  return <div className="auth-screen"><div className="auth-card">
    <div className="brand auth-brand"><div className="brand-mark"><Workflow size={22} /></div><div><strong>FlowCost</strong><span>process studio · collaborative planning</span></div></div>
    <span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span>
    <h1>{mode === 'register' ? 'Создать аккаунт' : 'С возвращением'}</h1>
    <p>Для доступа нужен подтверждённый email. После проверки адреса администратор одобрит регистрацию.</p>
    {notice && <div className={`auth-notice ${notice.type === 'warning' ? 'is-warning' : 'is-success'}`}><CheckCircle2 size={16} /><span>{notice.message}</span></div>}
    <form onSubmit={submit}>
      <label className="field-label">Логин<input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" minLength={3} maxLength={40} placeholder="например, yaroslav" /></label>
      {mode === 'register' && <label className="field-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></label>}
      <label className="field-label">Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? 'Не менее 8 символов' : 'Ваш пароль'} /></label>
      {error && <div className="error-banner">{error}</div>}
      <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'Подождите…' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
    {mode === 'login' && <div className="auth-resend-toggle"><button className="text-button" type="button" onClick={() => { setShowResend((shown) => !shown); setError(''); }}><Mail size={13} /> Письмо подтверждения не пришло?</button></div>}
    {mode === 'login' && showResend && <form className="auth-resend-form" onSubmit={resendVerification}>
      <label className="field-label">Email, указанный при регистрации<input type="email" value={resendEmail} onChange={(event) => setResendEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></label>
      <button className="button secondary auth-submit" type="submit" disabled={busy}>Отправить письмо повторно</button>
      <small>Для безопасности мы не сообщаем, существует ли аккаунт с такими данными. Если у старого аккаунта совсем не было email, попросите администратора добавить его через раздел «Регистрации».</small>
    </form>}
    <div className="auth-switch">{mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые в FlowCost?'} <button className="text-button" type="button" onClick={switchMode}>{mode === 'register' ? 'Войти' : 'Создать аккаунт'}</button></div>
    <small className="auth-security-note"><ShieldCheck size={12} /> Email-подтверждение и одобрение администратора обязательны. Пароли хранятся в виде криптографического хэша.</small>
  </div></div>;
}
