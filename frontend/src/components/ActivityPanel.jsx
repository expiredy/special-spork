import React from 'react';
import { Activity, Clock3, Link2, RefreshCw, X } from 'lucide-react';

function formatTimestamp(value) {
  if (!value) return 'Время не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function ActivityPanel({ processName, events = [], loading = false, onClose, onCopyLink }) {
  return <aside className="inspector activity-panel">
    <div className="inspector-heading">
      <div><span className="eyebrow">ЖУРНАЛ ПРОЦЕССА</span><h2><Activity size={17} /> История изменений</h2><small>{processName || 'Без названия'}</small></div>
      <div className="activity-panel-actions">
        <button className="icon-button" onClick={onCopyLink} title="Скопировать прямую ссылку"><Link2 size={15} /></button>
        <button className="icon-button" onClick={onClose} title="Закрыть журнал"><X size={15} /></button>
      </div>
    </div>
    <p className="activity-panel-intro">События сохраняются на сервере и видны участникам, у которых есть доступ к этому процессу.</p>
    {loading && <div className="activity-loading"><RefreshCw size={14} className="spin" /> Загружаем историю…</div>}
    {!loading && events.length === 0 && <div className="activity-empty"><Activity size={22} /><strong>Пока нет событий</strong><span>Перемещение блоков, изменения задач и связи появятся здесь.</span></div>}
    <div className="activity-list">
      {events.map((event, index) => <article className="activity-event" key={event.revision ? `rev-${event.revision}` : event.op_id || `${event.created_at}-${index}`}>
        <div className="activity-event-line"><span className="activity-event-dot" /><div className="activity-event-main"><strong>{event.username || event.user || 'Участник'}</strong><span>{event.action || 'обновил процесс'}</span></div></div>
        <div className="activity-event-meta"><Clock3 size={11} /><time>{formatTimestamp(event.created_at)}</time>{event.revision != null && <span>· версия {event.revision}</span>}</div>
        {event.conflicts?.length > 0 && <div className="activity-conflict">Возможные конфликты: {event.conflicts.length}</div>}
      </article>)}
    </div>
    <div className="activity-panel-footer">Журнал пока доступен для просмотра. Откат к прошлой версии добавим отдельно, чтобы случайно не потерять изменения коллег.</div>
  </aside>;
}
