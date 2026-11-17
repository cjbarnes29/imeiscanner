// RetailLens > Targets and Segments. Targets: pick a level (70 to 120) and every segment line says how many pieces are still needed and per day;
// tap a segment to see each person (target, own sold count, pieces needed at each level). Segments: the person's own list (Fold 1, Fold 2…) and the
// models in each. The arithmetic is in src/retail/targets.ts and segments.ts (unit-tested); this file only shows it.
import { useMemo, useRef, useState } from 'react';
import { fullCatalog, segmentOf, setModelSegment } from './retail/catalog';
import { addSegment, assignModels, deleteSegment, moveSegment, renameSegment, segLabel, segmentDefs, segmentIds } from './retail/segments';
import { emptyTarget, isCapped, lastMonthLine, learnWho, needAt, prevMonth, putTarget, readTargets, setTargetLine, startFromLastMonth, suggestedLevels, type ImportBlock } from './retail/targets';
import { finishAt, finishText, perDayText } from './retail/pace';
import { TargetGrid } from './RetailTargetGrid';
import { daysLeft, isMonth, LEVELS, monthOf, SEGMENT_LABEL, type Level, type Segment, type TargetLine } from './retail/types';
import { itemFor } from './retail/catalog';
import { soldOnDay } from './retail/soldsync';
import { targetSummary } from './retail/targetsummary';
import { num, type RetailCtx } from './retail/ui-helpers';

/** A typed or pasted number: only the digits count. */
const typed = (value: string) => num(value.replace(/[^\d]/g, ''));
const ceilTenth = (n: number) => (n <= 0 ? 0 : Math.ceil(n * 10) / 10);
/** One imported part waiting for a check: who it is for (empty = not sure, the person must choose), the month and the numbers read. */
type Draft = { month: string; personId: string; key: string; how: 'learned' | 'name' | 'none'; warnings: string[]; rows: { from: string; segment: Segment | ''; target: number; achieved: number }[] };
const HOW: Record<Draft['how'], string> = { learned: 'Recognised from the name or ID on it.', name: 'Found the name on it.', none: 'Could not tell who this is for. Choose a person.' };

export function TargetsTab(ctx: RetailCtx) {
  const { state, today, people } = ctx;
  const [month, setMonth] = useState(monthOf(today));
  const [personId, setPersonId] = useState('all');
  const [level, setLevel] = useState<Level>(100);
  const [openSeg, setOpenSeg] = useState<Segment | ''>('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [editAll, setEditAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [levelsFor, setLevelsFor] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const days = daysLeft(month, today);
  const segs = segmentIds(state);
  const chosen = personId === 'all' ? people : people.filter(p => p.id === personId);
  const lineOf = (pid: string, segment: Segment): TargetLine => state.targets[month]?.[pid]?.lines.find(l => l.segment === segment) || { segment, target: 0, achieved: 0 };

  const setLine = (pid: string, segment: Segment, patch: Partial<TargetLine>) => ctx.change(setTargetLine(state, month, pid, segment, patch), '');
  /** The highest level of one person's line copied to everyone else for this segment (levels and sold stay each person's own). */
  const copyCapToEveryone = (fromId: string, segment: Segment) => {
    const cap = lineOf(fromId, segment).cap;
    let next = state, count = 0;
    for (const p of people) if (p.id !== fromId) { next = setTargetLine(next, month, p.id, segment, { cap }); count++; }
    if (!count) { ctx.notify('There is nobody else to copy to. Add people in More > People.'); return; }
    ctx.change(next, 'copy highest level');
    ctx.notify(cap ? `Highest level ${cap}% copied to ${count} ${count === 1 ? 'person' : 'people'}.` : `No limit copied to ${count} ${count === 1 ? 'person' : 'people'}.`);
  };
  /** The day each level (70, 100, 120) is reached at this month's pace, for some lines added together; a line that stops lower says its top level. */
  const finishOf = (lines: TargetLine[]): string => {
    const used = lines.filter(l => l.target > 0);
    if (!used.length) return '';
    const sold = used.reduce((a, l) => a + l.achieved, 0);
    return ([70, 100, 120] as Level[]).map(lv => used.every(l => isCapped(l, lv)) ? `${lv}%: top is ${Math.min(...used.map(l => l.cap as number))}%` : finishText(lv, finishAt(used.reduce((a, l) => a + needAt(l, lv, days).remaining, 0), sold, month, today))).join(' · ');
  };
  /** One person's target copied to everyone else for this segment. Only the target number: levels and sold stay each person's own. */
  const copyTargetToEveryone = (fromId: string, segment: Segment) => {
    const value = lineOf(fromId, segment).target;
    let next = state, count = 0;
    for (const p of people) {
      if (p.id === fromId) continue;
      const base = next.targets[month]?.[p.id] || emptyTarget(p.id, month, 'manual', new Date().toISOString(), []);
      const exists = base.lines.some(l => l.segment === segment);
      const lines = exists ? base.lines.map(l => l.segment === segment ? { ...l, target: value } : l) : [...base.lines, { segment, target: value, achieved: 0 }];
      next = putTarget(next, { ...base, lines }); count++;
    }
    if (!count) { ctx.notify('There is nobody else to copy to. Add people in More > People.'); return; }
    ctx.change(next, 'copy target');
    ctx.notify(`Target ${value} copied to ${count} ${count === 1 ? 'person' : 'people'}. Levels and sold were not changed.`);
  };
  /** A new month starts from the last one: targets and levels come over for everyone, sold starts at 0. */
  const startMonth = () => {
    const r = startFromLastMonth(state, month, people.map(p => p.id));
    if (!r.added) { ctx.notify('Nothing to copy: this month already has its targets (or last month had none).'); return; }
    ctx.change(r.state, 'targets from last month');
    ctx.notify(`${r.added} target line${r.added === 1 ? '' : 's'} copied from last month. Sold starts at 0.`);
  };
  const hasLastMonth = Object.keys(state.targets[prevMonth(month)] || {}).length > 0;
  const setLevelPieces = (pid: string, segment: Segment, lv: Level, value: string) => {
    const line = lineOf(pid, segment);
    const levels = { ...(line.levels || {}) };
    if (value.trim() === '') delete levels[lv]; else levels[lv] = num(value);
    setLine(pid, segment, { levels: Object.keys(levels).length ? levels : undefined });
  };

  // one line per segment: everyone chosen, added together
  const soldToday = useMemo(() => soldOnDay(state, today), [state, today]);
  const rows = useMemo(() => segs.map(segment => {
    let target = 0, sold = 0, remaining = 0;
    const each: { id: string; name: string; target: number; sold: number; remaining: number; perDay: number; today: number; finish: string }[] = [];
    let todayAll = 0, cappedBelow = 0;
    const lines: TargetLine[] = [];
    for (const p of chosen) {
      const l = lineOf(p.id, segment), rem = needAt(l, level, days).remaining;
      target += l.target; sold += l.achieved; remaining += rem; lines.push(l);
      if (l.target > 0 && isCapped(l, level)) cappedBelow = Math.min(cappedBelow || 999, l.cap as number);
      const todayN = (soldToday[p.id] || {})[segment] || 0; todayAll += todayN;
      if (l.target > 0 || l.achieved > 0) each.push({ id: p.id, name: p.name, target: l.target, sold: l.achieved, remaining: rem, perDay: ceilTenth(days <= 0 ? rem : rem / days), today: todayN, finish: finishOf([l]) });
    }
    return { segment, target, sold, remaining, perDay: ceilTenth(days <= 0 ? remaining : remaining / days), each, today: todayAll, finish: finishOf(lines), cappedBelow: cappedBelow === 999 ? 0 : cappedBelow };
  }), [state, month, level, personId, people, today, soldToday]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Turns what was read (one block per person) into parts waiting for a check. Nobody is picked unless the text itself said who it is for. */
  const toDrafts = (blocks: ImportBlock[]): Draft[] => blocks.map(b => ({ month: b.parsed.month || month, personId: b.who.personId, key: b.who.key, how: b.who.how, warnings: b.parsed.warnings,
    rows: b.parsed.lines.map(l => ({ from: SEGMENT_LABEL[l.segment] || l.segment, segment: segs.includes(l.segment) ? l.segment : '', target: l.target, achieved: l.achieved })) }));
  const addDrafts = (found: Draft[]) => setDrafts(old => [...(old || []), ...found]);
  const importScreenshots = async (picked: FileList | null) => {
    const files = picked ? [...picked] : [];
    if (!files.length) return;
    setBusy(true);
    let failed = 0;
    try {
      for (const f of files) {
        try { addDrafts(toDrafts(readTargets(await ctx.readImage(f), people, state.targetAliases || {}))); } catch { failed++; }
      }
      if (failed) ctx.notify(failed === files.length ? 'The screenshot could not be read. Type the numbers by hand.' : `${failed} of ${files.length} screenshots could not be read. Type those numbers by hand.`);
    } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const readPasted = () => {
    if (!pasted.trim()) return;
    addDrafts(toDrafts(readTargets(pasted, people, state.targetAliases || {})));
    setPasted(''); setPasteOpen(false);
  };
  const setDraftAt = (k: number, patch: Partial<Draft>) => setDrafts(old => (old || []).map((d, i) => (i === k ? { ...d, ...patch } : d)));
  const saveDrafts = () => {
    if (!drafts) return;
    const ready = drafts.filter(d => d.personId && isMonth(d.month));
    if (!ready.length) { ctx.notify('Choose who each one is for, and a valid month, first.'); return; }
    let next = state;
    for (const d of ready) {
      const base = next.targets[d.month]?.[d.personId] || emptyTarget(d.personId, d.month, 'screenshot', new Date().toISOString(), []);
      let lines = base.lines;
      for (const r of d.rows) if (r.segment) { const exists = lines.some(l => l.segment === r.segment); lines = exists ? lines.map(l => l.segment === r.segment ? { ...l, target: r.target, achieved: r.achieved } : l) : [...lines, { segment: r.segment, target: r.target, achieved: r.achieved }]; }
      next = putTarget(next, { ...base, lines, source: 'screenshot', importedAt: new Date().toISOString() });
      next = learnWho(next, d.key, d.personId);
    }
    ctx.change(next, 'targets import');
    setMonth(ready[0].month);
    const left = drafts.filter(d => !ready.includes(d));
    setDrafts(left.length ? left : null);
    ctx.notify(left.length ? `Targets saved for ${ready.length}. ${left.length} still need${left.length === 1 ? 's' : ''} a person.` : ready.length === 1 ? 'Targets saved.' : `Targets saved for ${ready.length} people.`);
  };

  const seg = openSeg && segs.includes(openSeg) ? openSeg : '';
  // segments with nothing in them stay out of the way (they are listed when nothing has a target yet, so the first one can be set up)
  const used = rows.filter(r => r.target > 0 || r.sold > 0);
  const visible = showEmpty || !used.length ? rows : used;
  const hidden = rows.length - visible.length;
  return <div className="retail-targets">
    <section className="retail-card"><h3>Targets</h3>
      <div className="retail-inline">
        <label>Month<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <label>Person<select value={personId} onChange={e => setPersonId(e.target.value)}><option value="all">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <p className="settings-help">{days} day{days === 1 ? '' : 's'} left. Show what is needed for:</p>
      <div className="lvl-chips" role="group" aria-label="Level">{LEVELS.map(l => <button key={l} type="button" aria-pressed={level === l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l}</button>)}</div>
      <div className="share-toolbar"><button type="button" className="subtle-btn" disabled={!rows.some(r => r.target > 0)} onClick={() => ctx.share(targetSummary({ month, level, days, person: personId === 'all' ? '' : people.find(p => p.id === personId)?.name, rows: rows.map(r => ({ ...r, label: segLabel(state, r.segment) })) }))}>Share summary: pieces per day</button></div>
      {hasLastMonth && <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={startMonth}>Start from last month</button></div>}
      <div className="share-toolbar"><input ref={file} type="file" accept="image/*" multiple hidden onChange={e => void importScreenshots(e.target.files)} />
        <button type="button" className="subtle-btn" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Reading the screenshot…' : 'Import Promoter screenshot'}</button>
        <button type="button" className="subtle-btn" aria-expanded={pasteOpen} onClick={() => setPasteOpen(!pasteOpen)}>Paste text</button></div>
      {pasteOpen && <div className="tg-paste"><label>Text with the targets (one person, or several one after the other)<textarea rows={7} aria-label="Pasted targets text" value={pasted} placeholder={'Name: Asha\nFlagship 1  Target 3  Achieved 2\nMid  Target 10  Achieved 7'} onChange={e => setPasted(e.target.value)} /></label>
        <div className="share-toolbar"><button type="button" className="primary" disabled={!pasted.trim()} onClick={readPasted}>Read text</button><button type="button" className="subtle-btn" onClick={() => { setPasteOpen(false); setPasted(''); }}>Cancel</button></div></div>}
      <div className="share-toolbar"><button type="button" className="subtle-btn" aria-pressed={editAll} onClick={() => { setEditAll(!editAll); setOpenSeg(''); setLevelsFor(''); }}>{editAll ? 'Close Edit all' : 'Edit all targets and sold'}</button></div>
    </section>

    {drafts && drafts.length > 0 && <section className="retail-card" role="dialog" aria-label="Check the imported targets"><h3>Check the imported targets</h3>
      {drafts.map((d, k) => <div key={k} className="tg-import">
        <p className={d.personId ? 'settings-help' : 'amber'}>{drafts.length > 1 ? `${k + 1} of ${drafts.length}: ` : ''}{HOW[d.how]}{d.key && d.how === 'none' ? ` (it says “${d.key}”)` : ''}</p>
        <div className="retail-inline"><label>Month<input type="month" value={d.month} onChange={e => setDraftAt(k, { month: e.target.value })} /></label>
          <label>Person<select value={d.personId} onChange={e => setDraftAt(k, { personId: e.target.value })}><option value="">Choose a person…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
        {d.warnings.map((w, i) => <p key={i} className="amber">{w}</p>)}
        {d.rows.map((r, j) => <div key={j} className="tg-draft"><strong>{r.from}</strong>
          <select aria-label={`Segment for ${r.from}`} value={r.segment} onChange={e => setDraftAt(k, { rows: d.rows.map((x, i) => i === j ? { ...x, segment: e.target.value } : x) })}><option value="">Not used</option>{segs.map(sg => <option key={sg} value={sg}>{segLabel(state, sg)}</option>)}</select>
          <label>Target<input inputMode="numeric" value={r.target} onChange={e => setDraftAt(k, { rows: d.rows.map((x, i) => i === j ? { ...x, target: num(e.target.value) } : x) })} /></label>
          <label>Sold<input inputMode="numeric" value={r.achieved} onChange={e => setDraftAt(k, { rows: d.rows.map((x, i) => i === j ? { ...x, achieved: num(e.target.value) } : x) })} /></label></div>)}
        {drafts.length > 1 && <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={() => setDrafts(drafts.filter((_, i) => i !== k))}>Remove this one</button></div>}
      </div>)}
      <div className="share-toolbar"><button type="button" className="primary" onClick={saveDrafts}>{drafts.length > 1 ? `Save targets (${drafts.filter(d => d.personId).length} of ${drafts.length})` : 'Save targets'}</button><button type="button" className="subtle-btn" onClick={() => setDrafts(null)}>Discard</button></div></section>}

    {editAll && <TargetGrid ctx={ctx} month={month} level={level} days={days} segs={segs} onOpen={segment => { setEditAll(false); setOpenSeg(segment); }} onClose={() => setEditAll(false)} />}

    {!seg && !editAll && <ul className="tg-segs">{visible.map(r => <li key={r.segment}><button type="button" className="tg-seg" onClick={() => setOpenSeg(r.segment)} aria-label={`Open ${segLabel(state, r.segment)}`}>
      <span className="tg-top"><strong>{segLabel(state, r.segment)}</strong><small>Sold {r.sold} of {r.target}{r.today > 0 && <> · today {r.today}</>}</small></span>
      <span className="tg-bar"><i style={{ width: `${r.target > 0 ? Math.min(100, Math.round(r.sold / r.target * 100)) : 0}%` }} /></span>
      <span className="tg-need">{r.target <= 0 ? 'No target set' : r.remaining <= 0 ? `${level}% reached` : <>Needs <b>{r.remaining} more</b> for {level}% · {perDayText(r.remaining, days)}{r.cappedBelow > 0 && <> · some stop at {r.cappedBelow}%</>}</>}</span>
      {r.finish && <span className="tg-finish">{r.finish}</span>}
      {personId === 'all' && r.each.length > 0 && <span className="tg-people">{r.each.map(e => <span key={e.id} className="tg-p"><b>{e.name}</b><small>{e.sold}/{e.target}{e.today > 0 && <> · today {e.today}</>}</small><em>{e.target <= 0 ? '' : e.remaining <= 0 ? 'reached' : `needs ${e.remaining} · ${perDayText(e.remaining, days)}`}</em></span>)}</span>}</button></li>)}
      {!rows.length && <li className="settings-help">Add segments first (Retail &gt; Segments).</li>}
      {hidden > 0 && <li><button type="button" className="subtle-btn" onClick={() => setShowEmpty(true)}>Show {hidden} empty segment{hidden === 1 ? '' : 's'}</button></li>}</ul>}

    {seg && <section className="retail-card"><div className="tg-head"><button type="button" className="subtle-btn" onClick={() => { setOpenSeg(''); setLevelsFor(''); }}>← All segments</button><h3>{segLabel(state, seg)}</h3></div>
      <p className="settings-help">{days} day{days === 1 ? '' : 's'} left · showing {level}%. Type each person’s target and sold count (paste works). Sold is their own count; nothing else changes it.</p>
      {chosen.map(p => { const l = lineOf(p.id, seg), n = needAt(l, level, days), key = `${p.id}|${seg}`; return <div key={p.id} className="tg-person">
        <div className="tg-top"><strong>{p.name}</strong></div>
        <div className="tg-fields">
          <label>Target<input aria-label={`Target of ${p.name}`} inputMode="numeric" value={l.target} onChange={e => setLine(p.id, seg, { target: typed(e.target.value) })} onFocus={e => e.currentTarget.select()} /></label>
          <label>Sold<input aria-label={`Sold of ${p.name}`} inputMode="numeric" value={l.achieved} onChange={e => setLine(p.id, seg, { achieved: typed(e.target.value) })} onFocus={e => e.currentTarget.select()} /></label>
        </div>
        <p className="tg-need">{l.target <= 0 ? 'Set a target first.' : isCapped(l, level) ? (n.remaining <= 0 ? `The top level here is ${l.cap}%: reached (${n.needed} needed)` : <>The top level here is {l.cap}%: <b>needs {n.remaining} more</b> ({n.needed} in total) · {perDayText(n.remaining, days)}</>) : n.remaining <= 0 ? `${level}% reached (${n.needed} needed)` : <>For {level}%: <b>needs {n.remaining} more</b> ({n.needed} in total) · {perDayText(n.remaining, days)}</>}</p>
        {l.target > 0 && <p className="tg-finish">{finishOf([l])}</p>}
        <div className="tg-actions"><button type="button" className="link-btn" onClick={() => setLevelsFor(levelsFor === key ? '' : key)}>{levelsFor === key ? 'Hide levels' : 'Edit levels'}</button>
          {people.length > 1 && <button type="button" className="subtle-btn" aria-label={`Copy the target of ${p.name} to everyone`} disabled={l.target <= 0} onClick={() => copyTargetToEveryone(p.id, seg)}>Copy target to everyone</button>}</div>
        {levelsFor === key && <div className="tg-levels"><p className="settings-help">Pieces needed in total at each level (from the Promoter screen). Blank = target × level.</p>
          <div className="tg-cap"><label>Highest level<select aria-label={`Highest level for ${p.name}`} value={l.cap ?? ''} onChange={e => setLine(p.id, seg, { cap: e.target.value ? Number(e.target.value) as Level : undefined })}><option value="">No limit</option>{LEVELS.filter(lv => lv < 120).map(lv => <option key={lv} value={lv}>{lv}%</option>)}</select></label>
            {people.length > 1 && <button type="button" className="subtle-btn" aria-label={`Copy the highest level of ${p.name} to everyone`} onClick={() => copyCapToEveryone(p.id, seg)}>Same for everyone</button>}</div>
          <p className="settings-help">Some segments stop at 100%: set it here and the app will not ask for more than that.</p>
          <div className="tg-level-actions"><button type="button" className="subtle-btn" disabled={l.target <= 0} onClick={() => setLine(p.id, seg, { levels: suggestedLevels(l.target) })}>Use suggested</button>
            {(() => { const last = lastMonthLine(state, month, p.id, seg); return <button type="button" className="subtle-btn" disabled={!last} onClick={() => last && setLine(p.id, seg, { target: last.target, levels: last.levels ? { ...last.levels } : undefined, cap: last.cap })}>Same as last month</button>; })()}</div>
          {LEVELS.map(lv => <label key={lv}>{lv}%<input inputMode="numeric" aria-label={`${lv}% pieces for ${p.name}`} placeholder={String(Math.ceil(l.target * lv / 100))} value={l.levels?.[lv] ?? ''} onChange={e => setLevelPieces(p.id, seg, lv, e.target.value.replace(/[^\d]/g, ''))} onFocus={e => e.currentTarget.select()} /></label>)}</div>}
      </div>; })}
      {!chosen.length && <p className="settings-help">Add people in the People tab first.</p>}
    </section>}
  </div>;
}

// ---- Segments ------------------------------------------------------------------------------------------------------------------------------
export function SegmentsTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const month = monthOf(today);
  const defs = segmentDefs(state);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState('');
  const [rename, setRename] = useState('');
  const [sure, setSure] = useState('');
  const [search, setSearch] = useState('');
  const catalog = useMemo(() => fullCatalog(state), [state]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const i of catalog) c[i.segment] = (c[i.segment] || 0) + 1; return c; }, [catalog]);
  // models of scanned phones that are in no segment of the person's list
  const unplaced = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of records) { const item = itemFor(state, r.model); if (item && segmentOf(state, item.code, month, state.recordMeta[r.id]) === 'other' && segmentOf(state, item.code, month) === 'other') seen.set(item.code, item.name); }
    return [...seen.entries()];
  }, [records, state, month]);
  const shown = useMemo(() => { const words = search.toLowerCase().split(/\s+/).filter(Boolean); return catalog.filter(i => !words.length || words.every(w => `${i.name} ${i.abbreviation} ${i.code}`.toLowerCase().includes(w))).slice(0, 40); }, [catalog, search]);

  const add = () => { const r = addSegment(state, name); if (r.error) { setError(r.error); return; } setError(''); setName(''); ctx.change(r.state, 'segment'); if (r.id) setEditing(r.id); };
  const doRename = (id: string) => { const r = renameSegment(state, id, rename); if (r.error) { setError(r.error); return; } setError(''); ctx.change(r.state, ''); setRename(''); };
  const toggle = (code: string, id: Segment, has: boolean) => ctx.change(has ? setModelSegment(state, code, 'other') : assignModels(state, id, [code]), '');

  return <div className="retail-segments">
    <section className="retail-card"><h3>Segments</h3>
      <p className="settings-help">Make your own tabs for Targets (Fold 1, Fold 2…) and tick the models that belong to each.</p>
      <div className="retail-inline"><input aria-label="New segment name" placeholder="New segment, for example Fold 1" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} /><button type="button" className="primary" onClick={add}>+ New segment</button></div>
      {error && <p className="bad" role="alert">{error}</p>}
    </section>
    {defs.map((s, k) => <section key={s.id} className={`retail-card${editing === s.id ? ' tg-edit' : ''}`}>
      <div className="tg-top"><strong>{s.name}</strong><small>{counts[s.id] || 0} model{(counts[s.id] || 0) === 1 ? '' : 's'}</small></div>
      <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={() => { setEditing(editing === s.id ? '' : s.id); setRename(s.name); setSure(''); setSearch(''); }}>{editing === s.id ? 'Close' : 'Edit'}</button>
        <button type="button" className="subtle-btn" aria-label={`Move ${s.name} up`} disabled={k === 0} onClick={() => ctx.change(moveSegment(state, s.id, -1), '')}>↑</button>
        <button type="button" className="subtle-btn" aria-label={`Move ${s.name} down`} disabled={k === defs.length - 1} onClick={() => ctx.change(moveSegment(state, s.id, 1), '')}>↓</button></div>
      {editing === s.id && <div>
        <div className="retail-inline"><label>Name<input value={rename} onChange={e => setRename(e.target.value)} /></label><button type="button" className="subtle-btn" onClick={() => doRename(s.id)}>Rename</button></div>
        <label>Search models<input type="search" value={search} placeholder="Fold, A07, S26…" onChange={e => setSearch(e.target.value)} /></label>
        <ul className="retail-list tg-models">{shown.map(i => { const has = i.segment === s.id; return <li key={i.code}><label><input type="checkbox" checked={has} onChange={() => toggle(i.code, s.id, has)} aria-label={`${i.name} in ${s.name}`} /> {i.name} <small>{i.code}</small></label>
          {!has && i.segment !== 'other' && <span className="rep-chip w">in {segLabel(state, i.segment)}</span>}</li>; })}</ul>
        {sure === s.id ? <div className="share-toolbar"><span className="amber">Delete {s.name}? Its models become “No segment”.</span><button type="button" className="subtle-btn danger" onClick={() => { ctx.change(deleteSegment(state, s.id), 'delete segment'); setEditing(''); setSure(''); }}>Yes, delete</button><button type="button" className="subtle-btn" onClick={() => setSure('')}>No</button></div>
          : <button type="button" className="subtle-btn danger" onClick={() => setSure(s.id)}>Delete segment</button>}
      </div>}
    </section>)}
    <section className="retail-card"><h3>Scanned models with no segment ({unplaced.length})</h3>
      <ul className="retail-list">{unplaced.map(([code, modelName]) => <li key={code}><span>{modelName} <small>{code}</small></span>
        <select aria-label={`Segment of ${modelName}`} value="" onChange={e => e.target.value && ctx.change(setModelSegment(state, code, e.target.value), '')}><option value="">Choose…</option>{defs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></li>)}
        {!unplaced.length && <li className="settings-help">Every scanned model is in a segment.</li>}</ul>
    </section>
  </div>;
}
