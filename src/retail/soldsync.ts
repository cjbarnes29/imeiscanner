/**
 * A phone marked "Sold" counts by itself: the owner's Sold number for that segment goes up (this month), and the Sold number of the matching report
 * line goes up (the stock already follows the scans, see reportsync.ts). Marking it back to "In stock" takes the same numbers off again. "Given" is not
 * a sale: it only leaves the stock. A ledger remembers which phones were already counted, so nothing is counted twice and nothing is lost; phones
 * that were marked sold before this existed are taken as counted already (the first run only records them).
 */
import { segmentOf } from './catalog';
import { itemFor } from './catalog';
import { variantOf, type StockSource } from './inventory';
import { catalogIndex, matchModel, splitName } from './reconcile';
import { emptyTarget, putTarget } from './targets';
import { monthOf, type DateKey, type RetailState, type SoldEntry } from './types';

const unit = (v: string) => v.replace(/\s+/g, '').toUpperCase();

function bumpTarget(state: RetailState, e: SoldEntry, delta: number): RetailState {
  if (!e.personId || !e.segment || e.segment === 'other') return state;
  const base = state.targets[e.month]?.[e.personId] || emptyTarget(e.personId, e.month, 'manual', new Date().toISOString(), []);
  const exists = base.lines.some(l => l.segment === e.segment);
  const lines = exists ? base.lines.map(l => (l.segment === e.segment ? { ...l, achieved: Math.max(0, l.achieved + delta) } : l)) : delta > 0 ? [...base.lines, { segment: e.segment, target: 0, achieved: delta }] : base.lines;
  return putTarget(state, { ...base, lines });
}

function bumpReport(state: RetailState, e: SoldEntry, delta: number): RetailState {
  const report = state.report;
  if (!report || !e.code) return state;
  const index = catalogIndex(state);
  const match = (name: string) => { const model = matchModel(state, index, name); return model?.code === e.code ? unit(splitName(name).storage) : null; };
  const items = report.entries.filter((x): x is Extract<typeof report.entries[number], { t: 'item' }> => x.t === 'item');
  const target = items.find(i => match(i.name) === e.storage) || items.find(i => match(i.name) === '');
  if (!target) return state;
  return { ...state, report: { ...report, entries: report.entries.map(x => (x.t === 'item' && x.id === target.id ? { ...x, sold: Math.max(0, x.sold + delta) } : x)) } };
}

/** The sales to count now. Returns the same state object when nothing changed (so it can run on every change without looping). */
export function syncSold(state: RetailState, records: StockSource[], today: DateKey): { state: RetailState; added: number; undone: number } {
  const month = monthOf(today);
  const now = new Map<string, SoldEntry>();
  for (const r of records) {
    const meta = state.recordMeta[r.id];
    if (meta?.status !== 'sold') continue;
    now.set(r.id, { personId: r.personId || '', segment: segmentOf(state, r.model, month, meta), month, code: itemFor(state, r.model)?.code || '', storage: unit(variantOf(state, r).storage) });
  }
  if (!state.soldLedger) return { state: { ...state, soldLedger: Object.fromEntries(now) }, added: 0, undone: 0 };
  const ledger = state.soldLedger;
  const present = new Set(records.map(r => r.id));
  const newOnes = [...now.entries()].filter(([id]) => !ledger[id]);
  const gone = Object.entries(ledger).filter(([id]) => !now.has(id));
  if (!newOnes.length && !gone.length) return { state, added: 0, undone: 0 };
  let next = state, added = 0, undone = 0;
  const kept: Record<string, SoldEntry> = { ...ledger };
  for (const [id, e] of newOnes) { next = bumpReport(bumpTarget(next, e, 1), e, 1); kept[id] = e; added++; }
  for (const [id, e] of gone) {
    // taken back into stock: the sale is undone. A phone that was deleted keeps its sale (it happened); it only leaves the ledger.
    if (present.has(id)) { next = bumpReport(bumpTarget(next, e, -1), e, -1); undone++; }
    delete kept[id];
  }
  return { state: { ...next, soldLedger: kept }, added, undone };
}
