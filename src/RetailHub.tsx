import {AssistantRequests} from './AssistantReview';
import {HomeLayoutStyle} from './HomeSettings';
import { AutoSuggestions } from './AutoWorkflow';
// AI LENS: the retail side of the app (Today, Report, Targets, Gives, Segments, Catalog, Data). All the rules live in src/retail/*.ts (unit-tested);
// this file only shows them and passes the person's choices back. Nothing here changes a scan record except the owner of a phone (an approved Give).
import { useEffect, useMemo, useState } from 'react';
import { defaultAbbreviation, fullCatalog, guessSegment, itemFor, saveItem, resetItem, segmentOf, setModelSegment, setRecordMeta } from './retail/catalog';
import { withAudit } from './retail/data';
import { variantOf } from './retail/inventory';
import { reconcile } from './retail/reconcile';
import { canonColour, coloursText as colourBox, parseColoursText, setModelColours } from './retail/colours';
import { segLabel, segmentIds } from './retail/segments';
import { reportItems } from './retail/stockreport';
import { overallDashboard, todayDashboard } from './retail/dashboard';
import { perDayText, MIN_PACE_DAYS } from './retail/pace';
import { outlookFor, type Advice } from './retail/forecast';
import { daysInMonth, localDay, monthOf, type CatalogItem, type Segment } from './retail/types';
import { GivesTab, DataTab } from './RetailHub2';
import { PlanSummary, PlanTab } from './RetailPlan';
import { HelpButton } from './Guide';
import { DeliveryPackets } from './RetailDelivery';
import { HomeAttention, QuickUploadCheck, ScheduleReminder } from './RetailCalendarActivity';
import { ReportTab } from './RetailReport';
import { TargetsTab, SegmentsTab } from './RetailTargets';
import { last4, timeOf, updateDay, type RetailCtx, type RetailRecord } from './retail/ui-helpers';
export type { RetailCtx, RetailRecord };

/** The AI LENS sections. Home (today), Report and Targets are on the bottom bar; Gives, Segments, Catalog and Data are under the ⋯ More menu. */
export type RetailSub = 'today' | 'report' | 'targets' | 'gives' | 'plan' | 'segments' | 'catalog' | 'data';
/** Which section is open is decided by the app (bottom bar / More menu); this shows it. */
export function RetailHub(ctx: RetailCtx & { sub?: RetailSub; openSub?: (sub: RetailSub) => void }) {
  const sub: RetailSub = ctx.sub || (ctx.sharedText ? 'report' : 'today');
  const setSub = ctx.openSub || (() => undefined);
  return <div className="retail-hub">
    {sub === 'today' && <TodayTab {...ctx} openReport={() => setSub('report')} />}
    {sub === 'report' && <ReportTab {...ctx} />}
    {sub === 'targets' && <TargetsTab {...ctx} />}
    {sub === 'gives' && <GivesTab {...ctx} />}
    {sub === 'plan' && <PlanTab {...ctx} />}
    {(sub === 'segments' || sub === 'catalog') && <ModelManager {...ctx} />}
    {sub === 'data' && <DataTab {...ctx} />}
  </div>;
}

const FC_TITLE: Record<Advice, string> = { push: 'Push these', keep: 'Keep the pace', far: 'Hard to reach: focus elsewhere', stop: 'Done: stop pushing' };

// ---- Today -------------------------------------------------------------------------------------------------------------------------------
function TodayTab(ctx: RetailCtx & { openReport: () => void }) {
  const { state, records, today } = ctx;
  const [custom, setCustom] = useState('');
  const people = ctx.people;
  const [pick, setPick] = useState('all');
  // Home looks at everyone together by default; a person chip narrows it to that person
  const me = state.settings.myPersonId;
  const who = people.some(p => p.id === pick) ? pick : people.some(p => p.id === me) ? me : people[0]?.id || '';
  const everyone = pick === 'all' || !who;
  const whoName = people.find(p => p.id === who)?.name || '';
  const overall = useMemo(() => overallDashboard(state, people.map(p => p.id), today), [state, people, today]);
  const forWho = useMemo(() => ({ ...state, settings: { ...state.settings, myPersonId: who } }), [state, who]);
  const dash = useMemo(() => todayDashboard(forWho, records, today, ctx.counts), [forWho, records, today, ctx.counts]);
  const outlook = useMemo(() => outlookFor(state, everyone ? people.map(p => p.id) : [who], today), [state, people, today, everyone, who]);
  const check = useMemo(() => (state.report ? reconcile(state, state.report, records).summary : null), [state, records]);
  const low = useMemo(() => (state.report ? reportItems(state.report).filter(i => i.stock > 0 && i.stock <= state.settings.lowStock) : []), [state]);
  const tick = (id: string, done: boolean) => ctx.change(updateDay(state, today, d => ({ ...d, checklist: { ...d.checklist, [id]: !done }, custom: d.custom.map(c => c.id === id ? { ...c, done: !done } : c) })), '');
  const byDay = useMemo(() => {
    const days = new Map<string, RetailRecord[]>();
    for (const r of records) { const d = localDay(r.createdAt); if (d) days.set(d, [...(days.get(d) || []), r]); }
    return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  }, [records]);
  const unassigned = records.filter(r => !r.personId).length;
  return <div className="retail-today"><HomeLayoutStyle/>
    {!records.length && !Object.keys(state.targets[monthOf(today)] || {}).length && <section className="retail-card first-use-checklist"><div className="plan-top"><h3>Start here</h3><HelpButton topic="Uploading and adding phones" /></div><p className="settings-help">Set up your team, then scan. You can edit these choices later.</p><ol><li><button className="plan-link" onClick={ctx.openPeople}>Add or name your people →</button></li><li><button className="plan-link" onClick={ctx.openModels}>Check models and segments →</button></li><li><button className="plan-link" onClick={ctx.openTargets}>Set monthly targets and caps →</button></li><li><button className="plan-link" onClick={ctx.openScan}>Upload or scan labels →</button></li><li><button className="plan-link" onClick={ctx.openPlan}>Choose Store or calculate a release plan →</button></li></ol><p className="settings-help">Tap ? Help on any screen for an interactive demo. Practice uses sample data and never changes your records.</p></section>}
    <HomeAttention {...ctx}/>
    <AssistantRequests {...ctx}/>
    <ScheduleReminder {...ctx} />
    <PlanSummary {...ctx} />
    <AutoSuggestions {...ctx}/>
    <section className="retail-card home-automation"><div className="plan-top"><h3>Automation & assistant</h3><button className="subtle-btn" onClick={ctx.openSettings}>Global automation settings</button></div><p className="settings-help">Picture checks, storing, giving, report suggestions and the target-link policy are shared settings. Your approval is still needed for a sale.</p><button className="primary" onClick={ctx.openAssistant}>Ask AI LENS →</button></section>
    {(state.deliveryPackets?.length || 0) > 0 && <DeliveryPackets {...ctx}/>}
    <QuickUploadCheck {...ctx} />
    <section className="retail-card accessory-home-summary"><div className="plan-top"><h3>Tablets & accessories</h3><strong>{Object.values(state.accessoryStock||{}).reduce((n,r)=>n+r.quantity,0)} stock</strong></div><p className="settings-help">{state.accessoryReport?`${reportItems(state.accessoryReport).reduce((n,r)=>n+r.sold,0)} sales listed · Report date ${state.accessoryReport.dateText||'not set'}`:'Import Daily OSR to add stock, then review the final report.'}</p><button className="subtle-btn" onClick={ctx.openAccessoryReport}>Open tablets & accessories →</button></section>
    {people.length > 0 && <div className="who-chips" role="group" aria-label="Whose month"><button type="button" aria-pressed={everyone} className={everyone ? 'on' : ''} onClick={() => setPick('all')}><i className="who-av c4">★</i>Everyone</button>{people.map((p, k) => <button key={p.id} type="button" aria-pressed={!everyone && who === p.id} className={!everyone && who === p.id ? 'on' : ''} onClick={() => setPick(p.id)}><i className={`who-av c${k % 4}`}>{p.name.slice(0, 1).toUpperCase()}</i>{p.name}</button>)}</div>}
    <div className="retail-stats">
      <div><span>Report lines to check</span><strong className={check && check.differ + check.unknown ? 'amber' : ''}>{check ? check.differ + check.unknown : '—'}</strong></div>
      <div><span>Phones scanned</span><strong>{check ? check.scannedPhones : records.length}</strong></div>
      <div><span>{everyone ? 'Everyone’s target' : `${whoName}’s target`}</span><strong>{everyone ? (overall ? `${overall.totalPct}%` : '—') : dash.summary ? `${dash.summary.totalPct}%` : '—'}</strong></div>
      <div><span>Days left</span><strong>{(everyone ? overall?.daysLeft : dash.summary?.daysLeft) ?? daysInMonth(monthOf(today)) - Number(today.slice(8)) + 1}</strong></div>
    </div>
    {everyone ? <>
      <section className="retail-card home-priorities"><h3>Sell first: everyone</h3>
        {!people.length && <p className="settings-help">Add people in More, then People, to see what everyone has to sell.</p>}
        {people.length > 0 && !overall && <p className="settings-help">No targets for this month yet. Set them in Targets.</p>}
        {overall && overall.lines.map(l => <p key={l.segment} className="retail-priority">Sell {perDayText(l.remaining, overall.daysLeft)} of {l.label}: {l.remaining} more for {overall.threshold}% <small>(sold {l.achieved} of {l.target})</small></p>)}
        {overall && !overall.lines.length && <p className="settings-help">Everyone’s {overall.threshold}% target is reached in every segment.</p>}
      </section>
      {overall && overall.needHelp.length > 0 && <section className="retail-card home-needs-help"><h3>Who needs help</h3>
        <ul className="retail-list">{overall.needHelp.map(h => <li key={h.personId}><button type="button" className="link-btn" onClick={() => setPick(h.personId)}>{people.find(p => p.id === h.personId)?.name || 'Someone'}</button><span className="amber">{h.pct}% of target</span></li>)}</ul>
      </section>}
    </> : <section className="retail-card home-priorities"><h3>Sell first for {whoName}</h3>
      {!who && <p className="settings-help">Add people in More, then People, to see their selling priorities.</p>}
      {who && !dash.summary && <p className="settings-help">No target for {whoName} this month yet. Set it in Targets.</p>}
      {dash.priorities.map(p => <p key={p.segment} className="retail-priority">{p.message}</p>)}
      {dash.summary && !dash.priorities.length && <p className="settings-help">{whoName}’s {state.settings.myThreshold}% target is reached in every segment.</p>}
    </section>}
    {outlook && <section className="retail-card fc-card screen-extra" aria-label="Month outlook"><h3>Month outlook: {everyone ? 'everyone' : whoName}</h3>
      <p className="settings-help">{outlook.early ? `Too early to project (the first ${MIN_PACE_DAYS - 1} days of the month): each line only says what its next level needs.` : `If sales keep the pace of the month so far, ${everyone ? 'everyone ends' : `${whoName} ends`} at about ${outlook.projectedPct}% (${outlook.projected} of ${outlook.target}). A guess from the pace so far, not a promise.`}</p>
      {(['push', 'keep', 'far', 'stop'] as Advice[]).map(group => { const rows = outlook.lines.filter(l => l.advice === group); return rows.length > 0 && <div key={group} className={`fc-group fc-${group}`}><h4>{FC_TITLE[group]}</h4>
        <ul className="retail-list">{rows.map(l => <li key={l.segment} className="fc-line"><strong>{l.label} <small>{l.sold} of {l.target}</small></strong><small>{l.text}</small></li>)}</ul></div>; })}
    </section>}
    <section className="retail-card home-report"><h3>Report</h3>
      {!state.report && <p className="settings-help">No report yet. Paste your WhatsApp report in Report: it is checked against the phones you scanned.</p>}
      {state.report && check && <p className="settings-help">Last saved {timeOf(state.report.savedAt)} · {check.agree} agree · {check.differ} differ · {check.unknown} unknown.</p>}
      <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={ctx.openReport}>{state.report ? 'Open the report' : 'Paste a report'}</button></div>
    </section>
    {unassigned > 0 && <section className="retail-card home-unassigned"><h3>Unassigned phones</h3><p className="settings-help">{unassigned} phone{unassigned === 1 ? ' has' : 's have'} no person yet.</p><div className="share-toolbar"><button type="button" className="subtle-btn" onClick={() => ctx.openRecords('All')}>Open Phones</button></div></section>}
    <section className="retail-card home-lowstock"><h3>Low stock ({low.length})</h3>
      <ul className="retail-list">{low.map(i => <li key={i.id}><span className="amber">{i.name}</span> <small>{i.stock} left in the report</small></li>)}{!low.length && <li className="settings-help">{state.report ? 'Nothing is low.' : 'Appears once a report is saved.'}</li>}</ul>
    </section>
    <section className="retail-card screen-extra home-checklist"><h3>Today’s checklist</h3>
      <ul className="retail-list">{dash.checklist.map(item => <li key={item.id}><label><input type="checkbox" checked={item.done} disabled={item.auto} onChange={() => tick(item.id, item.done)} /> <span className={item.done ? 'done' : ''}>{item.text}</span></label></li>)}</ul>
      <form className="retail-inline" onSubmit={e => { e.preventDefault(); if (!custom.trim()) return; ctx.change(updateDay(state, today, d => ({ ...d, custom: [...d.custom, { id: `c${Date.now().toString(36)}`, text: custom.trim(), done: false }] })), ''); setCustom(''); }}>
        <input aria-label="Add a checklist item" placeholder="Add your own item" value={custom} onChange={e => setCustom(e.target.value)} /><button type="submit" className="subtle-btn">Add</button></form>
    </section>
    <section className="retail-card screen-extra home-recent"><h3>Uploads by day</h3>
      <ul className="retail-list">{byDay.map(([day, rows]) => <li key={day}><button type="button" className="link-btn" aria-label={`Show the phones of ${day}`} onClick={() => ctx.openRecords(`day:${day}`)}>{day}</button><span>{rows.length} phone{rows.length === 1 ? '' : 's'} · {rows.filter(r => /^\d{15}$/.test(r.imei)).length} read{rows.some(r => r.needsReview) ? ` · ${rows.filter(r => r.needsReview).length} to review` : ''}</span></li>)}{!byDay.length && <li className="settings-help">Photos you share from WhatsApp are scanned automatically and listed here by day.</li>}</ul>
    </section>
  </div>;
}

// ---- Catalog and segments ---------------------------------------------------------------------------------------------------------------
function variantsText(item: CatalogItem) { return item.variants.map(v => [v.sku, v.ram, v.storage, v.colors.join(', ')].join(' | ')).join('\n'); }
function parseVariants(text: string) { return text.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p.some(Boolean)).map(p => ({ sku: p[0] || '', ram: p[1] || '', storage: p[2] || '', colors: (p[3] || '').split(',').map(c => c.trim()).filter(Boolean) })); }

function ModelManager(ctx: RetailCtx) {
  const [view, setView] = useState<'segments' | 'models'>('segments');
  const [query, setQuery] = useState('');
  const [editCode, setEditCode] = useState('');
  const imported = useMemo<CatalogItem[]>(() => {
    const sources = new Map((ctx.modelSources || []).filter(m => /^[A-Z0-9]{3,6}$/.test(m.code) && m.name).map(m => [m.code, m]));
    const explicit = new Set(ctx.state.catalog.map(m => m.code));
    return [...sources.values()].filter(m => !explicit.has(m.code)).map(m => ({ code: m.code, name: m.name, abbreviation: defaultAbbreviation(m.name), segment: ctx.state.corrections[m.code] || guessSegment(m.name, m.code), monthly: {}, variants: [], custom: false } satisfies CatalogItem));
  }, [ctx.modelSources, ctx.state.catalog, ctx.state.corrections]);
  const libraryCtx: RetailCtx = { ...ctx, state: { ...ctx.state, catalog: [...imported, ...ctx.state.catalog] }, change: (next, why) => ctx.change({ ...next, catalog: next.catalog.filter(m => !imported.includes(m)) }, why) };
  return <div className="model-manager">
    <input type="search" className="model-library-search" aria-label="Search models and segments" placeholder="Search a model, code or segment" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="give-tabs two" role="group" aria-label="Model library view"><button type="button" className={view === 'segments' ? 'on' : ''} aria-pressed={view === 'segments'} onClick={() => setView('segments')}>By segment</button><button type="button" className={view === 'models' ? 'on' : ''} aria-pressed={view === 'models'} onClick={() => setView('models')}>All models</button></div>
    {ctx.openModelSources && <div className="share-toolbar screen-extra"><button type="button" className="subtle-btn" onClick={ctx.openModelSources}>Import and Samsung catalog tools</button></div>}
    {view === 'segments' ? <SegmentsTab {...libraryCtx} query={query} pickModel={code => { setEditCode(code); setView('models'); }} /> : <CatalogTab {...libraryCtx} query={query} editCode={editCode} />}
  </div>;
}

function CatalogTab(ctx: RetailCtx & { query?: string; editCode?: string }) {
  const { state, records, today } = ctx;
  const month = monthOf(today);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [variants, setVariants] = useState('');
  const [colourLines, setColourLines] = useState('');
  const [seg, setSeg] = useState<Segment | 'all'>('all');
  const [ids, setIds] = useState<string[]>([]);
  const [bulkSeg, setBulkSeg] = useState<Segment | ''>('');
  const [bulkStatus, setBulkStatus] = useState<'' | 'in' | 'sold' | 'given' | 'held'>('');
  const [bulkStorage, setBulkStorage] = useState('');
  const [bulkColor, setBulkColor] = useState('');
  useEffect(() => { if (!ctx.editCode) return; const item = itemFor(state, ctx.editCode); if (item) { setEditing(item); setVariants(variantsText(item)); setColourLines(colourBox(state, item.code)); } }, [ctx.editCode]);
  const segOf = (r: RetailRecord) => segmentOf(state, r.model, month, state.recordMeta[r.id]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of records) c[segOf(r)] = (c[segOf(r)] || 0) + 1; return c; }, [records, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = records.filter(r => seg === 'all' || segOf(r) === seg).slice(0, 60);
  const searchText = ctx.query ?? search;
  const models = fullCatalog(state).filter(i => !searchText || `${i.name} ${i.abbreviation} ${i.code} ${segLabel(state, segmentOf(state, i.code, month))}`.toLowerCase().includes(searchText.toLowerCase())).slice(0, 60);
  const toggle = (id: string) => setIds(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const applyBulk = (rememberModel: boolean) => {
    let next = setRecordMeta(state, ids, { ...(bulkSeg ? { segment: bulkSeg } : {}), ...(bulkStorage ? { storage: bulkStorage } : {}), ...(bulkColor ? { color: canonColour(bulkColor) } : {}), ...(bulkStatus ? { status: (bulkStatus === 'in' ? '' : bulkStatus) as never } : {}) });
    if (rememberModel && bulkSeg) for (const model of new Set(records.filter(r => ids.includes(r.id)).map(r => r.model))) next = setModelSegment(next, model, bulkSeg);
    ctx.change(withAudit(next, 'bulk edit', `${ids.length} phones: ${bulkSeg ? segLabel(state, bulkSeg) : 'segment kept'}${bulkStatus ? `, ${bulkStatus === 'in' ? 'in stock' : bulkStatus}` : ''}${bulkStorage ? `, ${bulkStorage}` : ''}${bulkColor ? `, ${bulkColor}` : ''}`), 'bulk edit'); setIds([]);
    ctx.notify(`${ids.length} phone${ids.length === 1 ? '' : 's'} updated${rememberModel ? '; the segment is remembered for those models' : ''}.`);
  };
  return <div className="retail-catalog">
    <section className="retail-card screen-extra"><h3>Phones by segment</h3>
      <div className="filter-chips" role="group" aria-label="Segment filter">
        <button type="button" className={seg === 'all' ? 'active' : ''} onClick={() => setSeg('all')}>All <b>{records.length}</b></button>
        {[...segmentIds(state), 'other'].map(s => (counts[s] || seg === s) ? <button key={s} type="button" className={seg === s ? 'active' : ''} onClick={() => setSeg(s)}>{segLabel(state, s)} <b>{counts[s] || 0}</b></button> : null)}
      </div>
      <ul className="retail-list">{shown.map(r => <li key={r.id}><label><input type="checkbox" checked={ids.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /> {itemFor(state, r.model)?.abbreviation || r.model || 'Unknown'} {last4(r.imei)} <small>{segLabel(state, segOf(r))} · {variantOf(state, r).storage || 'storage ?'} · {variantOf(state, r).color || 'colour ?'}{state.recordMeta[r.id]?.status ? ` · ${state.recordMeta[r.id]?.status}` : ''}</small></label></li>)}{!shown.length && <li className="settings-help">No phones here.</li>}</ul>
      {ids.length > 0 && <div className="retail-bulk" role="group" aria-label="Bulk edit selected phones">
        <strong>{ids.length} selected</strong>
        <select aria-label="Segment" value={bulkSeg} onChange={e => setBulkSeg(e.target.value)}><option value="">Keep segment</option>{[...segmentIds(state), 'other'].map(s => <option key={s} value={s}>{segLabel(state, s)}</option>)}</select>
        <select aria-label="Stock status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value as typeof bulkStatus)}><option value="">Keep status</option><option value="in">In stock</option><option value="sold">Sold</option><option value="given">Given</option><option value="held">Held (store only)</option></select>
        <input aria-label="Storage" placeholder="Storage (256GB)" value={bulkStorage} onChange={e => setBulkStorage(e.target.value)} />
        <input aria-label="Colour" placeholder="Colour" value={bulkColor} onChange={e => setBulkColor(e.target.value)} />
        <button type="button" className="primary" onClick={() => applyBulk(false)}>Apply to these phones</button>
        {bulkSeg && <button type="button" className="subtle-btn" onClick={() => applyBulk(true)}>Apply and remember the segment for these models</button>}
      </div>}
    </section>
    <section className="retail-card"><h3>Models</h3>
      <div className="retail-inline">{ctx.query === undefined && <input type="search" aria-label="Search models" placeholder="Search models" value={search} onChange={e => setSearch(e.target.value)} />}<button type="button" className="subtle-btn" onClick={() => { setEditing({ code: '', name: '', abbreviation: '', segment: 'mid', monthly: {}, variants: [], custom: true }); setVariants(''); setColourLines(''); }}>+ Add model</button></div>
      <ul className="retail-list">{models.map(i => <li key={i.code}><span><strong>{i.abbreviation}</strong> <small>{i.name} · {i.code}{i.custom ? ' · edited' : ''}</small></span>
        <span className="retail-inline"><select aria-label={`Segment of ${i.name}`} value={segmentOf(state, i.code, month)} onChange={e => ctx.change(setModelSegment(state, i.code, e.target.value as Segment), 'segment')}>{[...segmentIds(state), 'other'].map(s => <option key={s} value={s}>{segLabel(state, s)}</option>)}</select>
          <button type="button" className="subtle-btn" onClick={() => { setEditing(i); setVariants(variantsText(i)); setColourLines(colourBox(state, i.code)); }}>Edit</button></span></li>)}</ul>
    </section>
    {editing && <section className="retail-card" role="dialog" aria-label="Edit model"><h3>{editing.code ? `Edit ${editing.name}` : 'Add a model'}</h3>
      <label>Model code (e.g. A176)<input value={editing.code} disabled={!!itemFor(state, editing.code) && !!editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} /></label>
      <label>Name<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>Report abbreviation<input value={editing.abbreviation} onChange={e => setEditing({ ...editing, abbreviation: e.target.value })} /></label>
      <label>Segment<select value={[...segmentIds(state), 'other'].includes(editing.segment) ? editing.segment : 'other'} onChange={e => setEditing({ ...editing, segment: e.target.value as Segment })}>{[...segmentIds(state), 'other'].map(s => <option key={s} value={s}>{segLabel(state, s)}</option>)}</select></label>
      <label>Segment for {month} only<select value={editing.monthly[month] || ''} onChange={e => { const monthly = { ...editing.monthly }; if (e.target.value) monthly[month] = e.target.value as Segment; else delete monthly[month]; setEditing({ ...editing, monthly }); }}><option value="">Same as above</option>{segmentIds(state).map(s => <option key={s} value={s}>{segLabel(state, s)}</option>)}</select></label>
      <label>Colours, one per line: Name = abbreviations used in your report<textarea rows={4} aria-label="Colours of this model" value={colourLines} onChange={e => setColourLines(e.target.value)} placeholder={'Cream = CRM\nPink = PINK\nGraphite = GRPH'} /></label>
      <label>Variants, one per line: SKU | RAM | storage | colours<textarea rows={4} value={variants} onChange={e => setVariants(e.target.value)} placeholder="SM-A176BZKGINU | 6GB | 128GB | Black, Blue" /></label>
      <div className="share-toolbar"><button type="button" className="primary" disabled={!/^[A-Z0-9]{3,6}$/.test(editing.code)} onClick={() => { if (ctx.saveModelName && !ctx.saveModelName(editing.code, editing.name)) return; ctx.change(setModelColours(saveItem(state, { ...editing, variants: parseVariants(variants) }), editing.code.trim().toUpperCase(), parseColoursText(colourLines)), 'catalog edit'); setEditing(null); }}>Save</button>
        {itemFor(state, editing.code) && state.catalog.some(c => c.code === editing.code) && <button type="button" className="subtle-btn danger" onClick={() => { if (ctx.resetModelName && !ctx.resetModelName(editing.code)) return; ctx.change(resetItem(state, editing.code), 'catalog reset'); setEditing(null); }}>Reset to built-in</button>}
        <button type="button" className="subtle-btn" onClick={() => setEditing(null)}>Cancel</button></div></section>}
  </div>;
}
