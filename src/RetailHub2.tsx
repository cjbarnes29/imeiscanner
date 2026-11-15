// RetailLens screens, part 2: Gives, Stock, Reports, Data. Rules are in src/retail/*.ts; see RetailHub.tsx for the first part.
import { useEffect, useMemo, useState } from 'react';
import { applyAllocation, recommend, undoAllocation, type Proposal, type Recommendation } from './retail/allocation';
import { fullCatalog, segmentOf } from './retail/catalog';
import { makeBackup, readBackup, restoreBackup, emptyDay, withAudit } from './retail/data';
import { adjustStock, stockRows } from './retail/inventory';
import { buildReport, DEFAULT_TEMPLATE, updateReport } from './retail/report';
import { liveSales, reattribute, voidSale } from './retail/sales';
import { pendingBySegment, submittedSince } from './retail/dashboard';
import { listSnapshots, type Snapshot } from './retail/retail-store';
import { SEGMENTS, SEGMENT_LABEL, monthOf, type Segment } from './retail/types';
import { last4, num, updateDay, who, type RetailCtx } from './retail/ui-helpers';

// ---- Gives -------------------------------------------------------------------------------------------------------------------------------
export function GivesTab(ctx: RetailCtx) {
  const { state, records, people, today } = ctx;
  const month = monthOf(today);
  const [rec, setRec] = useState<(Recommendation & { source: 'recommended' | 'manual' }) | null>(null);
  const [ok, setOk] = useState<string[]>([]);
  const [manual, setManual] = useState<{ personId: string; segment: Segment; count: string }>({ personId: people[0]?.id || '', segment: 'mid', count: '1' });
  // units a person has sold but not submitted, plus those submitted since their screenshot: both already count toward what they need
  const creditOf = (id: string) => { const out: Partial<Record<Segment, number>> = { ...pendingBySegment(state, id) }; for (const [s, n] of Object.entries(submittedSince(state, id, state.targets[month]?.[id]))) out[s as Segment] = (out[s as Segment] || 0) + (n || 0); return out; };
  const view = () => records.map(r => ({ id: r.id, imei: r.imei, personId: r.personId, segment: segmentOf(state, r.model, month, state.recordMeta[r.id]), duplicate: r.duplicate }));
  const run = () => {
    const result = recommend({ state, month, people, records: view(), pending: Object.fromEntries(people.map(p => [p.id, creditOf(p.id)])) });
    setRec({ ...result, source: 'recommended' }); setOk(result.proposals.map(p => p.id));
  };
  const propose = () => {
    const pool = view().filter(r => r.personId === '' && r.segment === manual.segment && /^\d{15}$/.test(r.imei) && !r.duplicate);
    const take = pool.slice(0, num(manual.count));
    if (!manual.personId || !take.length) { ctx.notify('Nothing to give: no unassigned phone of that segment.'); return; }
    const proposal: Proposal = { id: 'm0', personId: manual.personId, segment: manual.segment, recordIds: take.map(r => r.id), reason: 'Chosen by you', step: 'toward100' };
    setRec({ proposals: [proposal], leftover: {}, notes: [], source: 'manual' }); setOk(['m0']);
  };
  const approve = (chosen: string[]) => {
    if (!rec) return;
    const result = applyAllocation(view(), rec.proposals, new Set(chosen), rec.source, month);
    if (!result.event) { ctx.notify(result.blocked.length ? 'Nothing moved: those phones are already with that person.' : 'Nothing was approved.'); return; }
    ctx.assign(result.event.items.map(i => ({ id: i.recordId, personId: i.to })));
    ctx.change({ ...state, allocations: [...state.allocations, result.event] }, 'allocation');
    ctx.notify(`${result.moved.length} phone${result.moved.length === 1 ? '' : 's'} given${result.blocked.length ? `, ${result.blocked.length} skipped (already held)` : ''}. It is in the history and can be undone.`);
    setRec(null);
  };
  const undo = (id: string) => {
    const event = state.allocations.find(a => a.id === id);
    if (!event) return;
    const result = undoAllocation(view().map(r => ({ id: r.id, personId: r.personId })), event);
    ctx.assign(result.restored.map(rid => ({ id: rid, personId: event.items.find(i => i.recordId === rid)!.from })));
    ctx.change({ ...state, allocations: state.allocations.map(a => a.id === id ? result.event : a) }, 'undo allocation');
    ctx.notify(`${result.restored.length} phone${result.restored.length === 1 ? '' : 's'} returned${result.kept.length ? `; ${result.kept.length} stay where they are now` : ''}.`);
  };
  const byId = new Map(records.map(r => [r.id, r]));
  return <div className="retail-gives">
    <section className="retail-card"><h3>My target</h3>
      <div className="retail-inline">
        <label>I am<select value={state.settings.myPersonId} onChange={e => ctx.change({ ...state, settings: { ...state.settings, myPersonId: e.target.value } }, '')}><option value="">Choose…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Protect my<select value={state.settings.myThreshold} onChange={e => ctx.change({ ...state, settings: { ...state.settings, myThreshold: Number(e.target.value) as 70 | 100 | 120 } }, '')}>{[70, 100, 120].map(t => <option key={t} value={t}>{t}% target</option>)}</select></label>
      </div>
      <p className="settings-help">Recommendations reserve the units I need for this target first, then help everyone below 70%.</p>
    </section>
    <section className="retail-card"><h3>Recommend who gets which phones</h3>
      <div className="share-toolbar"><button type="button" className="primary" onClick={run}>Recommend allocation</button></div>
      <div className="retail-inline"><label>Give<input inputMode="numeric" aria-label="How many" value={manual.count} onChange={e => setManual({ ...manual, count: e.target.value })} /></label>
        <label>of<select value={manual.segment} onChange={e => setManual({ ...manual, segment: e.target.value as Segment })}>{SEGMENTS.map(s => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select></label>
        <label>to<select value={manual.personId} onChange={e => setManual({ ...manual, personId: e.target.value })}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button type="button" className="subtle-btn" onClick={propose}>Propose</button></div>
      {rec && <div className="retail-proposals" role="group" aria-label="Proposed allocation">
        {rec.notes.map((n, i) => <p key={i} className="amber">{n}</p>)}
        <ul className="retail-list">{rec.proposals.map(p => <li key={p.id}><label><input type="checkbox" checked={ok.includes(p.id)} onChange={() => setOk(old => old.includes(p.id) ? old.filter(x => x !== p.id) : [...old, p.id])} /> <strong>{p.recordIds.length} × {SEGMENT_LABEL[p.segment]}</strong> → {who(ctx, p.personId)} <small>{p.reason}</small></label>
          <small>{p.recordIds.map(id => last4(byId.get(id)?.imei || '')).join(' ')}</small></li>)}</ul>
        {Object.keys(rec.leftover).length > 0 && <p className="settings-help">Not proposed (stay unassigned): {Object.entries(rec.leftover).map(([s, n]) => `${n} ${SEGMENT_LABEL[s as Segment]}`).join(', ')}.</p>}
        {rec.proposals.length > 0 && <div className="share-toolbar"><button type="button" className="primary" disabled={!ok.length} onClick={() => approve(ok)}>Approve {ok.length} selected</button><button type="button" className="subtle-btn" onClick={() => setRec(null)}>Cancel</button></div>}
      </div>}
    </section>
    <section className="retail-card"><h3>Allocation history</h3>
      <ul className="retail-list">{[...state.allocations].reverse().slice(0, 15).map(a => <li key={a.id}><span>{a.at.slice(0, 16).replace('T', ' ')} · {a.items.length} phone{a.items.length === 1 ? '' : 's'} · {a.source === 'manual' ? 'by you' : 'recommended'} · {[...new Set(a.items.map(i => who(ctx, i.to)))].join(', ')}{a.status === 'undone' ? ' · undone' : ''}</span>
        {a.status === 'applied' && <button type="button" className="subtle-btn" onClick={() => undo(a.id)}>Undo</button>}</li>)}{!state.allocations.length && <li className="settings-help">Approved allocations appear here.</li>}</ul>
    </section>
  </div>;
}

// ---- Stock and sales ---------------------------------------------------------------------------------------------------------------------
export function StockTab(ctx: RetailCtx) {
  const { state, records, today, people } = ctx;
  const rows = useMemo(() => stockRows(state, records, today), [state, records, today]);
  const total = rows.reduce((n, r) => n + r.qty, 0);
  const [form, setForm] = useState({ code: '', storage: '', color: '', delta: '1', note: '' });
  const [open, setOpen] = useState<{ id: string; mode: 'void' | 'move' } | null>(null);
  const [reason, setReason] = useState('');
  const [toPerson, setToPerson] = useState('');
  const sales = liveSales(state).filter(s => s.date === today);
  const adjust = () => {
    const item = fullCatalog(state).find(i => i.code === form.code);
    if (!item || !Number(form.delta)) { ctx.notify('Choose a model and a number other than 0.'); return; }
    ctx.change(adjustStock(state, { code: item.code, name: item.name, storage: form.storage, color: form.color, delta: Number(form.delta), note: form.note || 'manual adjustment' }), 'stock adjustment');
    setForm({ ...form, delta: '1', note: '' });
  };
  const act = () => {
    if (!open) return;
    const result = open.mode === 'void' ? voidSale(state, open.id, reason) : reattribute(state, open.id, toPerson, reason);
    if (!result.ok) { ctx.notify(result.error === 'needs-reason' ? 'Write a reason first. It is kept in the audit trail.' : 'That change is not allowed.'); return; }
    ctx.change(result.state, open.mode === 'void' ? 'void sale' : 'reattribute sale'); setOpen(null); setReason('');
  };
  return <div className="retail-stock">
    <section className="retail-card"><h3>Stock ({total})</h3>
      <table className="retail-table"><thead><tr><th>Model</th><th>Storage</th><th>Colour</th><th>Qty</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.key}><td>{r.abbreviation}{r.adjust ? <small> ({r.adjust > 0 ? '+' : ''}{r.adjust} adjusted)</small> : null}</td><td>{r.storage || '—'}</td><td>{r.color || '—'}</td><td>{r.qty}</td></tr>)}
        {!rows.length && <tr><td colSpan={4} className="settings-help">No stock yet. Scanned phones with a valid IMEI appear here; a confirmed sale removes one.</td></tr>}</tbody></table>
      {rows.length > 0 && <p className="settings-help">Colour split: {[...new Set(rows.map(r => r.code))].slice(0, 6).map(code => `${rows.find(r => r.code === code)!.abbreviation}: ${rows.filter(r => r.code === code).map(r => `${r.color || 'no colour'} ${r.qty}`).join(', ')}`).join(' · ')}</p>}
    </section>
    <section className="retail-card"><h3>Adjust stock by hand</h3>
      <p className="settings-help">For opening stock or a phone sold outside the app. Each line is kept and explained.</p>
      <div className="retail-inline"><select aria-label="Model" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}><option value="">Model…</option>{fullCatalog(state).map(i => <option key={i.code} value={i.code}>{i.abbreviation}</option>)}</select>
        <input aria-label="Storage" placeholder="Storage" value={form.storage} onChange={e => setForm({ ...form, storage: e.target.value })} /><input aria-label="Colour" placeholder="Colour" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
        <input aria-label="Change" inputMode="numeric" value={form.delta} onChange={e => setForm({ ...form, delta: e.target.value })} /><input aria-label="Note" placeholder="Note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        <button type="button" className="subtle-btn" onClick={adjust}>Add line</button></div>
    </section>
    <section className="retail-card"><h3>Sales today ({sales.length})</h3>
      <ul className="retail-list">{sales.map(s => <li key={s.id}><span>{s.modelName} {last4(s.imei)} · {who(ctx, s.personId)}{s.attributedBy === 'approved' ? ' · moved (approved)' : ''}{s.submitted ? ' · submitted' : ''}</span>
        <span className="retail-inline"><button type="button" className="subtle-btn" onClick={() => { setOpen({ id: s.id, mode: 'void' }); setReason(''); }}>Undo sale</button><button type="button" className="subtle-btn" onClick={() => { setOpen({ id: s.id, mode: 'move' }); setReason(''); setToPerson(''); }}>Change person</button></span></li>)}
        {!sales.length && <li className="settings-help">Nothing sold today.</li>}</ul>
      {open && <div className="retail-bulk" role="group" aria-label="Correct a sale">
        {open.mode === 'move' && <select aria-label="New person" value={toPerson} onChange={e => setToPerson(e.target.value)}><option value="">Move to…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <input aria-label="Reason" placeholder="Reason (required, kept in the audit trail)" value={reason} onChange={e => setReason(e.target.value)} />
        <button type="button" className="primary" onClick={act}>{open.mode === 'void' ? 'Undo this sale' : 'Approve the change'}</button><button type="button" className="subtle-btn" onClick={() => setOpen(null)}>Cancel</button></div>}
    </section>
  </div>;
}

// ---- Reports -----------------------------------------------------------------------------------------------------------------------------
export function ReportsTab(ctx: RetailCtx) {
  const { state, records, today, people } = ctx;
  const [date, setDate] = useState(today);
  const [sample, setSample] = useState(ctx.sharedText || '');
  const [text, setText] = useState('');
  const [personId, setPersonId] = useState('');
  const [note, setNote] = useState('');
  const day = state.days[date] || emptyDay();
  const set = (fn: Parameters<typeof updateDay>[2]) => ctx.change(updateDay(state, date, fn), '');
  const write = () => {
    if (sample.trim()) { const r = updateReport(state, records, sample, { date, personId }); setText(r.text); setNote(r.warnings.join(' ') || 'Written in the layout of your example.'); return; }
    setText(buildReport(state, records, state.template || DEFAULT_TEMPLATE, { date, personId })); setNote(state.template ? 'Written in your saved layout.' : 'No example pasted: the standard layout was used.');
  };
  const saveLayout = () => {
    if (!sample.trim()) return;
    const r = updateReport(state, records, sample, { date, personId });
    ctx.change({ ...state, template: r.learned }, 'report layout'); ctx.notify('Layout saved. It will be used from now on.');
  };
  return <div className="retail-reports">
    <section className="retail-card"><h3>Day log</h3>
      <label>Date<input type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} /></label>
      <div className="retail-inline"><label>Activations<input inputMode="numeric" value={day.activations} onChange={e => set(d => ({ ...d, activations: num(e.target.value) }))} /></label>
        <label>SC+<input inputMode="numeric" value={day.scPlus} onChange={e => set(d => ({ ...d, scPlus: num(e.target.value) }))} /></label></div>
      <h4>Competitor sales</h4>
      <ul className="retail-list">{day.competitor.map((c, i) => <li key={i}><span>{[c.brand, c.model].filter(Boolean).join(' ')} × {c.qty}</span><button type="button" className="subtle-btn" onClick={() => set(d => ({ ...d, competitor: d.competitor.filter((_, k) => k !== i) }))}>Remove</button></li>)}</ul>
      <form className="retail-inline" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const brand = String(f.get('brand') || '').trim(); if (!brand) return; set(d => ({ ...d, competitor: [...d.competitor, { brand, model: String(f.get('model') || '').trim(), qty: Math.max(1, num(String(f.get('qty') || '1'))) }] })); e.currentTarget.reset(); }}>
        <input name="brand" aria-label="Competitor brand" placeholder="Brand" /><input name="model" aria-label="Competitor model" placeholder="Model" /><input name="qty" aria-label="Competitor quantity" inputMode="numeric" placeholder="Qty" defaultValue="1" /><button type="submit" className="subtle-btn">Add</button></form>
      <h4>Shifts</h4>
      <ul className="retail-list">{day.shifts.map((s, i) => <li key={i}><span>{s.person}: {s.shift}</span><button type="button" className="subtle-btn" onClick={() => set(d => ({ ...d, shifts: d.shifts.filter((_, k) => k !== i) }))}>Remove</button></li>)}</ul>
      <form className="retail-inline" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const person = String(f.get('person') || '').trim(); if (!person) return; set(d => ({ ...d, shifts: [...d.shifts, { person, shift: String(f.get('shift') || '').trim() }] })); e.currentTarget.reset(); }}>
        <input name="person" aria-label="Shift person" placeholder="Person" list="retail-people" /><input name="shift" aria-label="Shift" placeholder="Morning / Evening" /><button type="submit" className="subtle-btn">Add</button></form>
      <datalist id="retail-people">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
    </section>
    <section className="retail-card"><h3>WhatsApp report</h3>
      <p className="settings-help">Paste a report you sent before. The app learns its layout and writes the new one from your sales, stock, colours and the day log. Lines it does not understand are kept as written.</p>
      <label>Your example (optional)<textarea rows={6} value={sample} onChange={e => setSample(e.target.value)} placeholder="Paste yesterday's report here" /></label>
      <div className="retail-inline"><label>For<select value={personId} onChange={e => setPersonId(e.target.value)}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      <div className="share-toolbar"><button type="button" className="primary" onClick={write}>Write the report</button><button type="button" className="subtle-btn" disabled={!sample.trim()} onClick={saveLayout}>Save this layout</button></div>
      {note && <p className="settings-help">{note}</p>}
      {text && <><textarea aria-label="The report" rows={12} value={text} onChange={e => setText(e.target.value)} />
        <div className="share-toolbar"><button type="button" className="primary" onClick={() => ctx.share(text)}>Send on WhatsApp</button><button type="button" className="subtle-btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => ctx.notify('Report copied.'), () => ctx.notify('Could not copy.')); }}>Copy</button></div></>}
    </section>
  </div>;
}

// ---- Data --------------------------------------------------------------------------------------------------------------------------------
export function DataTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [check, setCheck] = useState<ReturnType<typeof readBackup> | null>(null);
  useEffect(() => { void listSnapshots().then(setSnaps); }, [state]);
  const months = Object.entries(state.history).sort((a, b) => b[0].localeCompare(a[0]));
  const download = () => { ctx.download(new Blob([JSON.stringify(makeBackup(state, records))], { type: 'application/json' }), `RetailLens-backup-${today}.json`); ctx.change(withAudit(state, 'backup', 'downloaded a backup'), ''); };
  const pick = async (file?: File) => { if (file) setCheck(readBackup(await file.text())); };
  const restore = () => {
    if (!check || !check.ok) return;
    ctx.change(restoreBackup(state, check.backup).state, 'restore backup'); setCheck(null); ctx.notify('Backup restored. The data from before is kept: use "Go back to" below to undo.');
  };
  return <div className="retail-data">
    <section className="retail-card"><h3>Backup and restore</h3>
      <p className="settings-help">The backup holds your retail data (catalog edits, targets, sales, allocations, reports) and a list of the scanned numbers. It never holds pictures, and restoring never touches your scanned records or photos.</p>
      <div className="share-toolbar"><button type="button" className="primary" onClick={download}>Download a backup</button>
        <label className="subtle-btn">Choose a backup to restore<input type="file" accept="application/json,.json" hidden onChange={e => void pick(e.target.files?.[0])} /></label></div>
      {check && !check.ok && <p className="bad" role="alert">{check.error}</p>}
      {check && check.ok && <div className="retail-bulk" role="group" aria-label="Restore this backup"><span>Backup of {check.backup.createdAt.slice(0, 16).replace('T', ' ')}: {check.backup.state.sales.length} sales, {Object.keys(check.backup.state.targets).length} month(s) of targets, {check.backup.state.catalog.length} catalog edits.</span>
        <button type="button" className="primary" onClick={restore}>Restore (current data is kept for Undo)</button><button type="button" className="subtle-btn" onClick={() => setCheck(null)}>Cancel</button></div>}
    </section>
    <section className="retail-card"><h3>Go back to an earlier state</h3>
      <ul className="retail-list">{snaps.map(s => <li key={s.n}><span>{s.at.slice(0, 16).replace('T', ' ')} · before: {s.why}</span><button type="button" className="subtle-btn" onClick={() => { ctx.change(s.state, `go back before: ${s.why}`); ctx.notify('Went back. The state you left is also kept.'); }}>Go back to this</button></li>)}{!snaps.length && <li className="settings-help">Every change keeps the state before it (the last 8).</li>}</ul>
    </section>
    <section className="retail-card"><h3>Monthly history</h3>
      <ul className="retail-list">{months.map(([m, h]) => <li key={m}><span><strong>{m}</strong> · {h.sales} sale{h.sales === 1 ? '' : 's'} · {Object.entries(h.byPerson).map(([id, n]) => `${who(ctx, id)} ${n}`).join(', ') || 'no sales'}</span></li>)}{!months.length && <li className="settings-help">Closed months appear here. Nothing is deleted when a month ends.</li>}</ul>
    </section>
    <section className="retail-card"><h3>Audit trail</h3>
      <ul className="retail-list">{[...state.audit].reverse().slice(0, 25).map((a, i) => <li key={i}><small>{a.at.slice(0, 16).replace('T', ' ')}</small> <strong>{a.what}</strong> {a.detail}</li>)}{!state.audit.length && <li className="settings-help">Sales, approvals and restores are listed here.</li>}</ul>
    </section>
  </div>;
}
