import { useMemo, useState } from 'react';
import { addCatalogRow, countDeletedCatalogRows, deleteCatalogRow, readCatalogRows, renameCatalogRow, restoreDeletedCatalogRows, type CatalogRow } from './SamsungCatalog';
import { useBackLayer } from './back-layer';

type Props = { onClose: () => void; onChanged: () => void };
const PAGE = 120;

/** The downloaded Samsung catalog in a big dialog: search, scroll, edit a name, delete an entry, add your own. */
export function CatalogDialog({ onClose, onChanged }: Props) {
  const [rows, setRows] = useState<CatalogRow[]>(readCatalogRows);
  const [deleted, setDeleted] = useState(countDeletedCatalogRows);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [confirming, setConfirming] = useState('');
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');
  useBackLayer(true, onClose, 'catalog-dialog');

  const query = search.trim().toLowerCase();
  const matches = useMemo(() => query ? rows.filter(row => `${row.name} ${row.modelCode} ${row.region}`.toLowerCase().includes(query)) : rows, [rows, query]);
  const visible = matches.slice(0, shown);

  function refresh(note: string) {
    setRows(readCatalogRows()); setDeleted(countDeletedCatalogRows()); setMessage(note); onChanged();
  }
  function saveEdit(row: CatalogRow) {
    if (!renameCatalogRow(row.id, draftName, row.mine ? draftCode : undefined)) { setMessage('Type a name first, or the device storage is full.'); return; }
    setEditing(''); refresh(`Saved ${row.mine ? draftCode || row.modelCode : row.modelCode}.`);
  }
  function remove(row: CatalogRow) {
    if (!deleteCatalogRow(row.id)) { setMessage('Could not delete. Device storage is full.'); return; }
    setConfirming(''); refresh(`Deleted ${row.modelCode}.${row.mine ? '' : ' It stays hidden after catalog updates. Use Restore deleted to bring it back.'}`);
  }
  function add() {
    if (!addCatalogRow(newCode, newName)) { setMessage('Type a model code such as SM-A077F and a name, for example Galaxy A07.'); return; }
    setAdding(false); setNewCode(''); setNewName(''); setSearch(''); refresh('Added to the catalog.');
  }

  return <div className="modal-backdrop"><section className="modal catalog-dialog" role="dialog" aria-modal="true" aria-label="Samsung catalog">
    <div className="modal-head"><h2>Samsung catalog ({rows.length})</h2><button type="button" className="subtle-btn" onClick={onClose}>Close</button></div>
    <input className="model-search" aria-label="Search the catalog" autoFocus placeholder={`Search ${rows.length} products`} value={search} onChange={event => { setSearch(event.target.value); setShown(PAGE); }} />
    <div className="catalog-actions">
      <button type="button" className="primary" onClick={() => { setAdding(value => !value); setMessage(''); }}>{adding ? 'Cancel adding' : '＋ Add a model'}</button>
      {deleted > 0 && <button type="button" className="subtle-btn" onClick={() => { restoreDeletedCatalogRows(); refresh(`Restored ${deleted} deleted entr${deleted === 1 ? 'y' : 'ies'}.`); }}>Restore deleted ({deleted})</button>}
    </div>
    {adding && <div className="model-add" role="group" aria-label="Add a catalog entry">
      <input aria-label="Model code" autoFocus value={newCode} maxLength={24} autoCapitalize="characters" placeholder="Model code, for example SM-A077F" onChange={event => setNewCode(event.target.value)} />
      <input aria-label="Name" value={newName} maxLength={120} placeholder="Name, for example Galaxy A07" onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} />
      <button type="button" className="primary" onClick={add}>Add to the catalog</button>
    </div>}
    {message && <p className="settings-message" role="status">{message}</p>}
    <ul className="catalog-list" aria-label="Catalog entries">
      {visible.map(row => <li key={row.id} className="catalog-row">
        {editing === row.id
          ? <div className="catalog-edit">
            <input aria-label={`Name for ${row.modelCode}`} autoFocus value={draftName} maxLength={120} onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveEdit(row); if (event.key === 'Escape') setEditing(''); }} />
            {row.mine && <input aria-label="Model code" value={draftCode} maxLength={24} autoCapitalize="characters" onChange={event => setDraftCode(event.target.value)} />}
            <div className="catalog-buttons"><button type="button" className="primary" onClick={() => saveEdit(row)}>Save</button><button type="button" className="subtle-btn" onClick={() => setEditing('')}>Cancel</button></div>
          </div>
          : <>
            <div className="catalog-info"><strong>{row.name}</strong><small>{row.modelCode}{row.region ? ` · ${row.region}` : ''}{row.edited ? ' · edited' : ''}</small></div>
            {confirming === row.id
              ? <div className="catalog-buttons"><button type="button" className="subtle-btn danger" onClick={() => remove(row)}>Delete</button><button type="button" className="subtle-btn" onClick={() => setConfirming('')}>Keep</button></div>
              : <div className="catalog-buttons"><button type="button" className="subtle-btn" onClick={() => { setEditing(row.id); setDraftName(row.name); setDraftCode(row.modelCode); setConfirming(''); }}>Edit</button><button type="button" className="subtle-btn danger" onClick={() => setConfirming(row.id)}>Delete</button></div>}
          </>}
      </li>)}
      {matches.length === 0 && <li className="catalog-row"><em>{rows.length ? `No product matches “${search}”.` : 'The catalog is empty. Add a model, or let the app download it.'}</em></li>}
    </ul>
    {matches.length > shown && <button type="button" className="subtle-btn" onClick={() => setShown(value => value + PAGE)}>Show more ({matches.length - shown} left)</button>}
  </section></div>;
}
