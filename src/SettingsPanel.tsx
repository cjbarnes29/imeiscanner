import { useRef, useState } from 'react';
import { cleanName, MAX_CUSTOM_MODELS, normalizeCode, parseModelFile, writeCustomModels, type CustomModels } from './custom-models';
import { SAMSUNG_MODELS } from './samsung-models';
import { CATALOG_AUTO_KEY, readCatalogEntries } from './SamsungCatalog';

type Props = {
  customModels: CustomModels;
  onModelsChange: (models: CustomModels) => void;
  onCatalogChange: () => void;
  onDownload: (blob: Blob, filename: string) => void;
  onClose: () => void;
};

/** Settings: your own Samsung model names (add, edit, delete, import, export) and the downloaded catalog files. */
export function SettingsPanel({ customModels, onModelsChange, onCatalogChange, onDownload, onClose }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [auto, setAuto] = useState(() => localStorage.getItem(CATALOG_AUTO_KEY) !== 'off');
  const fileInput = useRef<HTMLInputElement>(null);

  const key = normalizeCode(code);
  const builtIn = key ? SAMSUNG_MODELS[key] : '';
  const entries = Object.entries(customModels).sort(([a], [b]) => a.localeCompare(b))
    .filter(([c, n]) => `${c} ${n}`.toLowerCase().includes(search.trim().toLowerCase()));
  const catalogCount = readCatalogEntries().length;
  const catalogDate = (() => { try { return (JSON.parse(localStorage.getItem('samsung-catalog') || 'null') as { updatedAt?: string } | null)?.updatedAt?.slice(0, 10) || ''; } catch { return ''; } })();

  function save(next: CustomModels, done: string) {
    if (!writeCustomModels(next)) { setMessage('Could not save. Device storage is full.'); return false; }
    onModelsChange(next);
    setMessage(done);
    return true;
  }

  function add() {
    const label = cleanName(name);
    if (!key) { setMessage('Type a model code such as SM-R420 (a letter and three digits).'); return; }
    if (!label) { setMessage('Type the name you want to see, for example Galaxy Buds3 FE.'); return; }
    if (!customModels[key] && Object.keys(customModels).length >= MAX_CUSTOM_MODELS) { setMessage(`You can keep up to ${MAX_CUSTOM_MODELS} models.`); return; }
    if (save({ ...customModels, [key]: label }, `${customModels[key] ? 'Updated' : 'Added'} SM-${key}: ${label}.`)) { setCode(''); setName(''); }
  }

  function saveEdit(codeKey: string) {
    const label = cleanName(draft);
    if (!label) { setMessage('The name cannot be empty. Use Delete to remove the model.'); return; }
    if (save({ ...customModels, [codeKey]: label }, `Saved SM-${codeKey}.`)) setEditing('');
  }

  function remove(codeKey: string) {
    const { [codeKey]: _removed, ...rest } = customModels;
    save(rest, SAMSUNG_MODELS[codeKey] ? `Deleted. SM-${codeKey} shows the built-in name again.` : `Deleted SM-${codeKey}.`);
  }

  function removeAll() {
    if (!entries.length && !Object.keys(customModels).length) return;
    if (!window.confirm(`Delete all ${Object.keys(customModels).length} of your models? Built-in names stay.`)) return;
    save({}, 'All your models were deleted. Built-in names stay.');
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setMessage('That file is too large. Choose a file under 2 MB.'); return; }
    const { entries: found, skipped } = parseModelFile(await file.text());
    const merged = { ...customModels, ...found };
    const added = Object.keys(found).length;
    if (!added) { setMessage('No models found. Use lines like "SM-R420, Galaxy Buds3 FE", or a JSON file.'); return; }
    if (Object.keys(merged).length > MAX_CUSTOM_MODELS) { setMessage(`That would pass ${MAX_CUSTOM_MODELS} models. Nothing was imported.`); return; }
    save(merged, `Imported ${added} model${added === 1 ? '' : 's'}.${skipped ? ` ${skipped} line${skipped === 1 ? '' : 's'} skipped.` : ''}`);
  }

  function exportFile() {
    if (!Object.keys(customModels).length) { setMessage('You have no models to export yet.'); return; }
    onDownload(new Blob([JSON.stringify(customModels, null, 2)], { type: 'application/json' }), 'my-samsung-models.json');
  }

  function deleteCatalog() {
    if (!window.confirm('Delete the downloaded Samsung catalog from this device?' + (auto ? ' It downloads again next time the app opens. Turn off automatic download below to keep it deleted.' : ''))) return;
    try { localStorage.removeItem('samsung-catalog'); localStorage.removeItem('samsung-catalog-corrections'); } catch { /* nothing stored */ }
    onCatalogChange();
    setMessage('Downloaded catalog and name corrections deleted.');
  }

  function toggleAuto(on: boolean) {
    setAuto(on);
    try { if (on) localStorage.removeItem(CATALOG_AUTO_KEY); else localStorage.setItem(CATALOG_AUTO_KEY, 'off'); } catch { /* ignore */ }
  }

  return <div className="modal-backdrop"><section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
    <div className="modal-head"><h2>Settings</h2><button className="subtle-btn" onClick={onClose}>Close</button></div>
    {message && <p className="settings-message" role="status">{message}</p>}

    <h3>My Samsung models</h3>
    <p className="settings-help">Teach the app a model code once and it shows the name instead of the code. Your names come first, then the built-in list ({Object.keys(SAMSUNG_MODELS).length} models), then the downloaded catalog.</p>
    <div className="settings-add">
      <label>Model code<input value={code} placeholder="SM-R420" maxLength={24} autoCapitalize="characters" onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} /></label>
      <label>Name to show<input value={name} placeholder="Galaxy Buds3 FE" maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} /></label>
      <button className="primary" onClick={add}>{key && customModels[key] ? 'Update' : 'Add model'}</button>
    </div>
    {key && <small className="settings-help">{customModels[key] ? `SM-${key} is already yours: ${customModels[key]}.` : builtIn ? `SM-${key} is built in as ${builtIn}. Adding it uses your name instead.` : `SM-${key} is not in the built-in list.`}</small>}

    {Object.keys(customModels).length > 0 && <>
      {Object.keys(customModels).length > 6 && <input className="settings-search" aria-label="Search my models" placeholder="Search my models" value={search} onChange={event => setSearch(event.target.value)} />}
      <ul className="settings-list">
        {entries.map(([codeKey, label]) => <li key={codeKey}>
          <b>SM-{codeKey}</b>
          {editing === codeKey
            ? <><input autoFocus aria-label={`Name for SM-${codeKey}`} value={draft} maxLength={80} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveEdit(codeKey); if (event.key === 'Escape') setEditing(''); }} />
              <button className="primary" onClick={() => saveEdit(codeKey)}>Save</button><button className="subtle-btn" onClick={() => setEditing('')}>Cancel</button></>
            : <><span>{label}</span>
              <button className="subtle-btn" onClick={() => { setEditing(codeKey); setDraft(label); }}>Edit</button>
              <button className="subtle-btn danger" aria-label={`Delete SM-${codeKey}`} onClick={() => remove(codeKey)}>Delete</button></>}
        </li>)}
        {!entries.length && <li><em>No match.</em></li>}
      </ul>
    </>}
    {Object.keys(customModels).length === 0 && <p className="settings-help"><em>You have not added any models yet.</em></p>}

    <div className="settings-actions">
      <input ref={fileInput} type="file" accept=".json,.csv,.txt,application/json,text/plain,text/csv" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} />
      <button className="subtle-btn" onClick={() => fileInput.current?.click()}>Import file…</button>
      <button className="subtle-btn" disabled={!Object.keys(customModels).length} onClick={exportFile}>Export my models</button>
      <button className="subtle-btn danger" disabled={!Object.keys(customModels).length} onClick={removeAll}>Delete all my models</button>
    </div>
    <small className="settings-help">Import accepts lines such as <code>SM-R420, Galaxy Buds3 FE</code>, a JSON file like <code>{'{"R420": "Galaxy Buds3 FE"}'}</code>, or a catalog file. Imported names replace the same codes.</small>

    <h3>Downloaded Samsung catalog</h3>
    <p className="settings-help">{catalogCount ? `${catalogCount} products saved on this device${catalogDate ? `, updated ${catalogDate}` : ''}.` : 'No catalog is saved on this device.'}</p>
    <label className="settings-check"><input type="checkbox" checked={auto} onChange={event => toggleAuto(event.target.checked)} /> Download the catalog automatically when the app opens</label>
    <div className="settings-actions">
      <button className="subtle-btn danger" disabled={!catalogCount} onClick={deleteCatalog}>Delete downloaded catalog</button>
    </div>
    <small className="settings-help">Deleting the catalog does not touch your models, your scanned phones or the built-in list.</small>
  </section></div>;
}
