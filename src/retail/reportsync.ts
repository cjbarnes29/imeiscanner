/**
 * Scanned phones go into the report by themselves. When the report is pasted, the phones already scanned are taken as part of it (the report was
 * written with them in mind): that is the baseline. From then on every phone that is scanned (or taken out of stock, or deleted) changes the matching
 * line: its colour count and its stock follow, a colour the line does not have yet gets its own entry, and a model the report does not list gets a
 * new line. Sold numbers are never touched. Every change is marked on the line ("+N from scans"), so the person can see and correct it.
 */
import { itemFor } from './catalog';
import { canonColour, resolveColour } from './colours';
import { realStock, variantOf, type StockSource } from './inventory';
import { catalogIndex, matchModel, splitName } from './reconcile';
import type { ReportItem, ReportPart, RetailState, StockReport } from './types';

const unit = (v: string) => v.replace(/\s+/g, '').toUpperCase();
const NO_COLOUR = 'No colour';
const pad = (n: number, w: number) => String(Math.max(0, n)).padStart(w, '0');
const widthOf = (raw: string) => Math.min(4, Math.max(2, (raw.replace(/\D/g, '') || '00').length));

/** model | storage | colour -> how many scanned phones are in stock. */
export function scanCounts(state: RetailState, records: StockSource[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const source of realStock(state, records)) {
    const item = itemFor(state, source.model);
    if (!item) continue;
    const v = variantOf(state, source);
    const key = `${item.code}|${unit(v.storage)}|${canonColour(v.color) || NO_COLOUR}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/** model | storage | colour -> how many phones exist at all (in stock or not): tells a phone that left the stock from one that was deleted. */
function existCounts(state: RetailState, records: StockSource[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const source of records) {
    const item = itemFor(state, source.model);
    if (!item) continue;
    const v = variantOf(state, source);
    const key = `${item.code}|${unit(v.storage)}|${canonColour(v.color) || NO_COLOUR}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/** The report with the phones scanned so far taken as already in it (used right after pasting). */
export const withBaseline = (state: RetailState, report: StockReport, records: StockSource[]): StockReport => ({ ...report, releaseRevision: crypto.randomUUID(), scanBase: scanCounts(state, records) });

const sameCounts = (a: Record<string, number>, b: Record<string, number>) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };

type Work = { item: ReportItem; touched: boolean };

function change(state: RetailState, work: Work, code: string, storage: string, colour: string, delta: number) {
  const item = work.item;
  let parts = item.parts.map(p => ({ ...p }));
  let stock = item.stock;
  if (item.kind === 'storage') {
    const k = parts.findIndex(p => unit(p.label) === storage);
    if (k >= 0) { const count = Math.max(0, (parts[k].count ?? 0) + delta); parts[k] = { ...parts[k], count, raw: pad(count, widthOf(parts[k].raw)) }; }
    else if (delta > 0) parts.push({ label: storage || NO_COLOUR, count: delta, raw: pad(delta, 2) });
    stock = Math.max(0, stock + delta);
  } else if (item.kind === 'colour') {
    let k = parts.findIndex(p => p.label && (colour === NO_COLOUR ? p.label.toLowerCase() === NO_COLOUR.toLowerCase() : resolveColour(state, code, p.label, [colour]) === colour));
    if (k < 0 && delta > 0) { parts.push({ label: colour, count: 0, raw: '00' }); k = parts.length - 1; }
    if (k >= 0) { const count = Math.max(0, (parts[k].count ?? 0) + delta); parts[k] = { ...parts[k], count, raw: pad(count, widthOf(parts[k].raw)) }; }
    stock = parts.reduce((sum, p) => sum + (p.count ?? 0), 0);
  } else stock = Math.max(0, stock + delta);
  work.item = { ...item, parts, stock, scanAdded: (item.scanAdded || 0) + delta };
  work.touched = true;
}

let n = 0;
function newLine(state: RetailState, code: string, storage: string, colours: Map<string, number>): ReportItem {
  const model = itemFor(state, code);
  const name = [model?.abbreviation || model?.name || code, storage].filter(Boolean).join(' ');
  const coloured = [...colours.keys()].some(c => c !== NO_COLOUR);
  const parts: ReportPart[] = coloured ? [...colours.entries()].map(([label, count]) => ({ label, count, raw: pad(count, 2) })) : [];
  const stock = [...colours.values()].reduce((a, b) => a + b, 0);
  const line1 = `${name} : 00/${pad(stock, 2)}`;
  return {
    t: 'item', id: `s${Date.now().toString(36)}${n++}`, name, sold: 0, stock, soldWidth: 2, stockWidth: 2, kind: coloured ? 'colour' : 'none', parts, sep: ' ', line1,
    line2: coloured ? `(${parts.map(p => p.raw).join(',')}) ${parts.map(p => p.label).join(',')}` : '', auto: true, scanAdded: stock
  };
}

/**
 * Brings the report in line with the phones scanned since the baseline. Returns the same report object when nothing changed (so it can run on every
 * change of the records without looping). `added` = phones added to lines, `created` = new lines made.
 */
export function syncScans(state: RetailState, report: StockReport, records: StockSource[]): { report: StockReport; added: number; removed: number; created: number } {
  const cur = scanCounts(state, records);
  if (!report.scanBase) return { report: { ...report, scanBase: cur }, added: 0, removed: 0, created: 0 };
  const base = report.scanBase;
  const keys = [...new Set([...Object.keys(cur), ...Object.keys(base)])];
  const deltas = keys.map(key => ({ key, delta: (cur[key] || 0) - (base[key] || 0) })).filter(d => d.delta !== 0);
  if (!deltas.length) return { report, added: 0, removed: 0, created: 0 };

  const index = catalogIndex(state);
  const works = new Map<string, Work>();
  for (const e of report.entries) if (e.t === 'item') works.set(e.id, { item: e, touched: false });
  const info = [...works.values()].map(w => { const model = matchModel(state, index, w.item.name); return { work: w, code: model?.code || '', storage: unit(splitName(w.item.name).storage) }; });
  let added = 0, removed = 0;
  const fresh = new Map<string, Map<string, number>>();
  /** phones that left the stock but have no line in the report: the baseline keeps them, so when they come back they are not "new scans" */
  const unabsorbed = new Set<string>();
  for (const { key, delta } of deltas) {
    const [code, storage, colour] = key.split('|');
    const home = info.find(i => i.code === code && i.storage === storage) || info.find(i => i.code === code && !i.storage && (i.work.item.kind === 'storage' || !storage));
    if (home) { change(state, home.work, code, storage, colour, delta); if (delta > 0) added += delta; else removed -= delta; }
    else if (delta < 0) unabsorbed.add(key);
    else if (delta > 0) { const k = `${code}|${storage}`; const m = fresh.get(k) || new Map<string, number>(); m.set(colour, (m.get(colour) || 0) + delta); fresh.set(k, m); }
  }
  const nextBase: Record<string, number> = { ...cur };
  // a phone that only left the stock (sold, held) keeps its baseline, so it is not a "new scan" when it comes back; a deleted one is forgotten
  if (unabsorbed.size) { const exist = existCounts(state, records); for (const key of unabsorbed) if ((exist[key] || 0) >= base[key]) nextBase[key] = base[key]; }
  if (!added && !removed && !fresh.size && sameCounts(nextBase, base)) return { report, added: 0, removed: 0, created: 0 };
  let entries = report.entries.map(e => (e.t === 'item' ? works.get(e.id)!.item : e));
  let created = 0;
  if (fresh.size) {
    const lastItem = entries.map(e => e.t).lastIndexOf('item');
    const lines = [...fresh.entries()].map(([k, colours]) => { const [code, storage] = k.split('|'); created++; added += [...colours.values()].reduce((a, b) => a + b, 0); return newLine(state, code, storage, colours); });
    entries = [...entries.slice(0, lastItem + 1), ...lines, ...entries.slice(lastItem + 1)];
  }
  return { report: { ...report, entries, scanBase: nextBase }, added, removed, created };
}
