import { useEffect, useState } from 'react';
export const CATALOG_AUTO_KEY = 'imei-lens-catalog-auto';
const autoDownloadOff = () => { try { return localStorage.getItem(CATALOG_AUTO_KEY) === 'off'; } catch { return false; } };
type Product = { id:string; name:string; modelCode:string; region:string; sourceUrl:string; lastChecked:string; imageUrl?:string; specifications?:{name:string;value:string}[]; releaseDate?:string; compatibility?:string };
type Catalog = { updatedAt:string; products:Product[]; coverage:{ complete:boolean; pagesChecked:number } };
const DELETED_KEY = 'samsung-catalog-deleted', ADDED_KEY = 'samsung-catalog-added', CORRECTIONS_KEY = 'samsung-catalog-corrections';
type AddedProduct = { id:string; name:string; modelCode:string };
function readJson<T>(key:string, fallback:T):T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function readList<T>(key:string):T[] { const value = readJson<unknown>(key, []); return Array.isArray(value) ? value as T[] : []; }
function writeJson(key:string, value:unknown):boolean { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

export type CatalogRow = { id:string; name:string; modelCode:string; region:string; mine:boolean; edited:boolean };
/** Every catalog entry you see: the downloaded ones (minus the ones you deleted, with your corrected names) and the ones you added. */
export function readCatalogRows():CatalogRow[] {
  const catalog = readJson<Catalog | null>('samsung-catalog', null);
  const corrections = readJson<Record<string,string>>(CORRECTIONS_KEY, {});
  const deleted = new Set(readList<string>(DELETED_KEY));
  const rows:CatalogRow[] = (catalog?.products || []).filter(p => !deleted.has(p.id)).map(p => ({ id:p.id, name:corrections[p.id] || p.name, modelCode:p.modelCode, region:p.region || '', mine:false, edited:!!corrections[p.id] && corrections[p.id] !== p.name }));
  for (const item of readList<AddedProduct>(ADDED_KEY)) rows.push({ id:item.id, name:item.name, modelCode:item.modelCode, region:'Added by me', mine:true, edited:false });
  return rows;
}
const cleanCatalogName = (name:string) => name.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const cleanCatalogCode = (code:string) => code.toUpperCase().replace(/\s+/g, '').replace(/^(?=[A-Z]\d{3})/, 'SM-').slice(0, 24);
/** Edit a name (and, for entries you added, the code). Downloaded entries keep their official name underneath. */
export function renameCatalogRow(id:string, name:string, modelCode?:string):boolean {
  const clean = cleanCatalogName(name); if (!clean) return false;
  if (id.startsWith('local-')) {
    const code = modelCode ? cleanCatalogCode(modelCode) : '';
    return writeJson(ADDED_KEY, readList<AddedProduct>(ADDED_KEY).map(item => item.id === id ? { ...item, name:clean, modelCode:code || item.modelCode } : item));
  }
  return writeJson(CORRECTIONS_KEY, { ...readJson<Record<string,string>>(CORRECTIONS_KEY, {}), [id]:clean });
}
/** Delete: downloaded entries are hidden (and stay hidden after updates); your own entries are removed. */
export function deleteCatalogRow(id:string):boolean {
  if (id.startsWith('local-')) return writeJson(ADDED_KEY, readList<AddedProduct>(ADDED_KEY).filter(item => item.id !== id));
  return writeJson(DELETED_KEY, [...new Set([...readList<string>(DELETED_KEY), id])]);
}
export function addCatalogRow(modelCode:string, name:string):boolean {
  const code = cleanCatalogCode(modelCode), clean = cleanCatalogName(name);
  if (!/^[A-Z]{2,3}-[A-Z0-9]{3,}$/.test(code) || !clean) return false;
  const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return writeJson(ADDED_KEY, [...readList<AddedProduct>(ADDED_KEY), { id, name:clean, modelCode:code }]);
}
export const countDeletedCatalogRows = () => readList<string>(DELETED_KEY).length;
export const restoreDeletedCatalogRows = () => writeJson(DELETED_KEY, []);
/** Official product details (picture, source page, release date, specifications). Names are edited in Check catalog. */
export function SamsungCatalog({ onUpdated }: { onUpdated?: () => void }) {
  const [catalog,setCatalog] = useState<Catalog | null>(() => { try { return JSON.parse(localStorage.getItem('samsung-catalog') || 'null'); } catch { return null; } });
  const [query,setQuery] = useState(''), [status,setStatus] = useState('');
  const corrections = readJson<Record<string,string>>(CORRECTIONS_KEY, {});
  const [busy, setBusy] = useState(false);
  async function update() {
    if (busy) return;
    setBusy(true); setStatus('Checking published catalog…');
    try { setCatalog(await fetchSamsungCatalog()); setStatus('Catalog saved for offline use. Check the last-update date below.'); onUpdated?.(); }
    catch (error) { setStatus(`${error instanceof Error ? error.message : 'Update failed.'} Your saved catalog remains available. Retry when connected.`); }
    finally { setBusy(false); }
  }
  const deletedIds = new Set(readList<string>(DELETED_KEY));
  const matches = (catalog?.products || []).filter(p => !deletedIds.has(p.id)).filter(p => `${corrections[p.id] || p.name} ${p.modelCode} ${p.region}`.toLowerCase().includes(query.toLowerCase()));
  return <details className="catalog-panel"><summary>Official product details</summary><p>Verified Samsung product pages only. Coverage is incomplete; missing specifications and compatibility are left unknown. Daily checks run on GitHub even with the app closed.</p><button className="subtle-btn" disabled={busy} onClick={update}>{busy ? 'Updating…' : 'Update saved catalog now'}</button> <a href="https://github.com/cjbarnes29/imeiscanner/actions/workflows/catalog.yml" target="_blank" rel="noreferrer">View the catalog update job</a><p role="status">{status}</p><p>{catalog ? `${catalog.products.length} verified variants · Last update ${catalog.updatedAt}` : 'No catalog saved yet.'}</p><input aria-label="Search Samsung catalog" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Product name or model code" />{matches.slice(0,30).map(p=><details key={p.id}><summary>{corrections[p.id] || p.name} · {p.modelCode} · {p.region}</summary>
    {p.imageUrl && <img loading="lazy" src={p.imageUrl} alt={p.name} style={{width:160,height:120,objectFit:'contain'}} />}
    <p><a href={p.sourceUrl} target="_blank" rel="noreferrer">Official Samsung source</a> · Checked {p.lastChecked}</p>
    <p>Release date: {p.releaseDate || 'Not available'} · Compatibility: {p.compatibility || 'Not available'}</p>
    {(p.specifications || []).map((s,i)=><p key={i}>{s.name}: {s.value}</p>)}
  </details>)}{matches.length>30&&<p>Showing 30 results. Refine the search.</p>}</details>;
}
export function catalogModel(text:string):string | undefined {
  try { const catalog = JSON.parse(localStorage.getItem('samsung-catalog') || 'null') as Catalog | null; const corrections = JSON.parse(localStorage.getItem('samsung-catalog-corrections') || '{}'); const codes = new Set(text.toUpperCase().match(/\b(?:SM|GT|SCH|SGH|EP|EF|ET|EO)-[A-Z0-9]+\b/g) || []); const deletedList = JSON.parse(localStorage.getItem('samsung-catalog-deleted') || '[]'); const deletedIds = new Set<string>(Array.isArray(deletedList) ? deletedList : []); const matches = (catalog?.products || []).filter(p=>!deletedIds.has(p.id)).filter(p=>codes.has(p.modelCode) || [...codes].some(code => /^(?:SM-[A-Z][0-9]{3}[A-Z0-9]?|(?:EP|EF|ET|EO)-[A-Z0-9]{4,})$/.test(code) && p.modelCode.startsWith(code))); const names = [...new Set(matches.map(p=>corrections[p.id] || p.name))]; return names.length===1 ? names[0] : undefined; } catch { return undefined; }
}

/** Saved catalog entries (name + model code) for phone names; empty until the catalog is loaded. */
export function readCatalogEntries(): { name: string; modelCode: string }[] {
  return readCatalogRows().map(row => ({ name: row.name, modelCode: row.modelCode }));
}

/** Fetch the bundled/published catalog into local storage (works offline afterwards). */
/** Downloads the published catalog (falls back to the copy bundled with the app) and saves it for offline use. */
export async function fetchSamsungCatalog(): Promise<Catalog> {
  const bundled = `${import.meta.env.BASE_URL}samsung-catalog.json`;
  const url = location.hostname === 'appassets.androidplatform.net' ? 'https://cjbarnes29.github.io/imeiscanner/samsung-catalog.json' : bundled;
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
  catch (error) { if (url === bundled) throw error; response = await fetch(bundled); }
  if (!response.ok) throw new Error('No published catalog is available yet.');
  const value = await response.json();
  if (!Array.isArray(value.products)) throw new Error('Invalid catalog.');
  localStorage.setItem('samsung-catalog', JSON.stringify(value));
  return value as Catalog;
}
/** Automatic download when the app opens (unless switched off in Settings). */
export async function loadSamsungCatalog(): Promise<void> {
  if (autoDownloadOff()) return;
  await fetchSamsungCatalog();
}
