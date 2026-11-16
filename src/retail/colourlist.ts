/**
 * One row per colour abbreviation of the whole report ("CRM", "GRPH", "LVND"…), not one per line: answering a row answers every line that uses it.
 * Only lines that matter are looked at (some stock, some sold, or a colour count above 0). A row is "resolved" when every line that uses it already has
 * a colour name (taught, the model's own colours, or the built-in dictionary).
 */
import { modelColourNames, resolveColourWhy, suggestColours } from './colours';
import type { StockSource } from './inventory';
import { catalogIndex, matchModel } from './reconcile';
import { scanCounts } from './reportsync';
import { reportItems } from './stockreport';
import type { RetailState, StockReport } from './types';

export type LabelRow = { key: string; label: string; lines: number; resolved?: { name: string; source: string }; mixed: boolean; suggestions: string[] };

const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z]/g, '');

export function reportColourLabels(state: RetailState, report: StockReport, records: StockSource[]): LabelRow[] {
  const index = catalogIndex(state);
  const seen = new Map<string, string[]>();
  for (const key of Object.keys(scanCounts(state, records))) { const [code, , colour] = key.split('|'); if (colour && colour !== 'No colour') seen.set(code, [...(seen.get(code) || []), colour]); }
  const rows = new Map<string, { label: string; lines: number; unresolved: number; names: Set<string>; source: string; suggestions: Set<string> }>();
  for (const item of reportItems(report)) {
    if (item.kind !== 'colour') continue;
    if (item.stock <= 0 && item.sold <= 0 && !item.parts.some(p => (p.count ?? 0) > 0)) continue;
    const code = matchModel(state, index, item.name)?.code || '';
    const names = code ? modelColourNames(state, code, seen.get(code) || []) : [];
    for (const part of item.parts) {
      const key = keyOf(part.label);
      if (!key) continue;
      const row = rows.get(key) || { label: part.label.trim(), lines: 0, unresolved: 0, names: new Set<string>(), source: '', suggestions: new Set<string>() };
      row.lines++;
      const why = resolveColourWhy(state, code, part.label, names);
      if (why) { row.names.add(why.name); row.source ||= why.source; } else row.unresolved++;
      for (const s of suggestColours(part.label, names)) row.suggestions.add(s);
      rows.set(key, row);
    }
  }
  return [...rows.entries()].map(([key, r]): LabelRow => ({
    key, label: r.label, lines: r.lines, mixed: r.names.size > 1,
    resolved: r.unresolved === 0 && r.names.size > 0 ? { name: [...r.names][0], source: r.source } : undefined,
    suggestions: [...r.suggestions].slice(0, 4)
  })).sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved) || b.lines - a.lines || a.label.localeCompare(b.label));
}
