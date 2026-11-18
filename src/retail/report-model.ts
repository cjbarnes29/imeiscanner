/**
 * The "app report": one plain model of the month built only from what the app already knows (targets, sales, stock, the month outlook), so the same
 * numbers can be written as simple notes, an Excel file or a PowerPoint file (report-notes.ts, report-xlsx.ts, report-pptx.ts). Pure functions, no React.
 * Nothing here is invented: every number comes from the same engines the screens use, and no IMEI, serial, photo or contact detail is ever put in a report.
 */
import { pendingBySegment, submittedSince } from './dashboard';
import { outlookFor, type Advice } from './forecast';
import { realStock, stockAlerts, stockRows, type StockSource } from './inventory';
import { finishAt, finishText, perDayText } from './pace';
import { liveSales, pendingSubmissions } from './sales';
import { segLabel } from './segments';
import { summarizeTarget } from './targets';
import { daysLeft, monthOf, type DateKey, type Month, type RetailState, type Segment } from './types';

export type Cell = string | number;
/** How a column is shown: plain text, a whole number, or a percent (the cell holds a fraction, 0.62 = 62%). */
export type ColFmt = 'text' | 'int' | 'pct';
export type ReportTable = { id: string; title: string; head: string[]; fmt: ColFmt[]; rows: Cell[][]; note?: string };
export type ReportKpi = { label: string; value: string };
export type ReportModel = {
  title: string; month: Month; monthName: string; who: string; generatedOn: DateKey; daysLeft: number;
  kpis: ReportKpi[]; highlights: string[];
  segments: ReportTable; people: ReportTable; outlook: ReportTable; stock: ReportTable; sales: ReportTable;
  /** The outlook groups as short sentences, for notes and slides (empty when the month is not the current one or it is too early). */
  groups: Record<Advice, string[]>;
  /** Percent of target as a fraction (0.62), or null when there is no target. */
  achievement: number | null; projected: number | null;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A fraction rounded to four places (0.7143), so files hold clean numbers. */
const frac = (n: number) => Math.round(n * 10000) / 10000;
export const monthTitle = (month: Month): string => { const [y, m] = month.split('-').map(Number); return `${MONTH_NAMES[m - 1] || month} ${y}`; };
export const ADVICE_TITLE: Record<Advice, string> = { push: 'Push these', keep: 'Keep the pace', far: 'Hard to reach: focus elsewhere', stop: 'Done: stop pushing' };

export type ReportOptions = { month?: Month; /** '' or missing = everyone */ personId?: string };

export function buildReport(state: RetailState, records: StockSource[], people: { id: string; name: string }[], today: DateKey, options: ReportOptions = {}): ReportModel {
  const month = options.month || monthOf(today);
  const current = month === monthOf(today);
  const chosen = options.personId ? people.filter(p => p.id === options.personId) : people;
  const ids = chosen.map(p => p.id);
  const who = options.personId ? (chosen[0]?.name || 'Unknown person') : 'Everyone';
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Unassigned';
  const left = current ? daysLeft(month, today) : 0;

  // targets, per person and per segment (the person's sold count plus what was submitted since their screenshot; sold-but-not-submitted is shown apart)
  type Seg = { target: number; sold: number; needs100: number };
  const bySeg = new Map<Segment, Seg>();
  const personRows: { id: string; target: number; sold: number; pending: number }[] = [];
  for (const id of ids) {
    const target = state.targets[month]?.[id];
    const pending = current ? pendingSubmissions(state, id).length : 0;
    if (!target) { personRows.push({ id, target: 0, sold: 0, pending }); continue; }
    const summary = summarizeTarget(target, current ? pendingBySegment(state, id) : {}, today, state.rates, current ? submittedSince(state, id, target) : {});
    for (const line of summary.lines) {
      if (line.target <= 0 && line.achieved <= 0) continue;
      const row = bySeg.get(line.segment) || { target: 0, sold: 0, needs100: 0 };
      row.target += line.target; row.sold += line.achieved; row.needs100 += Math.max(0, line.at[100].needed - line.achieved);
      bySeg.set(line.segment, row);
    }
    personRows.push({ id, target: summary.totalTarget, sold: summary.totalAchieved, pending });
  }
  const totalTarget = [...bySeg.values()].reduce((s, r) => s + r.target, 0), totalSold = [...bySeg.values()].reduce((s, r) => s + r.sold, 0);
  const achievement = totalTarget > 0 ? frac(totalSold / totalTarget) : null;

  const outlook = current ? outlookFor(state, ids, today) : undefined;
  const projectedPct = outlook && !outlook.early && outlook.projectedPct !== undefined ? frac(outlook.projectedPct / 100) : null;

  const segments: ReportTable = {
    id: 'segments', title: 'Targets by segment',
    head: ['Segment', 'Target', 'Sold', 'Achieved', 'Needs for 100%', 'Pace for 100%', 'Reaches 100%'], fmt: ['text', 'int', 'int', 'pct', 'int', 'text', 'text'],
    rows: [...bySeg.entries()].filter(([, r]) => r.target > 0).map(([segment, r]) => [
      segLabel(state, segment), r.target, r.sold, r.target > 0 ? frac(r.sold / r.target) : 0, r.needs100,
      r.needs100 <= 0 ? 'Reached' : current ? perDayText(r.needs100, left > 1 ? left - 1 : Math.max(1, left)) : '',
      current ? finishText(100, finishAt(r.needs100, r.sold, month, today)).replace(/^100%:? ?/, '') : ''
    ]),
    note: current ? 'Pace and date are worked out from how many were sold so far this month.' : 'Past or future month: only the numbers are shown.'
  };

  const people_: ReportTable = {
    id: 'people', title: 'People',
    head: ['Person', 'Target', 'Sold', 'Achieved', 'Sold, not submitted', 'Month-end estimate', 'Next to push'], fmt: ['text', 'int', 'int', 'pct', 'int', 'pct', 'text'],
    rows: personRows.map(p => {
      const personOutlook = current ? outlookFor(state, [p.id], today) : undefined;
      const push = personOutlook?.lines.find(l => l.advice === 'push');
      return [nameOf(p.id), p.target, p.sold, p.target > 0 ? frac(p.sold / p.target) : 0, p.pending,
        personOutlook && !personOutlook.early && personOutlook.projectedPct !== undefined ? frac(personOutlook.projectedPct / 100) : '',
        push && push.next ? `${push.label}: ${push.next.remaining} more for ${push.next.level}%` : ''];
    })
  };

  const adviceName: Record<Advice, string> = { push: 'Push', keep: 'Keep the pace', far: 'Hard to reach', stop: 'Done' };
  const outlookTable: ReportTable = {
    id: 'outlook', title: 'Month outlook',
    head: ['Segment', 'Sold', 'Target', 'Advice', 'Detail'], fmt: ['text', 'int', 'int', 'text', 'text'],
    rows: (outlook?.lines || []).map(l => [l.label, l.sold, l.target, adviceName[l.advice], l.text]),
    note: !current ? 'The outlook is only given for the current month.' : outlook?.early ? 'Too early in the month to project: each line only says what its next level needs.' : 'A guess from the pace so far this month, not a promise.'
  };

  const stockList = stockRows(state, records, today).filter(r => r.qty > 0).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  const stock: ReportTable = {
    id: 'stock', title: 'Stock', head: ['Model', 'Memory', 'Colour', 'Segment', 'In stock'], fmt: ['text', 'text', 'text', 'text', 'int'],
    rows: stockList.map(r => [r.name, r.storage, r.color, segLabel(state, r.segment), r.qty]), note: 'Counts only; no IMEI numbers are put in a report.'
  };

  const salesMap = new Map<string, { person: string; segment: string; units: number; submitted: number }>();
  for (const sale of liveSales(state)) {
    if (sale.month !== month || (options.personId && sale.personId !== options.personId)) continue;
    const key = `${sale.personId}|${sale.segment}`, row = salesMap.get(key) || { person: nameOf(sale.personId), segment: segLabel(state, sale.segment), units: 0, submitted: 0 };
    row.units++; if (sale.submitted) row.submitted++;
    salesMap.set(key, row);
  }
  const salesRows = [...salesMap.values()].sort((a, b) => a.person.localeCompare(b.person) || b.units - a.units);
  const sales: ReportTable = { id: 'sales', title: 'Sales this month', head: ['Person', 'Segment', 'Units', 'Submitted'], fmt: ['text', 'text', 'int', 'int'], rows: salesRows.map(r => [r.person, r.segment, r.units, r.submitted]) };

  const salesCount = salesRows.reduce((s, r) => s + r.units, 0);
  const waiting = current ? pendingSubmissions(state, options.personId || undefined).length : 0;
  const inStock = realStock(state, records).filter(r => !options.personId || r.personId === options.personId).length;
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
  const kpis: ReportKpi[] = [
    { label: 'Target', value: String(totalTarget) }, { label: 'Sold', value: String(totalSold) }, { label: 'Achieved', value: pct(achievement) },
    { label: 'Month-end estimate', value: pct(projectedPct) }, { label: 'Days left', value: current ? String(left) : '—' },
    { label: 'Sales this month', value: String(salesCount) }, { label: 'Not yet submitted', value: current ? String(waiting) : '—' }, { label: 'Phones in stock', value: String(inStock) }
  ];

  const groups: Record<Advice, string[]> = { push: [], keep: [], far: [], stop: [] };
  for (const l of outlook?.lines || []) {
    const line = l.advice === 'push' && l.next ? `${l.label}: ${l.next.remaining} more for ${l.next.level}% (${perDayText(l.next.remaining, outlook!.daysAfter)})` : l.advice === 'stop' ? `${l.label}: top level reached` : `${l.label}: ${l.text}`;
    groups[l.advice].push(line);
  }

  const highlights: string[] = [];
  if (totalTarget > 0) highlights.push(`${who} is at ${pct(achievement)} of target (${totalSold} of ${totalTarget})${current ? ` with ${left} day${left === 1 ? '' : 's'} left` : ''}.`);
  else highlights.push(`No targets are set for ${monthTitle(month)}${options.personId ? ` for ${who}` : ''}.`);
  if (projectedPct !== null) highlights.push(`If sales keep this month's pace, the month ends at about ${pct(projectedPct)} (${outlook!.projected} of ${outlook!.target}).`);
  if (groups.push.length) highlights.push(`Push: ${groups.push.slice(0, 3).join('; ')}.`);
  if (groups.stop.length) highlights.push(`Done: ${groups.stop.map(s => s.split(':')[0]).join(', ')}.`);
  if (groups.far.length) highlights.push(`Hard to reach: ${groups.far.map(s => s.split(':')[0]).join(', ')}.`);
  if (waiting > 0) highlights.push(`${waiting} sale${waiting === 1 ? ' is' : 's are'} waiting to be submitted to Samsung.`);
  if (current) {
    const alerts = stockAlerts(state, stockRows(state, records, today), today), out = alerts.filter(a => a.kind === 'out').length, low = alerts.filter(a => a.kind === 'low').length;
    if (out || low) highlights.push(`Stock: ${out ? `${out} model${out === 1 ? '' : 's'} sold recently ${out === 1 ? 'is' : 'are'} out` : ''}${out && low ? '; ' : ''}${low ? `${low} ${low === 1 ? 'is' : 'are'} low` : ''}.`);
  }

  return { title: `AI LENS report · ${monthTitle(month)}`, month, monthName: monthTitle(month), who, generatedOn: today, daysLeft: left, kpis, highlights, segments, people: people_, outlook: outlookTable, stock, sales, groups, achievement, projected: projectedPct };
}
