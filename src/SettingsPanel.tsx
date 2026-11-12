import { useRef, useState } from 'react';
import { cleanName, MAX_CUSTOM_MODELS, normalizeCode, parseModelFile, scannedDevices, writeCustomModels, type CustomModels } from './custom-models';
import { SAMSUNG_MODELS } from './samsung-models';
import { CATALOG_AUTO_KEY, readCatalogEntries } from './SamsungCatalog';

type Props = {
  scannedModels: string[];
  catalogEntries: { name: string; modelCode: string }[];
  customModels: CustomModels;
  onModelsChange: (models: CustomModels) => void;
  onCatalogChange: () => void;
  /** Fix a model code on every scanned phone that has it; returns how many phones changed. */
  onChangeCode: (from: string, to: string) => number;
  onDownload: (blob: Blob, filename: string) => void;
  onClose: () => void;
};

type SpeedBridge = { speedInfo?: () => string; setSpeedMode?: (mode: string) => boolean };
type SpeedInfo = { mode: string; label: string; startWorkers: number; maxWorkers: number; capacity: number; cores: number; ramGb: number; lastRate: number; lastWorkers: number; lastMode: string; batterySaver?: boolean; hot?: boolean; lowRam?: boolean; androidVersion?: string; device?: string };
const SPEED_MODES = [
  { id: 'auto', name: 'Auto', hint: 'Starts gently, speeds up while the phone keeps up (recommended)' },
  { id: 'turbo', name: 'Turbo', hint: 'Most photos at once. Phone may get warm' },
  { id: 'balanced', name: 'Balanced', hint: 'Two photos at once' },
  { id: 'safe', name: 'Safe', hint: 'One photo at a time. Coolest, slowest' }
] as const;
const speedBridge = () => (window as Window & { AndroidScanner?: SpeedBridge }).AndroidScanner;
function readSpeed(): SpeedInfo | null {
  const bridge = speedBridge();
  if (!bridge?.speedInfo) return null;
  try { return JSON.parse(bridge.speedInfo()) as SpeedInfo; } catch { return null; }
}

/** Settings: your own Samsung model names (add, edit, delete, import, export) and the downloaded catalog files. */
export function SettingsPanel({ scannedModels, catalogEntries, customModels, onModelsChange, onCatalogChange, onChangeCode, onDownload, onClose }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  const [editCode, setEditCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [speed, setSpeed] = useState<SpeedInfo | null>(readSpeed);
  const [bulk, setBulk] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [auto, setAuto] = useState(() => localStorage.getItem(CATALOG_AUTO_KEY) !== 'off');
  const fileInput = useRef<HTMLInputElement>(null);
  const [devFilter, setDevFilter] = useState<'missing' | 'all'>('missing');
  const [devEditing, setDevEditing] = useState('');
  const [devDraft, setDevDraft] = useState('');
  const devices = scannedDevices(scannedModels, customModels, catalogEntries);
  const missingCount = devices.rows.filter(row => row.source === 'missing').length;
  const shownDevices = devFilter === 'missing' ? devices.rows.filter(row => row.source === 'missing') : devices.rows;
  const sourceLabel = { mine: 'My name', 'built-in': 'Built-in', catalog: 'Catalog', missing: 'Not in catalog' } as const;

  const key = normalizeCode(code);
  const builtIn = key ? SAMSUNG_MODELS[key] : '';
  const entries = Object.entries(customModels).sort(([a], [b]) => a.localeCompare(b))
    .filter(([c, n]) => `${c} ${n}`.toLowerCase().includes(search.trim().toLowerCase()));
  const catalogCount = readCatalogEntries().length;
  const catalogDate = (() => { try { return (JSON.parse(localStorage.getItem('samsung-catalog') || 'null') as { updatedAt?: string } | null)?.updatedAt?.slice(0, 10) || ''; } catch { return ''; } })();

  function chooseSpeed(mode: string) {
    if (!speedBridge()?.setSpeedMode?.(mode)) { setMessage('Could not save the scan speed.'); return; }
    setSpeed(readSpeed());
    setMessage('Scan speed saved. It applies to the next scan.');
  }

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
    const label = cleanName(draft), newKey = normalizeCode(editCode);
    if (!newKey) { setMessage('Type a model code such as SM-R420 (a letter and three digits).'); return; }
    if (!label) { setMessage('The name cannot be empty. Use Delete to remove the model.'); return; }
    if (newKey !== codeKey && customModels[newKey] && !window.confirm(`SM-${newKey} already has the name "${customModels[newKey]}". Replace it?`)) return;
    const { [codeKey]: _old, ...rest } = customModels;
    if (save({ ...rest, [newKey]: label }, newKey !== codeKey ? `Changed SM-${codeKey} to SM-${newKey}: ${label}.` : `Saved SM-${codeKey}.`)) setEditing('');
  }

  function remove(codeKey: string) {
    const { [codeKey]: _removed, ...rest } = customModels;
    save(rest, SAMSUNG_MODELS[codeKey] ? `Deleted. SM-${codeKey} shows the built-in name again.` : `Deleted SM-${codeKey}.`);
  }

  function saveDevice(codeKey: string) {
    const label = cleanName(devDraft), newKey = normalizeCode(devCode);
    if (!newKey) { setMessage('Type a model code such as SM-R420 (a letter and three digits).'); return; }
    if (!label) { setMessage('Type the name you want to see for this model.'); return; }
    let base = customModels;
    if (newKey !== codeKey) {
      const count = scannedModels.filter(model => normalizeCode(model) === codeKey).length;
      if (!window.confirm(`Change SM-${codeKey} to SM-${newKey} on ${count} scanned phone${count === 1 ? '' : 's'}? Use this to fix a code that was read wrongly.`)) return;
      onChangeCode(codeKey, newKey);
      const { [codeKey]: _old, ...rest } = customModels;
      base = rest;
    }
    if (!base[newKey] && Object.keys(base).length >= MAX_CUSTOM_MODELS) { setMessage(`You can keep up to ${MAX_CUSTOM_MODELS} models.`); return; }
    if (save({ ...base, [newKey]: label }, newKey !== codeKey ? `Changed SM-${codeKey} to SM-${newKey}: ${label}.` : `Saved SM-${codeKey}: ${label}.`)) setDevEditing('');
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

  function addBulk() {
    const { entries: found, skipped } = parseModelFile(bulk);
    const added = Object.keys(found).length;
    if (!added) { setMessage('Nothing to add. Write one model per line, for example: SM-R420, Galaxy Buds3 FE'); return; }
    const merged = { ...customModels, ...found };
    if (Object.keys(merged).length > MAX_CUSTOM_MODELS) { setMessage(`That would pass ${MAX_CUSTOM_MODELS} models. Nothing was added.`); return; }
    if (save(merged, `Added ${added} model${added === 1 ? '' : 's'}.${skipped ? ` ${skipped} line${skipped === 1 ? '' : 's'} skipped.` : ''}`)) setBulk('');
  }

  function fillMissing() {
    const lines = devices.rows.filter(row => row.source === 'missing').map(row => `SM-${row.code}, `).join('\n');
    if (lines) setBulk(lines);
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
    <p className="settings-help settings-intro"><b>Model code</b> is the SM-… code printed on the phone. <b>Name</b> is what you want to see in the app instead of the code. Edit changes both. Changing the code of a scanned device also fixes it on every phone that has it.</p>

    {speed && <>
      <h3>Phone scanning power</h3>
      <p className="settings-help">Choose how hard this phone works while scanning. Auto adds more photos at once while the phone stays cool and has free memory, and backs off if it heats up.</p>
      <div className="speed-modes" role="group" aria-label="Phone scanning power">
        {SPEED_MODES.map(option => <button key={option.id} type="button" className={`subtle-btn ${speed.mode === option.id ? 'active' : ''}`} aria-pressed={speed.mode === option.id} onClick={() => chooseSpeed(option.id)}>{option.name}<small>{option.hint}</small></button>)}
      </div>
      <div className="speed-device">
        <strong>{speed.device || 'This phone'}</strong>{speed.androidVersion ? ` · Android ${speed.androidVersion}` : ''}
        <span>{speed.lowRam ? 'Low-memory phone: scans one photo at a time.' : speed.batterySaver ? 'Battery saver is on: Auto is limited to 2 photos at once.' : speed.hot ? 'The phone is hot: scanning will slow down to cool it.' : 'Ready: Auto starts with 2 photos at once and grows to the limit below while the phone stays cool.'}</span>
        <button type="button" className="subtle-btn" onClick={() => { setSpeed(readSpeed()); setMessage('Checked this phone again.'); }}>Check this phone again</button>
      </div>
      <div className="speed-stats"><span>{speed.cores} CPU cores</span><span>{speed.ramGb} GB memory</span><span>Up to {speed.maxWorkers} photo{speed.maxWorkers === 1 ? '' : 's'} at once</span>{speed.lastRate > 0 && <span>Last scan: {speed.lastRate} photos/min ({speed.lastMode}, up to {speed.lastWorkers} at once)</span>}</div>
    </>}

    <h3>Devices in my scans</h3>
    <p className="settings-help">{devices.rows.length ? (missingCount ? <><b>{missingCount}</b> scanned model{missingCount === 1 ? ' is' : 's are'} not in any catalog. Add a name so {missingCount === 1 ? 'it shows' : 'they show'} instead of the code.</> : 'Every scanned model is in a catalog or has your name.') : 'No scanned models yet. Scan some phones and they appear here.'}{devices.noCode > 0 && ` ${devices.noCode} phone${devices.noCode === 1 ? ' has' : 's have'} no model code.`}</p>
    {devices.rows.length > 0 && <div className="settings-tabs" role="group" aria-label="Show devices">
      <button className={devFilter === 'missing' ? 'active' : ''} aria-pressed={devFilter === 'missing'} onClick={() => setDevFilter('missing')}>Not in catalog ({missingCount})</button>
      <button className={devFilter === 'all' ? 'active' : ''} aria-pressed={devFilter === 'all'} onClick={() => setDevFilter('all')}>All scanned ({devices.rows.length})</button>
    </div>}
    {shownDevices.length > 0 && <ul className="settings-list device-list" aria-label="Scanned devices">
      {shownDevices.map(row => <li key={row.code} className={`device-${row.source}`}>
        {devEditing === row.code
          ? <>
            <div className="cap-field"><small>Model code</small><input aria-label={`Code for SM-${row.code}`} value={devCode} maxLength={24} autoCapitalize="characters" placeholder="SM-R420" onChange={event => setDevCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveDevice(row.code); if (event.key === 'Escape') setDevEditing(''); }} /></div>
            <div className="cap-field grow"><small>Name</small><input autoFocus aria-label={`Name for SM-${row.code}`} value={devDraft} maxLength={80} placeholder="Name to show" onChange={event => setDevDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveDevice(row.code); if (event.key === 'Escape') setDevEditing(''); }} /></div>
            <button className="primary" onClick={() => saveDevice(row.code)}>Save</button><button className="subtle-btn" onClick={() => setDevEditing('')}>Cancel</button>
          </>
          : <>
            <div className="cap-field"><small>Model code</small><b>SM-{row.code}</b></div>
            <div className="cap-field grow"><small>Name</small><span>{row.name || <em>No name yet</em>}</span><small>{row.count} phone{row.count === 1 ? '' : 's'} · {sourceLabel[row.source]}</small></div>
            <button className={row.source === 'missing' ? 'primary' : 'subtle-btn'} onClick={() => { setDevEditing(row.code); setDevDraft(row.name); setDevCode(`SM-${row.code}`); }}>{row.source === 'missing' ? 'Add' : 'Edit'}</button>
            {row.source === 'mine' && <button className="subtle-btn danger" aria-label={`Delete my name for SM-${row.code}`} onClick={() => remove(row.code)}>Delete</button>}
          </>}
      </li>)}
    </ul>}

    <h3>My Samsung models</h3>
    <p className="settings-help">Teach the app a model code once and it shows the name instead of the code. Your names come first, then the built-in list ({Object.keys(SAMSUNG_MODELS).length} models), then the downloaded catalog.</p>
    <div className="settings-add">
      <label>Model code (on the phone)<input value={code} placeholder="SM-R420" maxLength={24} autoCapitalize="characters" onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} /></label>
      <label>Name (what you want to see)<input value={name} placeholder="Galaxy Buds3 FE" maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} /></label>
      <button className="primary" onClick={add}>{key && customModels[key] ? 'Update' : 'Add model'}</button>
    </div>
    {key && <small className="settings-help">{customModels[key] ? `SM-${key} is already yours: ${customModels[key]}.` : builtIn ? `SM-${key} is built in as ${builtIn}. Adding it uses your name instead.` : `SM-${key} is not in the built-in list.`}</small>}

    {Object.keys(customModels).length > 0 && <button type="button" className="subtle-btn view-models-btn" onClick={() => setListOpen(true)}>View my models ({Object.keys(customModels).length})</button>}
    {listOpen && Object.keys(customModels).length > 0 && <div className="modal-backdrop"><section className="modal models-dialog" role="dialog" aria-modal="true" aria-label="My models">
      <div className="modal-head"><h2>My models ({Object.keys(customModels).length})</h2><button className="subtle-btn" onClick={() => setListOpen(false)}>Close</button></div>
      {Object.keys(customModels).length > 6 && <input className="settings-search" aria-label="Search my models" placeholder="Search my models" value={search} onChange={event => setSearch(event.target.value)} />}
      <ul className="settings-list">
        {entries.map(([codeKey, label]) => <li key={codeKey}>
          {editing === codeKey
            ? <>
              <div className="cap-field"><small>Model code</small><input aria-label={`Code for SM-${codeKey}`} value={editCode} maxLength={24} autoCapitalize="characters" placeholder="SM-R420" onChange={event => setEditCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveEdit(codeKey); if (event.key === 'Escape') setEditing(''); }} /></div>
              <div className="cap-field grow"><small>Name</small><input autoFocus aria-label={`Name for SM-${codeKey}`} value={draft} maxLength={80} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveEdit(codeKey); if (event.key === 'Escape') setEditing(''); }} /></div>
              <button className="primary" onClick={() => saveEdit(codeKey)}>Save</button><button className="subtle-btn" onClick={() => setEditing('')}>Cancel</button>
            </>
            : <>
              <div className="cap-field"><small>Model code</small><b>SM-{codeKey}</b></div>
              <div className="cap-field grow"><small>Name</small><span>{label}</span></div>
              <button className="subtle-btn" onClick={() => { setEditing(codeKey); setDraft(label); setEditCode(`SM-${codeKey}`); }}>Edit</button>
              <button className="subtle-btn danger" aria-label={`Delete SM-${codeKey}`} onClick={() => remove(codeKey)}>Delete</button>
            </>}
        </li>)}
        {!entries.length && <li><em>No match.</em></li>}
      </ul>
    </section></div>}
    {Object.keys(customModels).length === 0 && <p className="settings-help"><em>You have not added any models yet.</em></p>}

    <div className="settings-bulk">
      <label htmlFor="bulk-models"><b>Add many at once</b><br /><small className="settings-help">One model per line: code, then name. Paste a list or type it. Existing codes get the new name.</small></label>
      <textarea id="bulk-models" value={bulk} placeholder={'SM-R420, Galaxy Buds3 FE\nSM-A276, Galaxy A27\nSM-S948, Galaxy S26 Ultra'} onChange={event => setBulk(event.target.value)} spellCheck={false} autoCapitalize="characters" />
      <div className="settings-actions">
        <button className="primary" disabled={!bulk.trim()} onClick={addBulk}>Add all</button>
        <button className="subtle-btn" disabled={missingCount === 0} onClick={fillMissing}>Fill in unknown models ({missingCount})</button>
        <button className="subtle-btn" disabled={!bulk} onClick={() => setBulk('')}>Clear</button>
      </div>
    </div>

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
