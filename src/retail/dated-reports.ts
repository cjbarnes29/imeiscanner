/** Dated report projections are separate from actual records, sales and report submission links. */
import { itemFor, segmentOf } from './catalog';
import { realStock, variantOf } from './inventory';
import { catalogIndex, matchModel, splitName } from './reconcile';
import { pendingReleases } from './planning';
import { buildReport, reportItems } from './stockreport';
import { monthOf, type RetailState, type StockReport, type ReportItem } from './types';
import type { StockSource } from './inventory';

const unit = (text: string) => text.replace(/\s+/g, '').toUpperCase();
export type DatedRow = { key: string; code: string; storage: string; name: string; segment: string; stock: number; sold: number; colors: Record<string, number> };
export function datedRows(state: RetailState, records: StockSource[], date: string, today: string): DatedRow[] {
  const active = realStock(state, records), availableIds = new Set(active.map(r => r.id));
  const scheduled = (state.releasePlans || []).flatMap(p => p.entries.filter(e => e.status === 'scheduled').flatMap(e => e.recordIds.map(id => ({ id, date: e.date }))));
  const projectedSold = new Set(scheduled.filter(e => date > today && e.date <= date && availableIds.has(e.id)).map(e => e.id));
  const soldThatDay = new Set(date > today ? scheduled.filter(e => e.date === date && availableIds.has(e.id)).map(e => e.id) : pendingReleases(state).map(p => p.id));
  const rows = new Map<string, DatedRow>();
  for (const r of records) {
    const item = itemFor(state, r.model); if (!item) continue;
    const v = variantOf(state, r), storage = unit(v.storage), key = `${item.code}|${storage}`;
    let row = rows.get(key);
    if (!row) { row = { key, code: item.code, storage, name: [item.abbreviation || item.name, storage].filter(Boolean).join(' '), segment: segmentOf(state, r.model, monthOf(date), state.recordMeta[r.id]), stock: 0, sold: 0, colors: {} }; rows.set(key, row); }
    if (availableIds.has(r.id) && !projectedSold.has(r.id)) { row.stock++; const color = v.color || 'No colour'; row.colors[color] = (row.colors[color] || 0) + 1; }
    if (soldThatDay.has(r.id)) row.sold++;
  }
  if (date <= today && state.report) {
    const index = catalogIndex(state);
    for (const item of reportItems(state.report)) {
      const code = matchModel(state, index, item.name)?.code;
      if (!code) continue;
      const storage = unit(splitName(item.name).storage);
      const row = rows.get(`${code}|${storage}`) || [...rows.values()].find(r => r.code === code && !storage);
      if (row) row.sold += item.sold;
    }
  }
  return [...rows.values()].sort((a, b) => a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name));
}
export function calculatedDatedReport(state: RetailState, records: StockSource[], date: string, today: string): StockReport {
  const rows = datedRows(state, records, date, today);
  const entries: ReportItem[] = rows.map(row => ({ t: 'item', id: `dated-${row.key}`, name: row.name, sold: row.sold, stock: row.stock, soldWidth: 2, stockWidth: 2, kind: 'none', parts: [], sep: ' ', line1: `${row.name} : 00/00`, line2: '' }));
  return { entries: [{ t: 'text', text: `Daily Report ${date}` }, ...entries], savedAt: new Date().toISOString(), dateText: date };
}
export function compareDatedReport(state: RetailState, records: StockSource[], report: StockReport, date: string, today: string) {
  const expected = datedRows(state, records, date, today), index = catalogIndex(state), actual = new Map<string, { sold: number; stock: number }>();
  const differences: string[] = [];
  for (const item of reportItems(report)) {
    const direct=expected.filter(row=>row.name.trim().toLowerCase()===item.name.trim().toLowerCase());
    const code = matchModel(state, index, item.name)?.code;
    const key = direct.length===1?direct[0].key:code ? `${code}|${unit(splitName(item.name).storage)}` : '';
    if (!key || !expected.some(r => r.key === key)) { if (item.stock || item.sold) differences.push(`${item.name}: no matching IMEI-backed model/variant to verify.`); continue; }
    const sum = actual.get(key) || { sold: 0, stock: 0 }; sum.sold += item.sold; sum.stock += item.stock; actual.set(key, sum);
  }
  for (const row of expected) {
    const item = actual.get(row.key) || { sold: 0, stock: 0 };
    if (item.stock !== row.stock) differences.push(`${row.name}: report stock ${item.stock}, ${date > today ? 'projected' : 'real'} stock ${row.stock}.`);
    if (item.sold !== row.sold) differences.push(`${row.name}: report sold ${item.sold}, ${date > today ? 'planned' : 'recorded / awaiting report'} ${row.sold}.`);
  }
  const totalReal = realStock(state, records).length, verifiable = datedRows(state, records, today, today).reduce((n, row) => n + row.stock, 0);
  if (verifiable !== totalReal) differences.push(`${totalReal - verifiable} real phones have unknown models. Resolve them before treating the report as fully matched.`);
  return { match: !differences.length, differences, realStock: totalReal, expectedStock: expected.reduce((n, row) => n + row.stock, 0), reportStock: reportItems(report).reduce((n, row) => n + row.stock, 0), future: date > today };
}
export const datedReportText = (report: StockReport, date: string, today: string) => `${date > today ? `PROJECTED DRAFT — ${date}\nNot a confirmed release or submission.\n\n` : ''}${buildReport(report, { date: new Date(`${date}T12:00:00`) })}`;
