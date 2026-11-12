import { useMemo, useState } from 'react';
import { SAMSUNG_MODELS } from './samsung-models';
import { modelCode4 } from './phone-names';
import { cleanName, normalizeCode } from './custom-models';

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

const OTHER = '__other__';
const ADD = '__add__';
const CURRENT = '__current__';

/**
 * Device model as a drop-down of every model the app knows: built-in list, the downloaded catalog, your own
 * names and models already scanned. "Add a model" saves a new code and name to your list; "Other" types a code for this phone only.
 */
export function ModelPicker({ id, value, onChange, customModels, catalogEntries, scannedModels, onAddModel, onEnter }: Props) {
  const [mode, setMode] = useState<'pick' | 'type' | 'add'>('pick');
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');

  const options = useMemo(() => {
    const byCode = new Map<string, { name: string; from: string }>();
    for (const [code, name] of Object.entries(SAMSUNG_MODELS)) byCode.set(code, { name, from: 'built-in' });
    for (const entry of catalogEntries) { const code = modelCode4(entry.modelCode); if (code && entry.name) byCode.set(code, { name: entry.name, from: 'catalog' }); }
    for (const [code, name] of Object.entries(customModels)) byCode.set(code, { name, from: 'mine' });
    for (const model of scannedModels) { const code = modelCode4(model); if (code && !byCode.has(code)) byCode.set(code, { name: '', from: 'not named' }); }
    return [...byCode].map(([code, info]) => ({ code, name: info.name, from: info.from, label: info.name ? `${info.name} (SM-${code})` : `SM-${code} (no name yet)` }))
      .sort((a, b) => (a.name || `~${a.code}`).localeCompare(b.name || `~${b.code}`));
  }, [customModels, catalogEntries, scannedModels]);

  const query = search.trim().toLowerCase();
  const shown = query ? options.filter(option => `${option.label} ${option.from}`.toLowerCase().includes(query)) : options;
  const currentCode = modelCode4(value);
  const known = currentCode ? options.find(option => option.code === currentCode) : undefined;
  const selectValue = mode === 'type' ? OTHER : mode === 'add' ? ADD : !value.trim() ? '' : CURRENT;

  function saveNew() {
    const code = normalizeCode(newCode), name = cleanName(newName);
    if (!code) { setMessage('Type a model code such as SM-A077 (a letter and three digits).'); return; }
    if (!name) { setMessage('Type the name you want to see, for example Galaxy A07.'); return; }
    if (!onAddModel(code, name)) { setMessage('Could not save. Device storage is full.'); return; }
    onChange(`SM-${code}`);
    setMode('pick'); setNewCode(''); setNewName(''); setMessage(''); setSearch('');
  }

  return <div className="model-picker">
    {options.length > 12 && mode === 'pick' && <input className="model-search" aria-label="Search the model list" placeholder={`Search ${options.length} models`} value={search} onChange={event => setSearch(event.target.value)} />}
    <select id={id} aria-label="Device model" value={selectValue} onChange={event => {
      const next = event.target.value;
      if (next === OTHER) { setMode('type'); return; }
      if (next === ADD) { setMode('add'); setNewCode(currentCode ? `SM-${currentCode}` : ''); setNewName(''); setMessage(''); return; }
      setMode('pick');
      if (next === CURRENT || !next) return;
      onChange(`SM-${next}`);
    }}>
      {!value.trim() && mode === 'pick' && <option value="">Choose a model…</option>}
      {value.trim() && mode === 'pick' && <option value={CURRENT}>{known ? `${known.name || `SM-${known.code}`} · ${value.trim()}` : value.trim()}</option>}
      {shown.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
      {query && shown.length === 0 && <option disabled value="">No match in the catalog</option>}
      <option value={ADD}>＋ Add a new model to the list…</option>
      <option value={OTHER}>Other — type a model for this phone only…</option>
    </select>
    {mode === 'type' && <input aria-label="Type the model code" autoFocus value={value} placeholder="SM-A077F" onChange={event => onChange(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter?.(); } }} />}
    {mode === 'add' && <div className="model-add" role="group" aria-label="Add a new model">
      <p className="settings-help">This model is not in the catalog. Save its code and name once and every phone of that model uses it.</p>
      <input aria-label="New model code" autoFocus onFocus={event => event.target.select()} value={newCode} maxLength={24} autoCapitalize="characters" placeholder="Model code, for example SM-A077" onChange={event => setNewCode(event.target.value)} />
      <input aria-label="New model name" value={newName} maxLength={80} placeholder="Name, for example Galaxy A07" onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveNew(); } }} />
      {message && <small role="alert">{message}</small>}
      <div className="model-add-actions">
        <button type="button" className="primary" onClick={saveNew}>Save model</button>
        <button type="button" className="subtle-btn" onClick={() => { setMode('pick'); setMessage(''); }}>Cancel</button>
      </div>
    </div>}
  </div>;
}
