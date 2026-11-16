// RetailLens > Report: paste the store's WhatsApp report, see it checked against the phones that were scanned, tap a line to fix it in a popup (model,
// segment, sold, stock, colours; Previous / Next move along the report), and copy it back out in the same layout. The rules are in
// src/retail/stockreport.ts and reconcile.ts (unit-tested); this file only shows them. Nothing changes by itself: a difference is marked and the
// person decides. Saving a line marks it as checked, so it leaves the "to check" list even when it still differs from the scans.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { itemFor, saveItem, segmentOf, setModelSegment } from './retail/catalog';
import { reconcile, searchModels, teachAlias, type LineResult } from './retail/reconcile';
import { canonColour, modelColourNames, suggestColours, teachColour, teachColourEverywhere } from './retail/colours';
import { COLOUR_DICTIONARY } from './retail/colour-dictionary';
import { reportColourLabels } from './retail/colourlist';
import { segLabel, segmentIds } from './retail/segments';
import { withBaseline } from './retail/reportsync';
import { acknowledgeTotal, buildReport, listedSold, parseReport, partsSum, reportItems, startNewDay, updateItem } from './retail/stockreport';
import { monthOf, type ReportItem, type ReportPart, type RetailState, type Segment } from './retail/types';
import { SheetHandle } from './SheetHandle';
import { useBackLayer } from './back-layer';
import { num, type RetailCtx } from './retail/ui-helpers';

type Draft = { name: string; sold: string; stock: string; parts: ReportPart[]; /** what each colour of the line means (a colour name, or '' = not matched) */ names: string[]; code: string; segment: Segment; remember: boolean; search: string; newCode: string; /** teach a colour for this model only (otherwise for every model) */ onlyModel: boolean };

const mark = (status: LineResult['status']) => (status === 'agree' ? '✓' : status === 'checked' ? '✓' : status === 'unknown' ? '?' : status === 'differ' ? '!' : status === 'empty' ? '–' : '•');
const clipboard = (text: string, ctx: RetailCtx) => { void navigator.clipboard?.writeText(text).then(() => ctx.notify('Report copied. Paste it into WhatsApp.'), () => ctx.notify('Could not copy. Use Send instead.')); };
const needsLook = (status?: LineResult['status']) => status === 'unknown' || status === 'differ' || status === 'info';

/** What to do about each kind of difference, in plain words. */
const HELP: Partial<Record<string, string>> = {
  'unknown-model': 'The model is not in the catalog yet. Search for it below and tap Use, or add it.',
  'stock-differs': 'The report and your scans disagree on the stock. If the report is right, press Save line: the line is marked as checked. If your scans are right, press Match my scans.',
  'not-scanned': 'None of these phones are scanned yet. Scan them, or press Save line to accept the report as it is.',
  'colour-differs': 'A colour count differs from the scanned phones. Fix the numbers below, or press Match my scans.',
  'colour-unmatched': 'A colour could not be matched to a scanned colour. Type what it means in the name box next to it.',
  'scanned-colour-missing': 'You scanned a colour this line does not list. Add it with + Add colour, or ignore it.',
  'colours-sum': 'The colours must add up to the stock. Change a colour number below.',
  unreadable: 'A number could not be read. Type the right number below.',
  'parts-mismatch': 'The numbers and the names under them do not line up. Fix them below.'
};

export function ReportTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const report = state.report;
  const [text, setText] = useState(ctx.sharedText || '');
  const [pasting, setPasting] = useState(!report || !!ctx.sharedText);
  const [open, setOpen] = useState<{ id: string; draft: Draft } | null>(null);
  useBackLayer(!!open, () => setOpen(null), 'report-line');
  const [only, setOnly] = useState<'all' | 'problems'>('all');
  const [allNames, setAllNames] = useState(false);
  const rec = useMemo(() => (report ? reconcile(state, report, records) : null), [state, report, records]);
  const labels = useMemo(() => (report ? reportColourLabels(state, report, records) : []), [state, report, records]);
  const byId = useMemo(() => new Map((rec?.lines || []).map(l => [l.id, l])), [rec]);
  const month = monthOf(today);

  const read = () => {
    const parsed = parseReport(text);
    if (!reportItems(parsed).length) { ctx.notify('No model lines found. A line looks like: A07 64GB : 04/15'); return; }
    // the phones scanned so far are taken as already in this report; the ones scanned from now on are added by themselves
    ctx.change({ ...state, report: withBaseline(state, parsed, records) }, 'report paste');
    setPasting(false); setText(''); ctx.notify(`${reportItems(parsed).length} lines read.`);
  };
  const pasteFromClipboard = () => { void navigator.clipboard?.readText().then(t => setText(t), () => ctx.notify('Could not paste. Press and hold in the box, then choose Paste.')); };

  const items = report ? reportItems(report) : [];
  const openLine = (item: ReportItem, from: RetailState = state) => {
    const result = byId.get(item.id);
    const code = result?.code || '';
    setOpen({ id: item.id, draft: { name: item.name, sold: String(item.sold), stock: String(item.stock), parts: item.parts.map(p => ({ ...p })), names: item.parts.map((_, k) => result?.partMatch[k] || ''), code, segment: code ? segmentOf(from, code, month) : 'other', remember: true, search: '', newCode: '', onlyModel: false } });
  };

  const d = open?.draft;
  const openItem = open ? items.find(i => i.id === open.id) : undefined;
  const openResult = open ? byId.get(open.id) : undefined;
  const at = openItem ? items.findIndex(i => i.id === openItem.id) : -1;
  const prevItem = at > 0 ? items[at - 1] : undefined;
  const nextItem = at >= 0 && at < items.length - 1 ? items[at + 1] : undefined;
  const nextProblem = at >= 0 ? items.slice(at + 1).find(i => needsLook(byId.get(i.id)?.status)) : undefined;

  /** The state with this line's edits in it. `check` = the person looked at it and says it is settled. */
  const commit = (item: ReportItem, check: boolean): RetailState => {
    if (!d || !report) return state;
    let next: RetailState = { ...state, report: updateItem(report, item.id, { name: d.name.trim() || item.name, sold: num(d.sold), stock: num(d.stock), parts: item.kind === 'none' ? undefined : d.parts, ...(check ? { checked: true } : {}) }) };
    if (d.code) {
      // a colour the person named is remembered for this model (so the next report needs no question)
      if (item.kind === 'colour') d.parts.forEach((p, k) => { const meant = canonColour(d.names[k] || ''); if (p.label && meant && meant !== (openResult?.partMatch[k] || '')) next = d.onlyModel ? teachColour(next, d.code, p.label, meant) : teachColourEverywhere(next, p.label, meant, d.code); });
      if (d.remember) next = teachAlias(next, d.name.trim() || item.name, d.code);
      if (itemFor(next, d.code) && segmentOf(next, d.code, month) !== d.segment) next = setModelSegment(next, d.code, d.segment);
    }
    ctx.change(next, '');
    return next;
  };
  const save = (item: ReportItem) => { commit(item, true); setOpen(null); ctx.notify(`${d?.name.trim() || item.name} saved and checked.`); };
  const saveNext = (item: ReportItem) => { const next = commit(item, true); if (nextProblem) openLine(nextProblem, next); else { setOpen(null); ctx.notify('No more lines to check.'); } };
  const go = (item: ReportItem, to?: ReportItem) => { if (!to) return; const next = commit(item, false); openLine(to, next); };
  const addModel = (item: ReportItem) => {
    if (!open || !d) return;
    const code = d.newCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,6}$/.test(code)) { ctx.notify('Type the model code, 3 to 6 letters or digits (for example A176).'); return; }
    const next = saveItem(state, { code, name: d.name.trim() || item.name, abbreviation: d.name.replace(/\b\d{1,2}\s*\/\s*\d{2,4}\s*(gb|tb)?\b|\b\d{1,4}\s*(gb|tb)\b/gi, '').trim() || d.name, segment: d.segment, monthly: {}, variants: [], custom: true });
    ctx.change(teachAlias(next, d.name, code), 'catalog edit');
    setOpen({ id: open.id, draft: { ...d, code } });
    ctx.notify(`${d.name} added to the catalog.`);
  };
  /** Set the colour counts (or the stock) to what was scanned. Only the person's press does this. */
  const matchScans = () => {
    if (!open || !d || !openResult || !openItem) return;
    if (openItem.kind === 'none') { setOpen({ id: open.id, draft: { ...d, stock: String(openResult.scanned.total) } }); return; }
    const parts = d.parts.map((p, k) => {
      const wanted = canonColour(d.names[k] || openResult.partMatch[k] || '');
      const count = wanted ? openResult.scanned.colours.find(c => c.name === wanted)?.count || 0 : 0;
      return { ...p, count, raw: String(count).padStart(2, '0') };
    });
    setOpen({ id: open.id, draft: { ...d, parts } });
  };
  const setPart = (k: number, patch: Partial<ReportPart>) => { if (open && d) setOpen({ id: open.id, draft: { ...d, parts: d.parts.map((x, i) => i === k ? { ...x, ...patch } : x) } }); };

  /** A colour name given once for a short form: every line that uses it is filled in, for every model. */
  const nameLabel = (label: string, value: string) => {
    const name = canonColour(value);
    if (!name) return;
    ctx.change(teachColourEverywhere(state, label, name), '');
    ctx.notify(`${label} is ${name} on every line.`);
  };
  const copy = () => { if (report) clipboard(buildReport(report, { date: new Date() }), ctx); };
  const send = () => { if (report) ctx.share(buildReport(report, { date: new Date() })); };
  const newDay = () => { if (report) { ctx.change({ ...state, report: startNewDay(report) }, 'new day'); ctx.notify('New day: sold is back to 00 and stock stays.'); } };

  const shown = items.filter(i => only === 'all' || ['differ', 'unknown'].includes(byId.get(i.id)?.status || ''));
  const order = (s?: LineResult['status']) => (s === 'unknown' ? 0 : s === 'differ' ? 1 : s === 'info' ? 2 : s === 'empty' ? 5 : s === 'checked' ? 4 : 3);
  const sorted = [...shown].sort((a, b) => order(byId.get(a.id)?.status) - order(byId.get(b.id)?.status));
  const sum = rec?.summary;
  const rest = report ? report.entries.filter(e => e.t === 'text' && e.text.trim() && !/^[\s─\-=■♤]{3,}$/.test(e.text)).map(e => (e as { text: string }).text) : [];

  const row = (item: ReportItem) => {
    const r = byId.get(item.id);
    const lines = r?.issues.slice(0, 2) || [];
    return <li key={item.id}><button type="button" className={`rep-row ${r?.status === 'empty' ? 'st-empty' : r?.status || ''}`} onClick={() => openLine(item)} aria-label={`Edit ${item.name}`}>
      <span className="rep-mark" aria-hidden="true">{mark(r?.status || 'agree')}</span>
      <span className="rep-main"><strong>{item.name}</strong>
        {item.kind !== 'none' && <small>{item.parts.map(p => `${p.label} ${p.count ?? p.raw}`).join(' · ')}</small>}
        {r?.status === 'checked' ? <small className="rep-checked">You checked this line{lines[0] ? ` (${lines[0].text.replace(/\.$/, '')})` : ''}</small> : lines.map((i, k) => <small key={k} className="rep-issue">{i.text}</small>)}
        {r && r.status === 'agree' && <small className="rep-ok">{r.matchedName} · scanned {r.scanned.total}</small>}
        {item.auto ? <small className="rep-auto">Added from your scans</small> : item.scanAdded ? <small className="rep-auto">{item.scanAdded > 0 ? '+' : ''}{item.scanAdded} from scans since you pasted</small> : null}</span>
      <span className="rep-nums">Sold {item.sold}<br />Stock {item.stock}</span></button></li>;
  };

  const popupNames = d?.code ? modelColourNames(state, d.code, openResult?.scanned.colours.map(c => c.name).filter(n => n !== 'No colour') || []) : [];
  const found = d && !d.code ? searchModels(state, d.search || d.name.replace(/\b\d{1,4}\s*(gb|tb)\b|\d{1,2}\s*\/\s*\d{2,4}\s*(gb|tb)?/gi, ''), 6) : [];
  const chosen = d?.code ? itemFor(state, d.code) : undefined;
  const helpKinds = openResult ? [...new Set(openResult.issues.map(i => i.kind))].filter(k => HELP[k]).slice(0, 3) : [];
  const noColour = openResult?.scanned.colours.find(c => c.name === 'No colour')?.count || 0;
  const canMatch = !!openResult && openResult.scanned.total > 0 && !!openItem && openItem.kind !== 'storage';

  return <div className="retail-report">
    {(pasting || !report) && <section className="retail-card"><h3>Paste your report</h3>
      <p className="settings-help">Paste the WhatsApp report. Each model is two lines, like <em>A07 64GB : 04/15</em> (sold / stock) and <em>(02,00,13) Vlt,Grn,Blk</em> (stock per colour). Everything is read on this phone.</p>
      <textarea aria-label="The report" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the report here" />
      <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={pasteFromClipboard}>Paste</button><button type="button" className="primary" disabled={!text.trim()} onClick={read}>Read the report</button>
        {report && <button type="button" className="subtle-btn" onClick={() => { setPasting(false); setText(''); }}>Cancel</button>}</div>
    </section>}

    {report && sum && <>
      <section className="retail-card"><h3>Report vs scanned phones</h3>
        <p className="settings-help">Scanned in the app (in stock): {sum.scannedPhones} · report stock: {sum.reportStock}</p>
        <p className="rep-chips"><span className="rep-chip ok">{sum.agree} agree</span><span className="rep-chip w">{sum.differ} differ</span><span className="rep-chip q">{sum.unknown} unknown</span>{sum.checked > 0 && <span className="rep-chip ok">{sum.checked} checked by you</span>}{sum.empty > 0 && <span className="rep-chip">{sum.empty} no stock</span>}{sum.notScanned > 0 && <span className="rep-chip">{sum.notScanned} not scanned yet</span>}</p>
        <div className="share-toolbar"><button type="button" className="primary" onClick={copy}>Copy report</button><button type="button" className="subtle-btn" onClick={send}>Send</button>
          <button type="button" className="subtle-btn" onClick={() => setPasting(true)}>Paste new</button><button type="button" className="subtle-btn" onClick={newDay}>New day</button></div>
        {report.totalSellout && <p className="settings-help">Sellout in the list: {listedSold(report)} · the report says {report.totalSellout.typed}
          {report.totalSellout.acknowledged ? <> · includes {report.totalSellout.extra} phone{report.totalSellout.extra === 1 ? '' : 's'} not in the list</> : sum.totalDiff !== 0 && <> <span className="rep-chip w">{sum.totalDiff! > 0 ? `${sum.totalDiff} more than the list` : `${-sum.totalDiff!} fewer than the list`}</span> <button type="button" className="subtle-btn" onClick={() => ctx.change({ ...state, report: acknowledgeTotal(report) }, '')}>Includes phones not listed</button></>}</p>}
        <div className="filter-chips" role="group" aria-label="Show"><button type="button" className={only === 'all' ? 'active' : ''} onClick={() => setOnly('all')}>All lines <b>{items.length}</b></button><button type="button" className={only === 'problems' ? 'active' : ''} onClick={() => setOnly('problems')}>Only problems <b>{sum.differ + sum.unknown}</b></button></div>
      </section>

      {labels.length > 0 && <details className="retail-card rep-colours-card" open={labels.some(l => !l.resolved)}>
        <summary><strong>Colour names</strong> {labels.some(l => !l.resolved) ? <span className="rep-chip w">{labels.filter(l => !l.resolved).length} to name</span> : <span className="rep-chip ok">all named</span>}</summary>
        <p className="settings-help">One row for each short form in the report (CRM, GRPH…). Name it once and every line that uses it is filled in, for every model. Tap a name or type one.</p>
        <datalist id="rep-all-colours">{COLOUR_DICTIONARY.map(c => <option key={c.name} value={c.name} />)}</datalist>
        <ul className="retail-list">{labels.filter(l => allNames || !l.resolved).map(l => <li key={l.key} className="rep-lab">
          <div className="rep-lab-top"><strong>{l.label}</strong><small>{l.lines} line{l.lines === 1 ? '' : 's'}</small>{l.resolved && <small className="rep-ok">= {l.resolved.name}{l.mixed ? ' (differs by model)' : ''} · {l.resolved.source === 'dictionary' ? 'built in' : l.resolved.source === 'fit' ? 'from scanned phones' : 'you'}</small>}</div>
          {l.suggestions.length > 0 && <div className="rep-sugg">{l.suggestions.map(n => <button key={n} type="button" className="chip-btn" onClick={() => nameLabel(l.label, n)}>{n}</button>)}</div>}
          <input list="rep-all-colours" aria-label={`Colour for ${l.label}`} placeholder="or type a colour" defaultValue="" onKeyDown={e => { if (e.key === 'Enter') { nameLabel(l.label, e.currentTarget.value); e.currentTarget.value = ''; } }} onBlur={e => { if (e.currentTarget.value.trim()) { nameLabel(l.label, e.currentTarget.value); e.currentTarget.value = ''; } }} />
        </li>)}
          {!labels.some(l => !l.resolved) && !allNames && <li className="settings-help">Every short form has a colour name.</li>}</ul>
        {labels.some(l => l.resolved) && <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={() => setAllNames(v => !v)}>{allNames ? 'Show only the unnamed' : `Show all ${labels.length}`}</button></div>}
      </details>}
      <ul className="rep-list">{sorted.map(row)}{!sorted.length && <li className="settings-help">{only === 'problems' ? 'No problems: every line agrees or was checked by you.' : 'No model lines.'}</li>}</ul>
      {rest.length > 0 && <details className="retail-card"><summary>Rest of the report (kept as you typed it)</summary><pre className="rep-rest">{rest.join('\n')}</pre></details>}

      {open && openItem && d && createPortal(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setOpen(null); }}><section className="modal retail-card rep-sheet rep-modal" role="dialog" aria-modal="true" aria-label={`Edit ${openItem.name}`}>
        <SheetHandle onClose={() => setOpen(null)} />
        <div className="rep-nav">
          <button type="button" className="subtle-btn" disabled={!prevItem} aria-label="Previous line" onClick={() => go(openItem, prevItem)}>‹ Previous</button>
          <span className="rep-pos">{at + 1} of {items.length}</span>
          <button type="button" className="subtle-btn" disabled={!nextItem} aria-label="Next line" onClick={() => go(openItem, nextItem)}>Next ›</button>
          <button type="button" className="iconbtn" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
        </div>
        <h3>{openItem.name} <small>(from your report)</small></h3>
        {helpKinds.length > 0 && <div className="rep-help" role="note"><strong>How to fix this line</strong>{helpKinds.map(k => <p key={k}>{HELP[k]}</p>)}</div>}
        {openResult?.status === 'checked' && <p className="rep-ok">You already checked this line.</p>}
        <label>Name in the report<input value={d.name} onChange={e => setOpen({ id: open.id, draft: { ...d, name: e.target.value } })} /></label>
        {chosen ? <p className="settings-help">Matches <strong>{chosen.name}</strong> ({chosen.code}). <button type="button" className="subtle-btn" onClick={() => setOpen({ id: open.id, draft: { ...d, code: '' } })}>Change</button></p> : <div>
          <label>Search the Samsung catalog<input type="search" value={d.search} placeholder="For example A27 5G" onChange={e => setOpen({ id: open.id, draft: { ...d, search: e.target.value } })} /></label>
          <ul className="retail-list">{found.map(i => <li key={i.code}><span><strong>{i.name}</strong> <small>{i.code}</small></span><button type="button" className="subtle-btn" onClick={() => setOpen({ id: open.id, draft: { ...d, code: i.code, segment: segmentOf(state, i.code, month) } })}>Use</button></li>)}
            {!found.length && <li className="settings-help">No model found. Add it below.</li>}</ul>
          <div className="retail-inline"><input aria-label="Model code" placeholder="Model code (A176)" value={d.newCode} onChange={e => setOpen({ id: open.id, draft: { ...d, newCode: e.target.value } })} /><button type="button" className="subtle-btn" onClick={() => addModel(openItem)}>Add as new model</button></div>
        </div>}
        <label>Segment<select value={d.segment} onChange={e => setOpen({ id: open.id, draft: { ...d, segment: e.target.value } })} disabled={!d.code}>{[...segmentIds(state), 'other'].map(s => <option key={s} value={s}>{segLabel(state, s)}</option>)}</select></label>
        <div className="retail-inline"><label>Sold<input inputMode="numeric" value={d.sold} onChange={e => setOpen({ id: open.id, draft: { ...d, sold: e.target.value } })} /></label>
          <label>Stock<input inputMode="numeric" value={openItem.kind === 'colour' ? String(partsSum({ ...openItem, parts: d.parts })) : d.stock} disabled={openItem.kind === 'colour'} onChange={e => setOpen({ id: open.id, draft: { ...d, stock: e.target.value } })} /></label></div>
        {openItem.kind !== 'none' && <><h4>{openItem.kind === 'storage' ? 'Storage counts' : 'Colours'}</h4>
          {openItem.kind === 'colour' && <datalist id="rep-colours">{(d.code ? modelColourNames(state, d.code, openResult?.scanned.colours.map(c => c.name).filter(n => n !== 'No colour') || []) : []).map(n => <option key={n} value={n} />)}</datalist>}
          {openItem.kind === 'colour' && <p className="rep-cols-head"><span>Report label</span><span>Colour name</span><span>Count</span></p>}
          {d.parts.map((p, k) => { const scannedName = openResult?.partMatch[k]; const scanned = openItem.kind === 'colour' && scannedName ? openResult?.scanned.colours.find(c => c.name === scannedName)?.count : undefined;
            return <div key={k} className={'rep-colour' + (openItem.kind === 'storage' ? ' two' : '')}>
              <input className="rep-clabel" aria-label={`Label ${k + 1}`} placeholder="label" value={p.label} onChange={e => setPart(k, { label: e.target.value })} />
              {openItem.kind === 'colour' && <input list="rep-colours" className="rep-cname" aria-label={`${p.label} is`} placeholder="colour name" value={d.names[k] ?? ''} onChange={e => setOpen({ id: open.id, draft: { ...d, names: d.names.map((x, i) => i === k ? e.target.value : x) } })} />}
              <input className="rep-ccount" aria-label={`${p.label} count`} inputMode="numeric" value={p.count ?? p.raw} onChange={e => setPart(k, { count: e.target.value.trim() === '' ? 0 : num(e.target.value), raw: e.target.value })} />
              <button type="button" className="iconbtn" aria-label={`Remove ${p.label || 'this colour'}`} onClick={() => setOpen({ id: open.id, draft: { ...d, parts: d.parts.filter((_, i) => i !== k), names: d.names.filter((_, i) => i !== k) } })}>✕</button>
              {openItem.kind === 'colour' && p.label && <div className="rep-sugg">{suggestColours(p.label, popupNames).filter(n => n !== canonColour(d.names[k] || '')).map(n => <button key={n} type="button" className="chip-btn" onClick={() => setOpen({ id: open.id, draft: { ...d, names: d.names.map((x, i) => i === k ? n : x) } })}>{n}</button>)}</div>}
              {scanned !== undefined && <small className="rep-cscan">scanned {scanned}</small>}</div>; })}
          <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={() => setOpen({ id: open.id, draft: { ...d, parts: [...d.parts, { label: '', count: 0, raw: '00' }], names: [...d.names, ''] } })}>+ Add {openItem.kind === 'storage' ? 'storage' : 'colour'}</button></div>
          {openItem.kind === 'colour' && <p className="rep-ok">Colours add up to {partsSum({ ...openItem, parts: d.parts })}: that is the stock.</p>}
          {openResult?.issues.filter(i => i.kind === 'scanned-colour-missing').map((i, k) => <p key={k} className="amber">{i.text}</p>)}</>}
        {canMatch && <div className="rep-match"><button type="button" className="subtle-btn" onClick={matchScans}>Match my scans ({openResult!.scanned.total})</button>
          <small>Sets {openItem.kind === 'none' ? 'the stock' : 'the colour counts'} to what you scanned. You can still change it before saving.{noColour > 0 ? ` ${noColour} scanned phone${noColour === 1 ? ' has' : 's have'} no colour: set it in Phones.` : ''}</small></div>}
        {openItem.kind === 'colour' && <label className="check-row"><input type="checkbox" checked={d.onlyModel} disabled={!d.code} onChange={e => setOpen({ id: open.id, draft: { ...d, onlyModel: e.target.checked } })} /> Colour names only for this model (otherwise every model)</label>}
        <label className="check-row"><input type="checkbox" checked={d.remember} disabled={!d.code} onChange={e => setOpen({ id: open.id, draft: { ...d, remember: e.target.checked } })} /> Remember “{d.name}” for the next reports</label>
        <div className="share-toolbar rep-actions"><button type="button" className="primary" onClick={() => save(openItem)}>Save line</button>{nextProblem && <button type="button" className="subtle-btn" onClick={() => saveNext(openItem)}>Save and next</button>}<button type="button" className="subtle-btn" onClick={() => setOpen(null)}>Cancel</button></div>
      </section></div>, document.body)}
    </>}
  </div>;
}
