// RetailLens: the retail side of the app (Today, Catalog, Targets, Gives, Stock, Reports, Data). All the rules live in src/retail/*.ts (unit-tested);
// this file only shows them and passes the person's choices back. Nothing here changes a scan record except the owner of a phone (an approved Give).
import { useMemo, useRef, useState } from 'react';
import { fullCatalog, itemFor, saveItem, resetItem, segmentOf, setModelSegment, setRecordMeta } from './retail/catalog';
import { withAudit } from './retail/data';
import { inStock, variantOf, type StockSource } from './retail/inventory';
import { confirmSale, liveSales, pendingSubmissions, setSubmitted, voidSale } from './retail/sales';
import { matchPerson, parseTargetText, putTarget, summarizeTarget, THRESHOLDS, emptyTarget } from './retail/targets';
import { pendingBySegment, submittedSince, todayDashboard } from './retail/dashboard';
import { SEGMENTS, SEGMENT_LABEL, daysInMonth, localDay, monthOf, isMonth, type CatalogItem, type Segment, type TargetLine } from './retail/types';
import { GivesTab, StockTab, ReportsTab, DataTab } from './RetailHub2';
import { last4, num, sellDetails, updateDay, who, type RetailCtx, type RetailRecord } from './retail/ui-helpers';
export type { RetailCtx, RetailRecord };

const SUB = [['today', 'Today'], ['catalog', 'Catalog'], ['targets', 'Targets'], ['gives', 'Gives'], ['stock', 'Stock'], ['reports', 'Reports'], ['data', 'Data']] as const;
type Sub = typeof SUB[number][0];
export function RetailHub(ctx: RetailCtx) {
  const [sub, setSub] = useState<Sub>(ctx.sharedText ? 'reports' : 'today');
  const waiting = pendingSubmissions(ctx.state).length;
  return <div className="retail-hub">
    <nav className="retail-tabs" role="tablist" aria-label="RetailLens sections">
      {SUB.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={sub === key} className={sub === key ? 'on' : ''} onClick={() => setSub(key)}>{label}{key === 'today' && waiting > 0 && <b>{waiting}</b>}</button>)}
    </nav>
    {sub === 'today' && <TodayTab {...ctx} />}
    {sub === 'catalog' && <CatalogTab {...ctx} />}
    {sub === 'targets' && <TargetsTab {...ctx} />}
    {sub === 'gives' && <GivesTab {...ctx} />}
    {sub === 'stock' && <StockTab {...ctx} />}
    {sub === 'reports' && <ReportsTab {...ctx} />}
    {sub === 'data' && <DataTab {...ctx} />}
  </div>;
}

// ---- Today -------------------------------------------------------------------------------------------------------------------------------
function TodayTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const dash = useMemo(() => todayDashboard(state, records, today, ctx.counts), [state, records, today, ctx.counts]);
  const me = state.settings.myPersonId;
  const sellable = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inStock(state, records).filter(r => !q || r.imei.endsWith(q) || r.imei.includes(q) || (itemFor(state, r.model)?.name || r.model).toLowerCase().includes(q)).filter(r => !!r.personId && (q || r.personId === me)).slice(0, 8);
  }, [state, records, query, me]);
  const sell = (record: StockSource) => {
    const result = confirmSale(state, record, sellDetails(ctx, record), today);
    if (!result.ok) { ctx.notify(result.error === 'no-owner' ? 'Give this phone to a person before selling it.' : result.error === 'already-sold' ? 'This phone is already sold.' : 'Could not confirm this sale.'); return; }
    ctx.change(result.state, `sale ${result.sale.modelName}`); setUndo(result.sale.id); ctx.notify(`${result.sale.modelName} sold (${who(ctx, result.sale.personId)}).`);
  };
  const tick = (id: string, done: boolean) => ctx.change(updateDay(state, today, d => ({ ...d, checklist: { ...d.checklist, [id]: !done }, custom: d.custom.map(c => c.id === id ? { ...c, done: !done } : c) })), '');
  const pending = dash.pending.sales;
  const byDay = useMemo(() => {
    const days = new Map<string, RetailRecord[]>();
    for (const r of records) { const d = localDay(r.createdAt); if (d) days.set(d, [...(days.get(d) || []), r]); }
    return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  }, [records]);
  return <div className="retail-today">
    <div className="retail-stats">
      <div><span>Sold today</span><strong>{dash.soldToday}</strong></div>
      <div><span>Pending submission</span><strong className={dash.pending.count ? 'amber' : ''}>{dash.pending.count}</strong></div>
      <div><span>My target</span><strong>{dash.summary ? `${dash.summary.totalPct}%` : '—'}</strong></div>
      <div><span>Days left</span><strong>{dash.summary ? dash.summary.daysLeft : daysInMonth(monthOf(today)) - Number(today.slice(8)) + 1}</strong></div>
    </div>
    <section className="retail-card"><h3>Sell first</h3>
      {!me && <p className="settings-help">Choose who you are in Gives &gt; My target to see your selling priorities.</p>}
      {me && !dash.summary && <p className="settings-help">No target for this month yet. Import your Promoter screenshot in Targets.</p>}
      {dash.priorities.map(p => <p key={p.segment} className="retail-priority">{p.message}</p>)}
      {dash.summary && !dash.priorities.length && <p className="settings-help">Your {state.settings.myThreshold}% target is reached in every segment.</p>}
      {dash.summary && <p className="settings-help">Estimated incentive now: {state.rates.currency}{dash.summary.now} · at 100%: {state.rates.currency}{dash.summary.ifReached[100]} (example rates, edit them in Targets).</p>}
    </section>
    <section className="retail-card"><h3>Confirm a sale</h3>
      <input type="search" aria-label="Find a phone to sell" placeholder="IMEI (any part) or model" value={query} onChange={e => setQuery(e.target.value)} />
      <ul className="retail-list">{sellable.map(r => <li key={r.id}><span><strong>{itemFor(state, r.model)?.abbreviation || r.model}</strong> {last4(r.imei)} · {who(ctx, r.personId)}</span><button type="button" className="primary" onClick={() => sell(r)}>Sell</button></li>)}
        {!sellable.length && <li className="settings-help">{query ? 'No phone with an owner matches.' : 'Type part of an IMEI or a model. Only phones that belong to a person can be sold.'}</li>}</ul>
      {undo && liveSales(state).some(s => s.id === undo) && <p className="retail-undo">Sale confirmed. <button type="button" className="subtle-btn" onClick={() => { const r = voidSale(state, undo, 'undone right away'); if (r.ok) { ctx.change(r.state, 'undo sale'); setUndo(''); ctx.notify('Sale undone; the phone is back in stock.'); } }}>Undo</button></p>}
    </section>
    <section className="retail-card"><h3>Pending submissions ({pending.length})</h3>
      {pending.length > 0 && <p className="settings-help">Oldest is {dash.pending.oldestDays} day{dash.pending.oldestDays === 1 ? '' : 's'} old. Tick the ones you submitted to Samsung.</p>}
      <ul className="retail-list">{pending.slice(0, 12).map(s => <li key={s.id}><label><input type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked(old => old.includes(s.id) ? old.filter(x => x !== s.id) : [...old, s.id])} /> {s.modelName} {last4(s.imei)} · {who(ctx, s.personId)} · {s.date}</label></li>)}</ul>
      {pending.length > 0 && <div className="share-toolbar"><button type="button" className="primary" disabled={!picked.length} onClick={() => { ctx.change(setSubmitted(state, picked, true), 'mark submitted'); setPicked([]); }}>Mark {picked.length || ''} submitted</button><button type="button" className="subtle-btn" onClick={() => setPicked(pending.map(s => s.id))}>Tick all</button></div>}
    </section>
    <section className="retail-card"><h3>Stock alerts ({dash.alerts.length})</h3>
      <ul className="retail-list">{dash.alerts.map((a, i) => <li key={i}><span className={a.kind === 'out' ? 'bad' : 'amber'}>{a.name} {a.storage} {a.color}</span> <small>{a.why}</small></li>)}{!dash.alerts.length && <li className="settings-help">No alerts.</li>}</ul>
    </section>
    <section className="retail-card"><h3>Today’s checklist</h3>
      <ul className="retail-list">{dash.checklist.map(item => <li key={item.id}><label><input type="checkbox" checked={item.done} disabled={item.auto} onChange={() => tick(item.id, item.done)} /> <span className={item.done ? 'done' : ''}>{item.text}</span></label></li>)}</ul>
      <form className="retail-inline" onSubmit={e => { e.preventDefault(); if (!custom.trim()) return; ctx.change(updateDay(state, today, d => ({ ...d, custom: [...d.custom, { id: `c${Date.now().toString(36)}`, text: custom.trim(), done: false }] })), ''); setCustom(''); }}>
        <input aria-label="Add a checklist item" placeholder="Add your own item" value={custom} onChange={e => setCustom(e.target.value)} /><button type="submit" className="subtle-btn">Add</button></form>
    </section>
    <section className="retail-card"><h3>Uploads by day</h3>
      <ul className="retail-list">{byDay.map(([day, rows]) => <li key={day}><button type="button" className="link-btn" aria-label={`Show the phones of ${day}`} onClick={() => ctx.openRecords(`day:${day}`)}>{day}</button><span>{rows.length} phone{rows.length === 1 ? '' : 's'} · {rows.filter(r => /^\d{15}$/.test(r.imei)).length} read{rows.some(r => r.needsReview) ? ` · ${rows.filter(r => r.needsReview).length} to review` : ''}</span></li>)}{!byDay.length && <li className="settings-help">Photos you share from WhatsApp are scanned automatically and listed here by day.</li>}</ul>
    </section>
  </div>;
}

// ---- Catalog and segments ---------------------------------------------------------------------------------------------------------------
function variantsText(item: CatalogItem) { return item.variants.map(v => [v.sku, v.ram, v.storage, v.colors.join(', ')].join(' | ')).join('\n'); }
function parseVariants(text: string) { return text.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p.some(Boolean)).map(p => ({ sku: p[0] || '', ram: p[1] || '', storage: p[2] || '', colors: (p[3] || '').split(',').map(c => c.trim()).filter(Boolean) })); }

function CatalogTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const month = monthOf(today);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [variants, setVariants] = useState('');
  const [seg, setSeg] = useState<Segment | 'all'>('all');
  const [ids, setIds] = useState<string[]>([]);
  const [bulkSeg, setBulkSeg] = useState<Segment>('mid');
  const [bulkStorage, setBulkStorage] = useState('');
  const [bulkColor, setBulkColor] = useState('');
  const segOf = (r: RetailRecord) => segmentOf(state, r.model, month, state.recordMeta[r.id]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of records) c[segOf(r)] = (c[segOf(r)] || 0) + 1; return c; }, [records, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = records.filter(r => seg === 'all' || segOf(r) === seg).slice(0, 60);
  const models = fullCatalog(state).filter(i => !search || `${i.name} ${i.abbreviation} ${i.code}`.toLowerCase().includes(search.toLowerCase())).slice(0, 40);
  const toggle = (id: string) => setIds(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const applyBulk = (rememberModel: boolean) => {
    let next = setRecordMeta(state, ids, { ...(bulkSeg ? { segment: bulkSeg } : {}), ...(bulkStorage ? { storage: bulkStorage } : {}), ...(bulkColor ? { color: bulkColor } : {}) });
    if (rememberModel) for (const model of new Set(records.filter(r => ids.includes(r.id)).map(r => r.model))) next = setModelSegment(next, model, bulkSeg);
    ctx.change(withAudit(next, 'bulk edit', `${ids.length} phones: ${SEGMENT_LABEL[bulkSeg]}${bulkStorage ? `, ${bulkStorage}` : ''}${bulkColor ? `, ${bulkColor}` : ''}`), 'bulk edit'); setIds([]);
    ctx.notify(`${ids.length} phone${ids.length === 1 ? '' : 's'} updated${rememberModel ? '; the segment is remembered for those models' : ''}.`);
  };
  return <div className="retail-catalog">
    <section className="retail-card"><h3>Phones by segment</h3>
      <div className="filter-chips" role="group" aria-label="Segment filter">
        <button type="button" className={seg === 'all' ? 'active' : ''} onClick={() => setSeg('all')}>All <b>{records.length}</b></button>
        {[...SEGMENTS, 'other' as Segment].map(s => (counts[s] || seg === s) ? <button key={s} type="button" className={seg === s ? 'active' : ''} onClick={() => setSeg(s)}>{SEGMENT_LABEL[s]} <b>{counts[s] || 0}</b></button> : null)}
      </div>
      <ul className="retail-list">{shown.map(r => <li key={r.id}><label><input type="checkbox" checked={ids.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /> {itemFor(state, r.model)?.abbreviation || r.model || 'Unknown'} {last4(r.imei)} <small>{SEGMENT_LABEL[segOf(r)]} · {variantOf(state, r).storage || 'storage ?'} · {variantOf(state, r).color || 'colour ?'}</small></label></li>)}{!shown.length && <li className="settings-help">No phones here.</li>}</ul>
      {ids.length > 0 && <div className="retail-bulk" role="group" aria-label="Bulk edit selected phones">
        <strong>{ids.length} selected</strong>
        <select aria-label="Segment" value={bulkSeg} onChange={e => setBulkSeg(e.target.value as Segment)}>{[...SEGMENTS, 'other' as Segment].map(s => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select>
        <input aria-label="Storage" placeholder="Storage (256GB)" value={bulkStorage} onChange={e => setBulkStorage(e.target.value)} />
        <input aria-label="Colour" placeholder="Colour" value={bulkColor} onChange={e => setBulkColor(e.target.value)} />
        <button type="button" className="primary" onClick={() => applyBulk(false)}>Apply to these phones</button>
        <button type="button" className="subtle-btn" onClick={() => applyBulk(true)}>Apply and remember the segment for these models</button>
      </div>}
    </section>
    <section className="retail-card"><h3>Models</h3>
      <div className="retail-inline"><input type="search" aria-label="Search models" placeholder="Search models" value={search} onChange={e => setSearch(e.target.value)} /><button type="button" className="subtle-btn" onClick={() => { setEditing({ code: '', name: '', abbreviation: '', segment: 'mid', monthly: {}, variants: [], custom: true }); setVariants(''); }}>+ Add model</button></div>
      <ul className="retail-list">{models.map(i => <li key={i.code}><span><strong>{i.abbreviation}</strong> <small>{i.name} · {i.code}{i.custom ? ' · edited' : ''}</small></span>
        <span className="retail-inline"><select aria-label={`Segment of ${i.name}`} value={i.monthly[month] || i.segment} onChange={e => ctx.change(setModelSegment(state, i.code, e.target.value as Segment), 'segment')}>{[...SEGMENTS, 'other' as Segment].map(s => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select>
          <button type="button" className="subtle-btn" onClick={() => { setEditing(i); setVariants(variantsText(i)); }}>Edit</button></span></li>)}</ul>
    </section>
    {editing && <section className="retail-card" role="dialog" aria-label="Edit model"><h3>{editing.code ? `Edit ${editing.name}` : 'Add a model'}</h3>
      <label>Model code (e.g. A176)<input value={editing.code} disabled={!!itemFor(state, editing.code) && !!editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} /></label>
      <label>Name<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>Report abbreviation<input value={editing.abbreviation} onChange={e => setEditing({ ...editing, abbreviation: e.target.value })} /></label>
      <label>Segment<select value={editing.segment} onChange={e => setEditing({ ...editing, segment: e.target.value as Segment })}>{[...SEGMENTS, 'other' as Segment].map(s => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select></label>
      <label>Segment for {month} only<select value={editing.monthly[month] || ''} onChange={e => { const monthly = { ...editing.monthly }; if (e.target.value) monthly[month] = e.target.value as Segment; else delete monthly[month]; setEditing({ ...editing, monthly }); }}><option value="">Same as above</option>{[...SEGMENTS].map(s => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select></label>
      <label>Variants, one per line: SKU | RAM | storage | colours<textarea rows={4} value={variants} onChange={e => setVariants(e.target.value)} placeholder="SM-A176BZKGINU | 6GB | 128GB | Black, Blue" /></label>
      <div className="share-toolbar"><button type="button" className="primary" disabled={!/^[A-Z0-9]{3,6}$/.test(editing.code)} onClick={() => { ctx.change(saveItem(state, { ...editing, variants: parseVariants(variants) }), 'catalog edit'); setEditing(null); }}>Save</button>
        {itemFor(state, editing.code) && state.catalog.some(c => c.code === editing.code) && <button type="button" className="subtle-btn danger" onClick={() => { ctx.change(resetItem(state, editing.code), 'catalog reset'); setEditing(null); }}>Reset to built-in</button>}
        <button type="button" className="subtle-btn" onClick={() => setEditing(null)}>Cancel</button></div></section>}
  </div>;
}

// ---- Targets -----------------------------------------------------------------------------------------------------------------------------
function TargetsTab(ctx: RetailCtx) {
  const { state, today } = ctx;
  const [month, setMonth] = useState(monthOf(today));
  const [personId, setPersonId] = useState(state.settings.myPersonId || ctx.people[0]?.id || '');
  const [draft, setDraft] = useState<{ month: string; personId: string; lines: TargetLine[]; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const target = state.targets[month]?.[personId];
  const summary = target ? summarizeTarget(target, pendingBySegment(state, personId), today, state.rates, submittedSince(state, personId, target)) : null;
  const file = useRef<HTMLInputElement>(null);
  const importScreenshot = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    try {
      const parsed = parseTargetText(await ctx.readImage(picked));
      const matched = matchPerson(parsed.personName, ctx.people);
      setDraft({ month: parsed.month || month, personId: matched || personId, lines: SEGMENTS.map(s => parsed.lines.find(l => l.segment === s) || { segment: s, target: 0, achieved: 0 }), warnings: parsed.warnings });
    } catch { ctx.notify('The screenshot could not be read. Enter the numbers by hand below.'); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const saveDraft = () => {
    if (!draft || !draft.personId || !isMonth(draft.month)) { ctx.notify('Choose the person and a valid month first.'); return; }
    ctx.change(putTarget(state, { personId: draft.personId, month: draft.month, lines: draft.lines.filter(l => l.target > 0 || l.achieved > 0), source: 'screenshot', importedAt: new Date().toISOString() }), 'targets import');
    setMonth(draft.month); setPersonId(draft.personId); setDraft(null); ctx.notify('Targets saved.');
  };
  const editLine = (segment: Segment, field: 'target' | 'achieved', value: string) => {
    const base = target || emptyTarget(personId, month);
    const lines = SEGMENTS.map(s => base.lines.find(l => l.segment === s) || { segment: s, target: 0, achieved: 0 }).map(l => l.segment === segment ? { ...l, [field]: num(value) } : l);
    ctx.change(putTarget(state, { ...base, lines, source: 'manual', importedAt: new Date().toISOString() }), '');
  };
  return <div className="retail-targets">
    <section className="retail-card"><h3>Promoter targets</h3>
      <div className="retail-inline">
        <label>Month<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <label>Person<select value={personId} onChange={e => setPersonId(e.target.value)}>{ctx.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <div className="share-toolbar"><input ref={file} type="file" accept="image/*" hidden onChange={e => void importScreenshot(e.target.files?.[0])} />
        <button type="button" className="primary" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Reading the screenshot…' : 'Import Promoter screenshot'}</button></div>
      <p className="settings-help">The screenshot is read on this phone (no internet). Check the numbers before saving.</p>
    </section>
    {draft && <section className="retail-card" role="dialog" aria-label="Check the imported targets"><h3>Check the imported targets</h3>
      <div className="retail-inline"><label>Month<input type="month" value={draft.month} onChange={e => setDraft({ ...draft, month: e.target.value })} /></label>
        <label>Person<select value={draft.personId} onChange={e => setDraft({ ...draft, personId: e.target.value })}>{ctx.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      {draft.warnings.map((w, i) => <p key={i} className="amber">{w}</p>)}
      <table className="retail-table"><thead><tr><th>Segment</th><th>Target</th><th>Achieved</th></tr></thead><tbody>{draft.lines.map(l => <tr key={l.segment}><td>{SEGMENT_LABEL[l.segment]}</td>
        <td><input aria-label={`${SEGMENT_LABEL[l.segment]} target`} inputMode="numeric" value={l.target} onChange={e => setDraft({ ...draft, lines: draft.lines.map(x => x.segment === l.segment ? { ...x, target: num(e.target.value) } : x) })} /></td>
        <td><input aria-label={`${SEGMENT_LABEL[l.segment]} achieved`} inputMode="numeric" value={l.achieved} onChange={e => setDraft({ ...draft, lines: draft.lines.map(x => x.segment === l.segment ? { ...x, achieved: num(e.target.value) } : x) })} /></td></tr>)}</tbody></table>
      <div className="share-toolbar"><button type="button" className="primary" onClick={saveDraft}>Save targets</button><button type="button" className="subtle-btn" onClick={() => setDraft(null)}>Discard</button></div></section>}
    <section className="retail-card"><h3>{who(ctx, personId)} · {month}</h3>
      <table className="retail-table"><thead><tr><th>Segment</th><th>Target</th><th>Achieved</th><th>Pending</th><th>%</th>{THRESHOLDS.map(t => <th key={t}>{t}%: left (per day)</th>)}</tr></thead><tbody>
        {SEGMENTS.map(s => { const l = summary?.lines.find(x => x.segment === s); const line = target?.lines.find(x => x.segment === s); return <tr key={s}><td>{SEGMENT_LABEL[s]}</td>
          <td><input aria-label={`${SEGMENT_LABEL[s]} target for ${who(ctx, personId)}`} inputMode="numeric" value={line?.target ?? 0} onChange={e => editLine(s, 'target', e.target.value)} /></td>
          <td><input aria-label={`${SEGMENT_LABEL[s]} achieved for ${who(ctx, personId)}`} inputMode="numeric" value={line?.achieved ?? 0} onChange={e => editLine(s, 'achieved', e.target.value)} /></td>
          <td>{l?.pending || 0}</td><td>{l ? `${l.pct}%` : '—'}</td>{THRESHOLDS.map(t => <td key={t}>{l ? `${l.at[t].remaining} (${l.at[t].perDay}/day)` : '—'}</td>)}</tr>; })}</tbody></table>
      {summary && <div className="retail-incentive"><p><strong>Overall {summary.totalPct}%</strong> · {summary.daysLeft} day{summary.daysLeft === 1 ? '' : 's'} left · tier now: {summary.tier ? `${summary.tier}%` : 'below 70%'}</p>
        <p>Estimated incentive if every segment reaches: 70% {state.rates.currency}{summary.ifReached[70]} · 100% {state.rates.currency}{summary.ifReached[100]} · 120% {state.rates.currency}{summary.ifReached[120]}. On what is achieved now: {state.rates.currency}{summary.now}.</p></div>}
      <details><summary>Incentive rates (example values: edit to match your scheme)</summary>
        <div className="retail-rates">{SEGMENTS.map(s => <label key={s}>{SEGMENT_LABEL[s]} per unit<input inputMode="numeric" value={state.rates.perUnit[s]} onChange={e => ctx.change({ ...state, rates: { ...state.rates, perUnit: { ...state.rates.perUnit, [s]: num(e.target.value) } } }, '')} /></label>)}
          {THRESHOLDS.map(t => <label key={t}>Multiplier at {t}%<input inputMode="decimal" value={state.rates.multiplier[t]} onChange={e => ctx.change({ ...state, rates: { ...state.rates, multiplier: { ...state.rates.multiplier, [t]: Math.max(0, Number(e.target.value) || 0) } } }, '')} /></label>)}</div></details>
    </section>
  </div>;
}

