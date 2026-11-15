/**
 * The Today dashboard: what to sell first (from my own target), sales still to submit, stock alerts and the day's checklist. Computed from the
 * state, never stored, so it cannot go out of date; only the checklist ticks and custom items are kept (in the day log).
 */
import { inStock, stockAlerts, stockRows, type StockAlert, type StockSource } from './inventory';
import { liveSales, pendingSubmissions } from './sales';
import { segmentOf } from './catalog';
import { summarizeTarget, type TargetSummary } from './targets';
import { SEGMENT_LABEL, monthOf, type DateKey, type RetailState, type Sale, type Segment } from './types';

export type Priority = { segment: Segment; label: string; remaining: number; perDay: number; holding: number; shortBy: number; message: string };
export type ChecklistItem = { id: string; text: string; done: boolean; auto: boolean };
export type Dashboard = {
  date: DateKey; month: string; summary?: TargetSummary; priorities: Priority[];
  pending: { count: number; oldestDays: number; sales: Sale[] };
  alerts: StockAlert[]; checklist: ChecklistItem[]; soldToday: number;
};

const daysBetween = (from: DateKey, to: DateKey) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));

export function pendingBySegment(state: RetailState, personId: string): Partial<Record<Segment, number>> {
  const out: Partial<Record<Segment, number>> = {};
  for (const sale of pendingSubmissions(state, personId)) out[sale.segment] = (out[sale.segment] || 0) + 1;
  return out;
}

/** Units submitted to Samsung after the target's screenshot was imported (same month): the screenshot cannot include them. */
export function submittedSince(state: RetailState, personId: string, target?: { month: string; importedAt: string }): Partial<Record<Segment, number>> {
  const out: Partial<Record<Segment, number>> = {};
  if (!target) return out;
  for (const sale of liveSales(state)) if (sale.personId === personId && sale.submitted && sale.month === target.month && (sale.submittedAt || '') > target.importedAt) out[sale.segment] = (out[sale.segment] || 0) + 1;
  return out;
}

export function todayDashboard(state: RetailState, records: StockSource[], date: DateKey, counts: { scanning: number; needsReview: number } = { scanning: 0, needsReview: 0 }): Dashboard {
  const month = monthOf(date), me = state.settings.myPersonId;
  const target = me ? state.targets[month]?.[me] : undefined;
  const summary = target ? summarizeTarget(target, pendingBySegment(state, me), date, state.rates, submittedSince(state, me, target)) : undefined;
  const mine = inStock(state, records).filter(r => r.personId === me);
  const priorities: Priority[] = (summary?.lines || []).map(line => {
    const at = line.at[state.settings.myThreshold];
    const holding = mine.filter(r => segmentOf(state, r.model, month, state.recordMeta[r.id]) === line.segment).length;
    const shortBy = Math.max(0, at.remaining - holding);
    const message = at.remaining <= 0 ? `${SEGMENT_LABEL[line.segment]}: ${state.settings.myThreshold}% reached` :
      `Sell ${at.perDay}/day of ${SEGMENT_LABEL[line.segment]}: ${at.remaining} more for ${state.settings.myThreshold}%${shortBy ? ` (you hold ${holding}, ${shortBy} short)` : ''}`;
    return { segment: line.segment, label: SEGMENT_LABEL[line.segment], remaining: at.remaining, perDay: at.perDay, holding, shortBy, message };
  }).filter(p => p.remaining > 0).sort((a, b) => b.perDay - a.perDay || b.remaining - a.remaining);
  const waiting = pendingSubmissions(state, me || undefined);
  const alerts = stockAlerts(state, stockRows(state, records, date), date);
  const day = state.days[date];
  const done = (id: string) => day?.checklist[id] === true;
  const checklist: ChecklistItem[] = [
    { id: 'scan', text: counts.scanning ? `Scan the ${counts.scanning} shared photo${counts.scanning === 1 ? '' : 's'} waiting` : "Scan today's shared photos", done: done('scan'), auto: false },
    { id: 'review', text: counts.needsReview ? `Review ${counts.needsReview} record${counts.needsReview === 1 ? '' : 's'} that need a look` : 'Records reviewed', done: counts.needsReview === 0, auto: true },
    { id: 'submit', text: waiting.length ? `Submit ${waiting.length} sale${waiting.length === 1 ? '' : 's'} to Samsung` : 'All sales submitted', done: waiting.length === 0, auto: true },
    { id: 'activations', text: 'Log activations and SC+', done: done('activations') || !!(day && (day.activations || day.scPlus)), auto: false },
    { id: 'stock', text: alerts.length ? `Check ${alerts.length} stock alert${alerts.length === 1 ? '' : 's'}` : 'Stock checked', done: alerts.length === 0 || done('stock'), auto: false },
    { id: 'report', text: "Send today's WhatsApp report", done: done('report'), auto: false },
    ...(day?.custom || []).map(item => ({ id: item.id, text: item.text, done: item.done, auto: false }))
  ];
  return { date, month, summary, priorities, pending: { count: waiting.length, oldestDays: waiting.length ? daysBetween(waiting[0].date, date) : 0, sales: waiting }, alerts, checklist, soldToday: state.sales.filter(s => !s.voided && s.date === date).length };
}
