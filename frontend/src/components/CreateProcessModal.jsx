import React, { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Plus, X } from 'lucide-react';

export function CreateProcessModal({ onClose, onCreate, busy = false }) {
  const [name, setName] = useState('Новый процесс');
  const [description, setDescription] = useState('');
  const [folder, setFolder] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Укажите название процесса.');
      return;
    }
    setError('');
    try {
      await onCreate({ name: cleanName, description: description.trim(), folder: folder.trim(), visibility });
    } catch (cause) {
      setError(cause?.message || 'Не удалось создать процесс.');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="modal-card process-create-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div><span className="eyebrow">НОВЫЙ ПРОЦЕСС</span><h2>Создать процесс</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Закрыть"><X size={17} /></button>
        </div>

        <label className="field-label">Название<input autoFocus maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, запуск сайта" /></label>
        <label className="field-label">Описание <span className="optional-label">необязательно</span><textarea rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Для чего нужен этот процесс?" /></label>
        <label className="field-label">Папка <span className="optional-label">необязательно</span><input maxLength={100} value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Например, Клиентские проекты" /></label>

        <fieldset className="process-visibility-fieldset">
          <legend>Кто сможет открыть процесс?</legend>
          <label className={`process-visibility-option ${visibility === 'private' ? 'selected' : ''}`}>
            <input type="radio" name="visibility" value="private" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
            <span className="visibility-option-icon"><EyeOff size={17} /></span>
            <span><strong>Закрытый</strong><small>Только вы и люди, которым вы выдадите доступ.</small></span>
            <LockKeyhole className="visibility-option-check" size={15} />
          </label>
          <label className={`process-visibility-option ${visibility === 'public' ? 'selected' : ''}`}>
            <input type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
            <span className="visibility-option-icon"><Eye size={17} /></span>
            <span><strong>Видимый всем</strong><small>Все зарегистрированные пользователи смогут найти и открыть процесс. Редактирование — только владельцу и приглашённым редакторам.</small></span>
          </label>
        </fieldset>

        {error && <div className="inline-form-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Отмена</button><button type="submit" className="button primary" disabled={busy}><Plus size={15} />{busy ? 'Создаём…' : 'Создать процесс'}</button></div>
      </form>
    </div>
  );
}

export default CreateProcessModal;
