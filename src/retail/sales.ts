/**
 * Confirmed sales. The rules that keep sales honest:
 *  - a sale belongs to the person who OWNS the phone when it is confirmed (it cannot be given another person at confirmation);
 *  - a phone nobody owns cannot be sold;
 *  - a phone (record) or IMEI is sold once: a second confirmation is refused until the first is voided;
 *  - moving a sale to another person needs an explicit approval and a reason, and is written to the audit trail;
 *  - a sale can be voided (Undo) with a reason; it then stops counting everywhere, and the phone is back in stock.
 */
import { withAudit } from './data';
import { dateKey, monthOf, type DateKey, type RetailState, type Sale, type Segment } from './types';

export type SaleSource = { id: string; imei: string; model: string; personId: string };
export type SaleDetails = { modelName: string; segment: Segment; ram?: string; storage?: string; color?: string };
export type SaleResult = { ok: true; state: RetailState; sale: Sale } | { ok: false; error: 'no-owner' | 'bad-imei' | 'already-sold' | 'future-date' | 'needs-reason' | 'same-person' | 'not-found' };

let counter = 0;
const newId = () => `sale-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Sales that count: not voided. */
export const liveSales = (state: Pick<RetailState, 'sales'>) => state.sales.filter(sale => !sale.voided);
export const isSold = (state: Pick<RetailState, 'sales'>, recordId: string, imei = '') => state.sales.some(sale => !sale.voided && (sale.recordId === recordId || (!!imei && sale.imei === imei)));

/** Confirms a sale of a record on a date (today by default). `by: 'approved'` is for attributing to the owner at someone's explicit approval only through reattribute. */
export function confirmSale(state: RetailState, record: SaleSource, details: SaleDetails, date: DateKey = dateKey(), now = new Date().toISOString()): SaleResult {
  if (!/^\d{15}$/.test(record.imei)) return { ok: false, error: 'bad-imei' };
  if (!record.personId) return { ok: false, error: 'no-owner' };
  if (date > dateKey(new Date(now))) return { ok: false, error: 'future-date' };
  if (isSold(state, record.id, record.imei)) return { ok: false, error: 'already-sold' };
  const sale: Sale = {
    id: newId(), recordId: record.id, imei: record.imei, model: record.model, modelName: details.modelName, ram: details.ram || '', storage: details.storage || '', color: details.color || '',
    segment: details.segment, personId: record.personId, date, month: monthOf(date), submitted: false, attributedBy: 'owner', createdAt: now
  };
  return { ok: true, sale, state: withAudit({ ...state, sales: [...state.sales, sale] }, 'sale', `${sale.modelName} sold by ${sale.personId} on ${date}`, now) };
}

/** Voids a sale (Undo). The phone is back in stock and the sale stops counting; the line stays in history. */
export function voidSale(state: RetailState, saleId: string, reason: string, now = new Date().toISOString()): SaleResult {
  const sale = state.sales.find(s => s.id === saleId && !s.voided);
  if (!sale) return { ok: false, error: 'not-found' };
  if (!reason.trim()) return { ok: false, error: 'needs-reason' };
  const next: Sale = { ...sale, voided: true, voidedAt: now, reason: reason.trim() };
  return { ok: true, sale: next, state: withAudit({ ...state, sales: state.sales.map(s => s.id === saleId ? next : s) }, 'void', `${sale.modelName} (${sale.personId}): ${reason.trim()}`, now) };
}

/** Attributes a sale to another person. Only with a reason; always on the audit trail. */
export function reattribute(state: RetailState, saleId: string, personId: string, reason: string, now = new Date().toISOString()): SaleResult {
  const sale = state.sales.find(s => s.id === saleId && !s.voided);
  if (!sale) return { ok: false, error: 'not-found' };
  if (!reason.trim()) return { ok: false, error: 'needs-reason' };
  if (!personId || personId === sale.personId) return { ok: false, error: 'same-person' };
  const next: Sale = { ...sale, personId, attributedBy: 'approved', reason: reason.trim() };
  return { ok: true, sale: next, state: withAudit({ ...state, sales: state.sales.map(s => s.id === saleId ? next : s) }, 'reattribute', `${sale.modelName}: ${sale.personId} -> ${personId}: ${reason.trim()}`, now) };
}

/** Marks sales submitted to Samsung (or not). */
export function setSubmitted(state: RetailState, ids: string[], submitted: boolean, now = new Date().toISOString()): RetailState {
  const wanted = new Set(ids);
  return { ...state, sales: state.sales.map(s => wanted.has(s.id) && !s.voided ? { ...s, submitted, submittedAt: submitted ? now : undefined } : s) };
}

export const pendingSubmissions = (state: RetailState, personId?: string) =>
  liveSales(state).filter(s => !s.submitted && (!personId || s.personId === personId)).sort((a, b) => a.date.localeCompare(b.date));

/** Units sold per person in a month. */
export function soldByPerson(state: RetailState, month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sale of liveSales(state)) if (sale.month === month) out[sale.personId] = (out[sale.personId] || 0) + 1;
  return out;
}
