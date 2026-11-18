/**
 * Stock. A phone is in stock while it has a valid IMEI, is not a duplicate, and has no live (not voided) sale; confirming a sale therefore lowers
 * the stock by itself, and voiding it brings the phone back. Rows are by model, storage and colour; storage and colour come from the person's own
 * edit of the record, or from the label text when it says them (never invented). Manual adjustments (opening stock, a phone sold outside the app)
 * are kept as separate dated lines so every number can be explained.
 */
import { inferVariant, itemFor, segmentOf } from './catalog';
import { isSold, liveSales } from './sales';
import { dateKey, monthOf, type DateKey, type RetailState, type Segment } from './types';
import { modelCode4 } from '../phone-names';

export type StockSource = { id: string; imei: string; model: string; personId: string; raw?: string; duplicate?: boolean };
export type StockRow = { key: string; code: string; name: string; abbreviation: string; ram: string; storage: string; color: string; segment: Segment; qty: number; fromRecords: number; adjust: number; ids: string[] };

export const validImei = (value: string) => /^\d{15}$/.test(value);

/** Records that count as stock: scanned, valid, not duplicate, not sold, and not marked sold / given by the person. */
export const inStock = (state: RetailState, records: StockSource[]) => records.filter(r => validImei(r.imei) && !r.duplicate && !state.recordMeta[r.id]?.status && !isSold(state, r.id, r.imei));

/** Physical unsold stock includes stored phones; allocation still uses available stock. */
export const realStock = (state: RetailState, records: StockSource[]) => {
  const seen = new Set<string>();
  return records.filter(r => {
    const status = state.recordMeta[r.id]?.status;
    if (!validImei(r.imei) || r.duplicate || (status && status !== 'held') || isSold(state, r.id, r.imei) || seen.has(r.imei)) return false;
    seen.add(r.imei); return true;
  });
};

export function variantOf(state: Pick<RetailState, 'recordMeta'>, record: Pick<StockSource, 'id' | 'raw'>): { storage: string; color: string; ram: string } {
  const meta = state.recordMeta[record.id] || {};
  const read = inferVariant(record.raw || '');
  return { storage: meta.storage || read.storage || '', color: meta.color || read.color || '', ram: meta.ram || read.ram || '' };
}

const keyOf = (code: string, storage: string, color: string) => `${code || '?'}|${storage.toUpperCase()}|${color.toLowerCase()}`;

export function stockRows(state: RetailState, records: StockSource[], date: DateKey = dateKey()): StockRow[] {
  const month = monthOf(date);
  const rows = new Map<string, StockRow>();
  const add = (code: string, name: string, abbreviation: string, segment: Segment, storage: string, color: string, ram = ''): StockRow => {
    const key = keyOf(code, storage, color);
    let row = rows.get(key);
    if (!row) { row = { key, code, name, abbreviation, ram, storage, color, segment, qty: 0, fromRecords: 0, adjust: 0, ids: [] }; rows.set(key, row); }
    return row;
  };
  for (const record of inStock(state, records)) {
    const item = itemFor(state, record.model);
    const code = item?.code || modelCode4(record.model);
    const v = variantOf(state, record);
    const row = add(code, item?.name || record.model || 'Unknown model', item?.abbreviation || record.model || 'Unknown', segmentOf(state, record.model, month, state.recordMeta[record.id]), v.storage, v.color);
    if (!row.ram && v.ram) row.ram = v.ram;
    row.fromRecords++; row.qty++; row.ids.push(record.id);
  }
  for (const adjust of state.stockAdjust) {
    const item = itemFor(state, adjust.code || adjust.name);
    const row = add(item?.code || adjust.code, item?.name || adjust.name, item?.abbreviation || adjust.name, item ? segmentOf(state, item.code, month) : 'other', adjust.storage, adjust.color);
    row.adjust += adjust.delta; row.qty += adjust.delta;
  }
  return [...rows.values()].filter(r => r.qty !== 0 || r.fromRecords > 0).sort((a, b) => a.name.localeCompare(b.name) || a.storage.localeCompare(b.storage) || a.color.localeCompare(b.color));
}

/** Colour split of one model + storage ("Blue 3, Black 2"). */
export function colorQuantities(rows: StockRow[], code: string, storage = ''): { color: string; qty: number }[] {
  return rows.filter(r => r.code === code && (!storage || r.storage === storage) && r.qty > 0).map(r => ({ color: r.color || 'No colour', qty: r.qty }));
}

export type StockAlert = { kind: 'out' | 'low'; name: string; storage: string; color: string; qty: number; why: string };

/** Alerts: a model that sold in the last 14 days and has none left, and any model at or under the low-stock number. */
export function stockAlerts(state: RetailState, rows: StockRow[], today: DateKey = dateKey()): StockAlert[] {
  const since = new Date(today); since.setDate(since.getDate() - 14);
  const recent = new Set(liveSales(state).filter(s => s.date >= dateKey(since)).map(s => keyOf(itemFor(state, s.model)?.code || modelCode4(s.model), s.storage, s.color)));
  const alerts: StockAlert[] = [];
  const keys = new Set(rows.map(r => r.key));
  for (const key of recent) if (!keys.has(key) || rows.find(r => r.key === key)!.qty <= 0) {
    const sale = liveSales(state).find(s => keyOf(itemFor(state, s.model)?.code || modelCode4(s.model), s.storage, s.color) === key)!;
    alerts.push({ kind: 'out', name: sale.modelName, storage: sale.storage, color: sale.color, qty: 0, why: 'Sold in the last 14 days and none left' });
  }
  for (const row of rows) if (row.qty > 0 && row.qty <= state.settings.lowStock) alerts.push({ kind: 'low', name: row.name, storage: row.storage, color: row.color, qty: row.qty, why: `Only ${row.qty} left` });
  return alerts;
}

let n = 0;
/** A dated manual line (opening stock, a phone sold elsewhere). Negative numbers take stock away. */
export function adjustStock(state: RetailState, input: { code: string; name: string; storage?: string; color?: string; delta: number; note: string; date?: DateKey }, now = new Date().toISOString()): RetailState {
  const delta = Math.trunc(input.delta);
  if (!delta) return state;
  return { ...state, stockAdjust: [...state.stockAdjust, { id: `adj-${Date.now().toString(36)}-${(n++).toString(36)}`, at: now, date: input.date || dateKey(new Date(now)), code: input.code, name: input.name, storage: input.storage || '', color: input.color || '', delta, note: input.note.slice(0, 200) }] };
}
