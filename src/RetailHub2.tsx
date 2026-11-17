// RetailLens screens, part 2: Gives and Data. Rules are in src/retail/*.ts; see RetailHub.tsx for the first part.
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyAllocation, givenToday, undoAllocation, type Proposal } from './retail/allocation';
import { allocView, recommendFor } from './retail/autogive';
import { makeBackup, readBackup, restoreBackup, withAudit } from './retail/data';
import { listSnapshots, type Snapshot } from './retail/retail-store';
import { segLabel } from './retail/segments';
import { monthOf, type GiveLimit } from './retail/types';
import { last4, who, type RetailCtx } from './retail/ui-helpers';

// ---- Gives -------------------------------------------------------------------------------------------------------------------------------
// Suggestions only: one list, one reason each. Nothing is assigned until the person approves it (and it can be undone).
export function GivesTab(ctx: RetailCtx) {
  const { state, records, people, today } = ctx;
  const month = monthOf(today);
  const [skipped, setSkipped] = useState<string[]>([]);
  const view = () => allocView(state, month, records);
  const rec = useMemo(() => recommendFor(state, month, today, people, records), [state, month, today, people, records]);
  const open = rec.proposals.filter(p => !skipped.includes(p.id));
  const approve = (list: Proposal[]) => {
    const result = applyAllocation(view(), rec.proposals, new Set(list.map(p => p.id)), 'recommended', month);
    if (!result.event) { ctx.notify(result.blocked.length ? 'Nothing moved: those phones are already with that person.' : 'Nothing was approved.'); return; }
    ctx.assign(result.event.items.map(i => ({ id: i.recordId, personId: i.to })));
    ctx.change({ ...state, allocations: [...state.allocations, result.event] }, 'allocation');
    ctx.notify(`${result.moved.length} phone${result.moved.length === 1 ? '' : 's'} given${result.blocked.length ? `, ${result.blocked.length} skipped (already held)` : ''}. It is in the history and can be undone.`);
  };
  const undo = (id: string) => {
    const event = state.allocations.find(a => a.id === id);
    if (!event) return;
    const result = undoAllocation(view().map(r => ({ id: r.id, personId: r.personId })), event);
    ctx.assign(result.restored.map(rid => ({ id: rid, personId: event.items.find(i => i.recordId === rid)!.from })));
    ctx.change({ ...state, allocations: state.allocations.map(a => a.id === id ? result.event : a) }, 'undo allocation');
    ctx.notify(`${result.restored.length} phone${result.restored.length === 1 ? '' : 's'} returned${result.kept.length ? `; ${result.kept.length} stay where they are now` : ''}.`);
  };
  const mode = state.giveMode === 'auto' ? 'auto' : 'suggest';
  const setMode = (next: 'auto' | 'suggest') => { if (next === mode) return; ctx.change({ ...state, giveMode: next === 'auto' ? 'auto' : undefined }, ''); ctx.notify(next === 'auto' ? 'Auto give is on. New phones are given by themselves; every give is in History and can be undone.' : 'Suggest only is on. Nothing moves until you approve it.'); };
  const limits = state.giveLimits || {};
  const limitOf = (id: string): GiveLimit => limits[id] || {};
  const today_ = useMemo(() => givenToday(state, today), [state, today]);
  /** Changes one person's limit. A blank box clears it (no minimum / no maximum); only digits count; an empty limit is not kept. */
  const setLimit = (id: string, patch: Partial<GiveLimit>) => {
    const merged: GiveLimit = { ...limitOf(id), ...patch };
    if (!merged.min) delete merged.min;
    if (merged.max === undefined) delete merged.max;
    if (!merged.off) delete merged.off;
    const next = { ...limits };
    if (Object.keys(merged).length) next[id] = merged; else delete next[id];
    ctx.change({ ...state, giveLimits: Object.keys(next).length ? next : undefined }, '');
  };
  const digits = (value: string): number | undefined => { const d = value.replace(/[^\d]/g, ''); return d === '' ? undefined : Math.min(999, Number(d)); };
  const byId = new Map(records.map(r => [r.id, r]));
  return <div className="retail-gives">
    <section className="retail-card screen-extra"><h3>How phones are given</h3>
      <div className="give-tabs two" role="group" aria-label="How phones are given">
        <button type="button" className={mode === 'suggest' ? 'on' : ''} aria-pressed={mode === 'suggest'} onClick={() => setMode('suggest')}>Suggest only</button>
        <button type="button" className={mode === 'auto' ? 'on' : ''} aria-pressed={mode === 'auto'} onClick={() => setMode('auto')}>Auto give</button>
      </div>
      <p className="settings-help">{mode === 'auto' ? 'New phones are given by themselves when a scan finishes, with the same rules as the suggestions and each person’s limits below. Phones that still need review, are held or are repeated wait. Every give is in History and can be undone.' : 'Phones are only suggested. Nothing moves until you approve it.'}</p>
    </section>
    <section className="retail-card"><h3>Suggested ({open.length})</h3>
      {rec.notes.map((n, i) => <p key={i} className="amber">{n}</p>)}
      <ul className="retail-list gv-list">{open.map(p => <li key={p.id} className="gv-item"><span className="gv-main"><strong>{p.recordIds.length} × {segLabel(state, p.segment)} → {who(ctx, p.personId)}</strong><small>{p.reason}</small><small>{p.recordIds.map(id => last4(byId.get(id)?.imei || '')).join(' ')}</small></span>
        <span className="gv-act"><button type="button" className="subtle-btn" onClick={() => setSkipped(old => [...old, p.id])}>Skip</button><button type="button" className="primary" onClick={() => approve([p])}>Approve</button></span></li>)}
        {!open.length && <li className="settings-help">{state.targets[month] ? 'No suggestions right now. Suggestions appear when unassigned phones fit a target.' : 'Set targets first (Targets), then suggestions appear here.'}</li>}</ul>
      {open.length > 1 && <div className="share-toolbar"><button type="button" className="primary" onClick={() => approve(open)}>Approve all {open.length}</button>{skipped.length > 0 && <button type="button" className="subtle-btn" onClick={() => setSkipped([])}>Show skipped</button>}</div>}
      {Object.keys(rec.leftover).length > 0 && <p className="settings-help">Not suggested (stay unassigned): {Object.entries(rec.leftover).map(([s, n]) => `${n} ${segLabel(state, s)}`).join(', ')}.</p>}
    </section>
    <details className="retail-card screen-extra"><summary><strong>Limits per person</strong></summary>
      <p className="settings-help">Minimum: this person gets at least this many phones a day when there are phones. Maximum: never more than this many a day; the rest stays without an owner for later (a late upload, or tomorrow). Leave a box empty for no limit.</p>
      {people.map(p => { const lim = limitOf(p.id); return <div key={p.id} className="gl-person">
        <div className="tg-top"><strong>{p.name}</strong><small>Given today: {today_[p.id] || 0}</small></div>
        <div className="tg-fields">
          <label>Minimum a day<input aria-label={`Minimum a day for ${p.name}`} inputMode="numeric" placeholder="None" value={lim.min ?? ''} onChange={e => setLimit(p.id, { min: digits(e.target.value) })} onFocus={e => e.currentTarget.select()} /></label>
          <label>Maximum a day<input aria-label={`Maximum a day for ${p.name}`} inputMode="numeric" placeholder="No limit" value={lim.max ?? ''} onChange={e => setLimit(p.id, { max: digits(e.target.value) })} onFocus={e => e.currentTarget.select()} /></label>
        </div>
        <label className="gl-off"><input type="checkbox" aria-label={`Leave ${p.name} out`} checked={!!lim.off} onChange={e => setLimit(p.id, { off: e.target.checked })} /> Leave {p.name} out for now (no suggestions, no automatic gives)</label>
        {lim.max !== undefined && (lim.min || 0) > lim.max && <p className="amber">The minimum is more than the maximum, so the maximum wins.</p>}
      </div>; })}
      {!people.length && <p className="settings-help">Add people in More &gt; People first.</p>}
    </details>
    <details className="retail-card screen-extra" open={!state.settings.myPersonId}><summary><strong>My target</strong></summary>
      <div className="retail-inline">
        <label>I am<select value={state.settings.myPersonId} onChange={e => ctx.change({ ...state, settings: { ...state.settings, myPersonId: e.target.value } }, '')}><option value="">Choose…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Protect my<select value={state.settings.myThreshold} onChange={e => ctx.change({ ...state, settings: { ...state.settings, myThreshold: Number(e.target.value) as 70 | 100 | 120 } }, '')}>{[70, 100, 120].map(t => <option key={t} value={t}>{t}% target</option>)}</select></label>
      </div>
      <p className="settings-help">Suggestions reserve the units I need for this target first, then help everyone below 70%.</p>
    </details>
    <details className="retail-card screen-extra"><summary><strong>History ({state.allocations.length})</strong></summary>
      <ul className="retail-list">{[...state.allocations].reverse().slice(0, 15).map(a => <li key={a.id}><span>{a.at.slice(0, 16).replace('T', ' ')} · {a.items.length} phone{a.items.length === 1 ? '' : 's'} · {a.source === 'manual' ? 'by you' : a.source === 'auto' ? 'automatic' : 'suggested'} · {[...new Set(a.items.map(i => who(ctx, i.to)))].join(', ')}{a.status === 'undone' ? ' · undone' : ''}</span>
        {a.status === 'applied' && <button type="button" className="subtle-btn" onClick={() => undo(a.id)}>Undo</button>}</li>)}{!state.allocations.length && <li className="settings-help">Approved suggestions and automatic gives appear here.</li>}</ul>
    </details>
  </div>;
}

// ---- Data --------------------------------------------------------------------------------------------------------------------------------
export function DataTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [check, setCheck] = useState<ReturnType<typeof readBackup> | null>(null);
  const readId = useRef(0);
  const [reading, setReading] = useState(false);
  useEffect(() => () => { readId.current++; }, []);
  useEffect(() => { void listSnapshots().then(setSnaps); }, [state]);
  const months = Object.entries(state.history).sort((a, b) => b[0].localeCompare(a[0]));
  const download = () => { ctx.download(new Blob([JSON.stringify(makeBackup(state, records))], { type: 'application/json' }), `RetailLens-backup-${today}.json`); ctx.change(withAudit(state, 'backup', 'downloaded a backup'), ''); };
  /**
   * Reads the file the person chose. A file saved a moment ago can read as empty for a few seconds (the phone's file list has not caught up), so an empty
   * read is tried again a few times before it is called empty. Every message says which file and what is wrong.
   */
  const pick = async (file?: File) => {
    if (!file) return;
    const id = ++readId.current;
    setCheck(null);
    setReading(true);
    let text = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      try { text = await file.text(); } catch {
        if (id !== readId.current) return;
        setReading(false);
        setCheck({ ok: false, error: `“${file.name}” could not be opened. Choose it again or download the backup again.` });
        return;
      }
      if (id !== readId.current) return;
      if (text.trim()) break;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 1200));
      if (id !== readId.current) return;
    }
    setReading(false);
    if (!text.trim()) { setCheck({ ok: false, error: `“${file.name}” is empty. A file saved a moment ago can look empty for a few seconds: wait a little and choose it again. If it stays empty, download the backup again.` }); return; }
    const result = readBackup(text.replace(/^\uFEFF/, ''));
    const kb = Math.max(1, Math.round(file.size / 1024));
    setCheck(result.ok ? result : { ok: false, error: /could not be read/.test(result.error) ? `“${file.name}” (${kb} KB) is not a RetailLens backup. Choose the file named RetailLens-backup-….json that “Download a backup” saved.` : `“${file.name}”: ${result.error}` });
  };
  const restore = () => {
    if (!check || !check.ok) return;
    ctx.change(restoreBackup(state, check.backup).state, 'restore backup'); setCheck(null); ctx.notify('Backup restored. The data from before is kept: use "Go back to" below to undo.');
  };
  return <div className="retail-data">
    <section className="retail-card"><h3>Backup and restore</h3>
      <p className="settings-help">The backup holds your retail data (catalog edits, targets, sales, allocations, reports) and a list of the scanned numbers. It never holds pictures, and restoring never touches your scanned records or photos.</p>
      <div className="share-toolbar"><button type="button" className="primary" onClick={download}>Download a backup</button>
        <label className="subtle-btn">Choose a backup to restore<input type="file" accept="application/json,.json" hidden onChange={e => { const chosen = e.target.files?.[0]; e.target.value = ''; void pick(chosen); }} /></label></div>
      {reading && <p role="status">Reading backup…</p>}
      {check && !check.ok && <p className="bad" role="alert">{check.error}</p>}
      {check && check.ok && <div className="retail-bulk" role="group" aria-label="Restore this backup"><span>Backup of {check.backup.createdAt.slice(0, 16).replace('T', ' ')}: {check.backup.state.sales.length} sales, {Object.keys(check.backup.state.targets).length} month(s) of targets, {check.backup.state.catalog.length} catalog edits.</span>
        <button type="button" className="primary" onClick={restore}>Restore (current data is kept for Undo)</button><button type="button" className="subtle-btn" onClick={() => setCheck(null)}>Cancel</button></div>}
    </section>
    <section className="retail-card screen-extra"><h3>Go back to an earlier state</h3>
      <ul className="retail-list">{snaps.map(s => <li key={s.n}><span>{s.at.slice(0, 16).replace('T', ' ')} · before: {s.why}</span><button type="button" className="subtle-btn" onClick={() => { ctx.change(s.state, `go back before: ${s.why}`); ctx.notify('Went back. The state you left is also kept.'); }}>Go back to this</button></li>)}{!snaps.length && <li className="settings-help">Every change keeps the state before it (the last 8).</li>}</ul>
    </section>
    <section className="retail-card screen-extra"><h3>Monthly history</h3>
      <ul className="retail-list">{months.map(([m, h]) => <li key={m}><span><strong>{m}</strong> · {h.sales} sale{h.sales === 1 ? '' : 's'} · {Object.entries(h.byPerson).map(([id, n]) => `${who(ctx, id)} ${n}`).join(', ') || 'no sales'}</span></li>)}{!months.length && <li className="settings-help">Closed months appear here. Nothing is deleted when a month ends.</li>}</ul>
    </section>
    <section className="retail-card screen-extra"><h3>Audit trail</h3>
      <ul className="retail-list">{[...state.audit].reverse().slice(0, 25).map((a, i) => <li key={i}><small>{a.at.slice(0, 16).replace('T', ' ')}</small> <strong>{a.what}</strong> {a.detail}</li>)}{!state.audit.length && <li className="settings-help">Sales, approvals and restores are listed here.</li>}</ul>
    </section>
  </div>;
}
