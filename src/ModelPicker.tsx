import { useMemo, useState } from 'react';
import { SAMSUNG_MODELS } from './samsung-models';
import { modelCode4 } from './phone-names';
import { cleanName, normalizeCode } from './custom-models';
import { useBackLayer } from './back-layer';

type Props = {
  id?: string;
  value: string;
  onChange: (model: string) => void;
  customModels: Record<string, string>;
  catalogEntries: { name: string; modelCode: string }[];
  /** Models already found in the scans, so they are always in the list. */
  scannedModels: string[];
  /** Save a new model name to your own list. Returns false when it could not be saved. */
  onAddModel: (code: string, name: string) => boolean;
  onEnter?: () => void;
};

type Choice = { code: string; name: string; from: 'built-in' | 'catalog' | 'mine' | 'not named' };
const FROM_LABEL: Record<Choice['from'], string> = { 'built-in': 'Built-in', catalog: 'Catalog', mine: 'My name', 'not named': 'No name yet' };

/**
 * Device model: a button that opens a big dialog of every supported model (built-in list, downloaded catalog,
 * your own names, models already scanned). Tap a model to choose it. You can also add a new model or type one for this phone only.
 */
export function ModelPicker({ id, value, onChange, customModels, catalogEntries, scannedModels, onAddModel, onEnter }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'add' | 'type'>('list');
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');
  useBackLayer(open, () => setOpen(false), 'model-picker');

  const choices = useMemo(() => {
    const byCode = new Map<string, Choice>();
    for (const [code, name] of Object.entries(SAMSUNG_MODELS)) byCode.set(code, { code, name, from: 'built-in' });
    for (const entry of catalogEntries) { const code = modelCode4(entry.modelCode); if (code && entry.name) byCode.set(code, { code, name: entry.name, from: 'catalog' }); }
    for (const [code, name] of Object.entries(customModels)) byCode.set(code, { code, name, from: 'mine' });
    for (const model of scannedModels) { const code = modelCode4(model); if (code && !byCode.has(code)) byCode.set(code, { code, name: '', from: 'not named' }); }
    return [...byCode.values()].sort((a, b) => (a.name || `~${a.code}`).localeCompare(b.name || `~${b.code}`));
  }, [customModels, catalogEntries, scannedModels]);

  const currentCode = modelCode4(value);
  const current = currentCode ? choices.find(choice => choice.code === currentCode) : undefined;
  const query = search.trim().toLowerCase();
  const shown = query ? choices.filter(choice => `${choice.name} SM-${choice.code} ${FROM_LABEL[choice.from]}`.toLowerCase().includes(query)) : choices;

  function openDialog() { setView('list'); setSearch(''); setMessage(''); setOpen(true); }
  function pick(code: string) { onChange(`SM-${code}`); setOpen(false); }
  function saveNew() {
    const code = normalizeCode(newCode), name = cleanName(newName);
    if (!code) { setMessage('Type a model code such as SM-A077 (a letter and three digits).'); return; }
    if (!name) { setMessage('Type the name you want to see, for example Galaxy A07.'); return; }
    if (!onAddModel(code, name)) { setMessage('Could not save. Device storage is full.'); return; }
    onChange(`SM-${code}`);
    setOpen(false); setNewCode(''); setNewName('');
  }

  const label = value.trim() ? (current ? `${current.name || `SM-${current.code}`} · ${value.trim()}` : value.trim()) : 'Choose a model…';

  return <div className="model-picker">
    <button type="button" id={id} className="model-picker-button" aria-haspopup="dialog" onClick={openDialog}>
      <span>{label}</span><b aria-hidden="true">▾</b>
    </button>
    {open && <div className="modal-backdrop"><section className="modal model-dialog" role="dialog" aria-modal="true" aria-label="Choose the device model">
      <div className="modal-head">
        <h2>{view === 'add' ? 'Add a new model' : view === 'type' ? 'Type a model' : 'Choose the model'}</h2>
        <button type="button" className="subtle-btn" onClick={() => setOpen(false)}>Close</button>
      </div>
      {view === 'list' && <>
        <input className="model-search" aria-label="Search models" autoFocus placeholder={`Search ${choices.length} models`} value={search} onChange={event => setSearch(event.target.value)} />
        <div className="model-choices" role="list">
          {shown.map(choice => <button key={choice.code} type="button" role="listitem" className={`model-choice${choice.code === currentCode ? ' selected' : ''}`} onClick={() => pick(choice.code)}>
            <strong>{choice.name || `SM-${choice.code}`}</strong>
            <small>SM-{choice.code} · {FROM_LABEL[choice.from]}</small>
          </button>)}
          {shown.length === 0 && <p className="settings-help">No model matches “{search}”. Add it below.</p>}
        </div>
        <div className="model-dialog-actions">
          <button type="button" className="primary" onClick={() => { setView('add'); setNewCode(query && normalizeCode(search) ? `SM-${normalizeCode(search)}` : currentCode ? `SM-${currentCode}` : ''); setNewName(''); setMessage(''); }}>＋ Add a new model</button>
          <button type="button" className="subtle-btn" onClick={() => setView('type')}>Type for this phone only</button>
        </div>
      </>}
      {view === 'add' && <div className="model-add">
        <p className="settings-help">This model is not in the list. Save its code and name once and every phone of that model uses it.</p>
        <input aria-label="New model code" autoFocus onFocus={event => event.target.select()} value={newCode} maxLength={24} autoCapitalize="characters" placeholder="Model code, for example SM-A077" onChange={event => setNewCode(event.target.value)} />
        <input aria-label="New model name" value={newName} maxLength={80} placeholder="Name, for example Galaxy A07" onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveNew(); } }} />
        {message && <small role="alert">{message}</small>}
        <div className="model-add-actions">
          <button type="button" className="primary" onClick={saveNew}>Save model</button>
          <button type="button" className="subtle-btn" onClick={() => setView('list')}>Back to the list</button>
        </div>
      </div>}
      {view === 'type' && <div className="model-add">
        <p className="settings-help">This only changes this phone. It is not added to your list.</p>
        <input aria-label="Type the model code" autoFocus value={value} placeholder="SM-A077F" onChange={event => onChange(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); setOpen(false); onEnter?.(); } }} />
        <div className="model-add-actions">
          <button type="button" className="primary" onClick={() => { setOpen(false); onEnter?.(); }}>Done</button>
          <button type="button" className="subtle-btn" onClick={() => setView('list')}>Back to the list</button>
        </div>
      </div>}
    </section></div>}
  </div>;
}
