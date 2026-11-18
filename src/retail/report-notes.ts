/** The app report as simple notes: plain text that can be read as it is, pasted into a chat or an email, or saved as a .txt file. Pure function. */
import { ADVICE_TITLE, type Cell, type ColFmt, type ReportModel, type ReportTable } from './report-model';
import type { Advice } from './forecast';

export const formatCell = (value: Cell, fmt: ColFmt): string => {
  if (value === '' || value === null || value === undefined) return '';
  if (fmt === 'pct') return typeof value === 'number' ? `${Math.round(value * 100)}%` : String(value);
  if (fmt === 'int') return typeof value === 'number' ? String(Math.round(value)) : String(value);
  return String(value);
};

/** One table row as a line: the first column leads, the rest follow as "Head value" pairs; empty cells are left out. */
export function tableLine(table: ReportTable, row: Cell[]): string {
  const [first, ...rest] = row.map((cell, i) => formatCell(cell, table.fmt[i]));
  const parts = rest.map((text, i) => (text ? `${table.head[i + 1].toLowerCase()} ${text}` : '')).filter(Boolean);
  return `- ${first}${parts.length ? ': ' + parts.join(', ') : ''}`;
}

const section = (title: string) => ['', title.toUpperCase()];

export function reportNotes(model: ReportModel, limit = 12): string {
  const lines: string[] = [model.title, `For: ${model.who} · made ${model.generatedOn}${model.month === model.generatedOn.slice(0, 7) ? ` · ${model.daysLeft} day${model.daysLeft === 1 ? '' : 's'} left` : ''}`];
  lines.push(...section('Highlights'), ...model.highlights.map(h => `- ${h}`));
  lines.push(...section('Numbers'), model.kpis.map(k => `${k.label} ${k.value}`).join(' · '));
  const add = (table: ReportTable, max = limit) => {
    lines.push(...section(table.title));
    if (!table.rows.length) { lines.push('- Nothing to show.'); return; }
    lines.push(...table.rows.slice(0, max).map(row => tableLine(table, row)));
    if (table.rows.length > max) lines.push(`- …and ${table.rows.length - max} more (the Excel report has them all).`);
  };
  add(model.segments, 20);
  add(model.people, 20);
  if (model.outlook.rows.length) {
    lines.push(...section('What to push and what to leave'));
    for (const advice of ['push', 'keep', 'far', 'stop'] as Advice[]) if (model.groups[advice].length) lines.push(`${ADVICE_TITLE[advice]}:`, ...model.groups[advice].map(g => `- ${g}`));
    if (model.outlook.note) lines.push(`(${model.outlook.note})`);
  }
  add(model.sales, 20);
  add(model.stock, 10);
  return lines.join('\n');
}
