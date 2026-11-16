// RetailLens > Report: paste the store's WhatsApp report, see it checked against the phones that were scanned, tap a line to fix it (model, segment,
// sold, stock, colours), and copy it back out in the same layout. The rules are in src/retail/stockreport.ts and reconcile.ts (unit-tested); this
// file only shows them. Nothing changes by itself: a difference is marked and the person decides.
import { useMemo, useState } from 'react';
import { itemFor, saveItem, segmentOf, setModelSegment } from './retail/catalog';
import { reconcile, searchModels, teachAlias, type LineResult } from './retail/reconcile';
import { canonColour, modelColourNames, teachColour } from './retail/colours';
import { segLabel, segmentIds } from './retail/segments';
import { acknowledgeTotal, buildReport, listedSold, parseReport, partsSum, reportItems, startNewDay, updateItem } from './retail/stockreport';
import { monthOf, type ReportItem, type ReportPart, type RetailState, type Segment } from './retail/types';
import { num, type RetailCtx } from './retail/ui-helpers';

type Draft = { name: string; sold: string; stock: string; parts: ReportPart[]; /** what each colour of the line means (a colour name, or '' = not matched) */ names: string[]; code: string; segment: Segment; remember: boolean; search: string; newCode: string };

const mark = (status: LineResult['status']) => (status === 'agree' ? '✓' : status === 'unknown' ? '?' : status === 'differ' ? '!' : status === 'empty' ? '–' : '•');
const clipboard = (text: string, ctx: RetailCtx) => { void navigator.clipboard?.writeText(text).then(() => ctx.notify('Report copied. Paste it into WhatsApp.'), () => ctx.notify('Could not copy. Use Send instead.')); };

export function ReportTab(ctx: RetailCtx) {
  const { state, records, today } = ctx;
  const report = state.report;
  const [text, setText] = useState(ctx.sharedText || '');
  const [pasting, setPasting] = useState(!report || !!ctx.sharedText);
  const [open, setOpen] = useState<{ id: string; draft: Draft } | null>(null);
  const [only, setOnly] = useState<'all' | 'problems'>('all');
  const rec = useMemo(() => (report ? reconcile(state, report, records) : null), [state, report, records]);
  const byId = useMemo(() => new Map((rec?.lines || []).map(l => [l.id, l])), [rec]);
  const month = monthOf(today);

  const read = () => {
    const parsed = parseReport(text);
    if (!reportItems(parsed).length) { ctx.notify('No model lines found. A line looks like: A07 64GB : 04/15'); return; }
    ctx.change({ ...state, report: parsed }, 'report paste');
    setPasting(false); setText(''); ctx.notify(`${reportItems(parsed).length} lines read.`);
  };
  const pasteFromClipboard = () => { void navigator.clipboard?.readText().then(t => setText(t), () => ctx.notify('Could not paste. Press and hold in the box, then choose Paste.')); };

  const openLine = (item: ReportItem) => {
    const result = byId.get(item.id);
    const code = result?.code || '';
    setOpen({ id: item.id, draft: { name: item.name, sold: String(item.sold), stock: String(item.stock), parts: item.parts.map(p => ({ ...p })), names: item.parts.map((_, k) => result?.partMatch[k] || ''), code, segment: code ? segmentOf(state, code, month) : 'other', remember: true, search: '', newCode: '' } });
  };
  const save = (item: ReportItem) => {
    if (!open || !report) return;
    const d = open.draft;
    let next: RetailState = { ...state, report: updateItem(report, item.id, { name: d.name.trim() || item.name, sold: num(d.sold), stock: num(d.stock), parts: item.kind === 'none' ? undefined : d.parts }) };
    if (d.code) {
      // a colour the person named is remembered for this model (so the next report needs no question)
      if (item.kind === 'colour') d.parts.forEach((p, k) => { const meant = canonColour(d.names[k] || ''); if (p.label && meant && meant !== (openResult?.partMatch[k] || '')) next = teachColour(next, d.code, p.label, meant); });
      if (d.remember) next = teachAlias(next, d.name.trim() || item.name, d.code);
      if (itemFor(next, d.code) && segmentOf(next, d.code, month) !== d.segment) next = setModelSegment(next, d.code, d.segment);
    }
    ctx.change(next, ''); setOpen(null);
  };
  const addModel = (item: ReportItem) => {
    if (!open) return;
    const d = open.draft, code = d.newCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,6}$/.test(code)) { ctx.notify('Type the model code, 3 to 6 letters or digits (for example A176).'); return; }
    const next = saveItem(state, { code, name: d.name.trim() || item.name, abbreviation: d.name.replace(/\b\d{1,2}\s*\/\s*\d{2,4}\s*(gb|tb)?\b|\b\d{1,4}\s*(gb|tb)\b/gi, '').trim() || d.name, segment: d.segment, monthly: {}, variants: [], custom: true });
    ctx.change(teachAlias(next, d.name, code), 'catalog edit');
    setOpen({ id: open.id, draft: { ...d, code } });
    ctx.notify(`${d.name} added to the catalog.`);
  };

  const copy = () => { if (report) clipboard(buildReport(report, { date: new Date() }), ctx); };
  const send = () => { if (report) ctx.share(buildReport(report, { date: new Date() })); };
  const newDay = () => { if (report) { ctx.change({ ...state, report: startNewDay(report) }, 'new day'); ctx.notify('New day: sold is back to 00 and stock stays.'); } };

  const items = report ? reportItems(report) : [];
  const shown = items.filter(i => only === 'all' || ['differ', 'unknown'].includes(byId.get(i.id)?.status || ''));
  const order = (s?: LineResult['status']) => (s === 'unknown' ? 0 : s === 'differ' ? 1 : s === 'info' ? 2 : s === 'empty' ? 4 : 3);
  const sorted = [...shown].sort((a, b) => order(byId.get(a.id)?.status) - order(byId.get(b.id)?.status));
  const sum = rec?.summary;
  const rest = report ? report.entries.filter(e => e.t === 'text' && e.text.trim() && !/^[\s─\-=■♤]{3,}$/.test(e.text)).map(e => (e as { text: string }).text) : [];

  const row = (item: ReportItem) => {
    const r = byId.get(item.id);
    const lines = r?.issues.slice(0, 2) || [];
    return <li key={item.id}><button type="button" className={`rep-row ${r?.status || ''}`} onClick={() => openLine(item)} aria-label={`Edit ${item.name}`}>
      <span className="rep-mark" aria-hidden="true">{mark(r?.status || 'agree')}</span>
      <span className="rep-main"><strong>{item.name}</strong>
        {item.kind !== 'none' && <small>{item.parts.map(p => `${p.label} ${p.count ?? p.raw}`).join(' · ')}</small>}
        {lines.map((i, k) => <small key={k} className="rep-issue">{i.text}</small>)}
        {r && r.status === 'agree' && <small className="rep-ok">{r.matchedName} · scanned {r.scanned.total}</small>}</span>
      <span className="rep-nums">Sold {item.sold}<br />Stock {item.stock}</span></button></li>;
  };

  const d = open?.draft;
  const openItem = open ? items.find(i => i.id === open.id) : undefined;
  const openResult = open ? byId.get(open.id) : undefined;
  const found = d && !d.code ? searchModels(state, d.search || d.name.replace(/\b\d{1,4}\s*(gb|tb)\b|\d{1,2}\s*\/\s*\d{2,4}\s*(gb|tb)?/gi, ''), 6) : [];
  const chosen = d?.code ? itemFor(state, d.code) : undefined;

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
        <p className="rep-chips"><span className="rep-chip ok">{sum.agree} agree</span><span className="rep-chip w">{sum.differ} differ</span><span className="rep-chip q">{sum.unknown} unknown</span>{sum.empty > 0 && <span className="rep-chip">{sum.empty} no stock</span>}{sum.notScanned > 0 && <span className="rep-chip">{sum.notScanned} not scanned yet</span>}</p>
        <div className="share-toolbar"><button type="button" className="primary" onClick={copy}>Copy report</button><button type="button" className="subtle-btn" onClick={send}>Send</button>
          <button type="button" className="subtle-btn" onClick={() => setPasting(true)}>Paste new</button><button type="button" className="subtle-btn" onClick={newDay}>New day</button></div>
        {report.totalSellout && <p className="settings-help">Sellout in the list: {listedSold(report)} · the report says {report.totalSellout.typed}
          {report.totalSellout.acknowledged ? <> · includes {report.totalSellout.extra} phone{report.totalSellout.extra === 1 ? '' : 's'} not in the list</> : sum.totalDiff !== 0 && <> <span className="rep-chip w">{sum.totalDiff! > 0 ? `${sum.totalDiff} more than the list` : `${-sum.totalDiff!} fewer than the list`}</span> <button type="button" className="subtle-btn" onClick={() => ctx.change({ ...state, report: acknowledgeTotal(report) }, '')}>Includes phones not listed</button></>}</p>}
        <div className="filter-chips" role="group" aria-label="Show"><button type="button" className={only === 'all' ? 'active' : ''} onClick={() => setOnly('all')}>All lines <b>{items.length}</b></button><button type="button" className={only === 'problems' ? 'active' : ''} onClick={() => setOnly('problems')}>Only problems <b>{sum.differ + sum.unknown}</b></button></div>
      </section>

      {open && openItem && d && <section className="retail-card rep-sheet" role="dialog" aria-label={`Edit ${openItem.name}`}>
        <h3>{openItem.name} <small>(from your report)</small></h3>
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
          {d.parts.map((p, k) => { const scannedName = openResult?.partMatch[k]; const scanned = openItem.kind === 'colour' && scannedName ? openResult?.scanned.colours.find(c => c.name === scannedName)?.count : undefined;
            return <div key={k} className="rep-colour"><span>{p.label || '—'}{openItem.kind === 'colour' && <input list="rep-colours" className="rep-cname" aria-label={`${p.label} is`} placeholder="colour name" value={d.names[k] ?? ''} onChange={e => setOpen({ id: open.id, draft: { ...d, names: d.names.map((x, i) => i === k ? e.target.value : x) } })} />}{scanned !== undefined && <small> scanned {scanned}</small>}</span>
              <input aria-label={`${p.label} count`} inputMode="numeric" value={p.count ?? p.raw} onChange={e => setOpen({ id: open.id, draft: { ...d, parts: d.parts.map((x, i) => i === k ? { ...x, count: e.target.value.trim() === '' ? 0 : num(e.target.value), raw: e.target.value } : x) } })} /></div>; })}
          {openItem.kind === 'colour' && <p className="rep-ok">Colours add up to {partsSum({ ...openItem, parts: d.parts })}: that is the stock.</p>}
          {openResult?.issues.filter(i => i.kind === 'scanned-colour-missing').map((i, k) => <p key={k} className="amber">{i.text}</p>)}</>}
        <label className="check-row"><input type="checkbox" checked={d.remember} disabled={!d.code} onChange={e => setOpen({ id: open.id, draft: { ...d, remember: e.target.checked } })} /> Remember “{d.name}” for the next reports</label>
        <div className="share-toolbar"><button type="button" className="primary" onClick={() => save(openItem)}>Save line</button><button type="button" className="subtle-btn" onClick={() => setOpen(null)}>Cancel</button></div>
      </section>}

      <ul className="rep-list">{sorted.map(row)}{!sorted.length && <li className="settings-help">{only === 'problems' ? 'No problems: every line agrees.' : 'No model lines.'}</li>}</ul>
      {rest.length > 0 && <details className="retail-card"><summary>Rest of the report (kept as you typed it)</summary><pre className="rep-rest">{rest.join('\n')}</pre></details>}
    </>}
  </div>;
}
