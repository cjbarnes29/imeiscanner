import { useEffect, useState } from 'react';
type Product = { id:string; name:string; modelCode:string; region:string; sourceUrl:string; lastChecked:string; imageUrl?:string; specifications?:{name:string;value:string}[]; releaseDate?:string; compatibility?:string };
type Catalog = { updatedAt:string; products:Product[]; coverage:{ complete:boolean; pagesChecked:number } };
export function SamsungCatalog() {
  const [catalog,setCatalog] = useState<Catalog | null>(() => { try { return JSON.parse(localStorage.getItem('samsung-catalog') || 'null'); } catch { return null; } });
  const [query,setQuery] = useState(''), [status,setStatus] = useState('');
  const [corrections, setCorrections] = useState<Record<string,string>>(() => { try { return JSON.parse(localStorage.getItem('samsung-catalog-corrections') || '{}'); } catch { return {}; } });
  const [busy, setBusy] = useState(false);
  async function update() {
    if (busy) return;
    setBusy(true); setStatus('Checking published catalog…');
    try {
      const bundled = `${import.meta.env.BASE_URL}samsung-catalog.json`;
      const url = location.hostname === 'appassets.androidplatform.net' ? 'https://cjbarnes29.github.io/imeiscanner/samsung-catalog.json' : bundled;
      let response;
      try { response = await fetch(url, { cache:'no-store', signal:AbortSignal.timeout(20000) }); }
      catch (error) { if (catalog || url === bundled) throw error; response = await fetch(bundled); }
      if (!response.ok) throw new Error('No published catalog is available yet.');
      const value = await response.json(); if (!Array.isArray(value.products)) throw new Error('Invalid catalog.'); localStorage.setItem('samsung-catalog', JSON.stringify(value)); setCatalog(value); setStatus('Catalog saved for offline use. Check the last-update date below.');
    }
    catch (error) { setStatus(`${error instanceof Error ? error.message : 'Update failed.'} Your saved catalog remains available. Retry when connected.`); }
    finally { setBusy(false); }
  }
  const matches = (catalog?.products || []).filter(p => `${corrections[p.id] || p.name} ${p.modelCode} ${p.region}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { void update(); }, []);
  return <details className="panel catalog-panel"><summary>Samsung product catalog</summary><p>Verified Samsung product pages only. Coverage is incomplete; missing specifications and compatibility are left unknown. Daily checks run on GitHub even with the app closed. Manual checks require your GitHub account.</p><button className="subtle-btn" disabled={busy} onClick={update}>{busy ? 'Updating…' : 'Update saved catalog'}</button> <a href="https://github.com/cjbarnes29/imeiscanner/actions/workflows/catalog.yml" target="_blank" rel="noreferrer">Run Samsung update now / view job status</a><p role="status">{status}</p><p>{catalog ? `${catalog.products.length} verified variants · Last update ${catalog.updatedAt}` : 'No catalog saved yet.'}</p><input aria-label="Search Samsung catalog" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Product name or model code" />{matches.slice(0,30).map(p=><details key={p.id}><summary>{corrections[p.id] || p.name} · {p.modelCode} · {p.region}</summary>
    {p.imageUrl && <img loading="lazy" src={p.imageUrl} alt={p.name} style={{width:160,height:120,objectFit:'contain'}} />}
    <p><a href={p.sourceUrl} target="_blank" rel="noreferrer">Official Samsung source</a> · Checked {p.lastChecked}</p>
    <p>Release date: {p.releaseDate || 'Not available'} · Compatibility: {p.compatibility || 'Not available'}</p>
    {(p.specifications || []).map((s,i)=><p key={i}>{s.name}: {s.value}</p>)}
    <label>Local display name correction <input aria-label={`Display name for ${p.modelCode}`} value={corrections[p.id] ?? p.name} onChange={e=>{ const value={...corrections,[p.id]:e.target.value}; try { localStorage.setItem('samsung-catalog-corrections',JSON.stringify(value));setCorrections(value); } catch { setStatus('Correction could not be saved. Device storage is full.'); } }} /></label>
    <p>Saved on this device separately from official data; catalog updates keep this correction.</p>
  </details>)}{matches.length>30&&<p>Showing 30 results. Refine the search.</p>}</details>;
}
export function catalogModel(text:string):string | undefined {
  try { const catalog = JSON.parse(localStorage.getItem('samsung-catalog') || 'null') as Catalog | null; const corrections = JSON.parse(localStorage.getItem('samsung-catalog-corrections') || '{}'); const codes = new Set(text.toUpperCase().match(/\b(?:SM|GT|SCH|SGH|EP|EF|ET|EO)-[A-Z0-9]+\b/g) || []); const matches = (catalog?.products || []).filter(p=>codes.has(p.modelCode) || [...codes].some(code => /^(?:SM-[A-Z][0-9]{3}[A-Z0-9]?|(?:EP|EF|ET|EO)-[A-Z0-9]{4,})$/.test(code) && p.modelCode.startsWith(code))); const names = [...new Set(matches.map(p=>corrections[p.id] || p.name))]; return names.length===1 ? names[0] : undefined; } catch { return undefined; }
}

/** Saved catalog entries (name + model code) for phone names; empty until the catalog is loaded. */
export function readCatalogEntries(): { name: string; modelCode: string }[] {
  try {
    const catalog = JSON.parse(localStorage.getItem('samsung-catalog') || 'null') as Catalog | null;
    const corrections = JSON.parse(localStorage.getItem('samsung-catalog-corrections') || '{}') as Record<string, string>;
    return (catalog?.products || []).map(product => ({ name: corrections[product.id] || product.name, modelCode: product.modelCode }));
  } catch { return []; }
}

/** Fetch the bundled/published catalog into local storage (works offline afterwards). */
export async function loadSamsungCatalog(): Promise<void> {
  const bundled = `${import.meta.env.BASE_URL}samsung-catalog.json`;
  const url = location.hostname === 'appassets.androidplatform.net' ? 'https://cjbarnes29.github.io/imeiscanner/samsung-catalog.json' : bundled;
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
  catch (error) { if (url === bundled) throw error; response = await fetch(bundled); }
  if (!response.ok) throw new Error('No catalog available.');
  const value = await response.json();
  if (!Array.isArray(value.products)) throw new Error('Invalid catalog.');
  localStorage.setItem('samsung-catalog', JSON.stringify(value));
}
