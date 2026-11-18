import { perDayText } from './pace';

/** A short text to copy and send: what each person still needs, how many pieces a day, and the day each level is reached at the pace so far. */
export type SummaryPerson = { name: string; target: number; sold: number; remaining: number; perDay: number; today?: number; cap?: number; level?: number; /** "70% reached · 100% by 24 Nov · …" */ finish?: string };
export type SummaryRow = { label: string; target: number; sold: number; remaining: number; perDay: number; each: SummaryPerson[]; finish?: string; capLabel?: string; level?: number };

export function targetSummary(input: { month: string; level: number; days: number; rows: SummaryRow[]; person?: string }): string {
  const { month, level, days, rows } = input;
  const used = rows.filter(r => r.target > 0);
  const head = `Targets ${month} · ${level}%${input.person ? ` · ${input.person}` : ''} · ${days} day${days === 1 ? '' : 's'} left`;
  if (!used.length) return `${head}\nNo targets set yet.`;
  const lines = [head, ''];
  for (const r of used) {
    const goal = r.level ?? (r.capLabel ? undefined : level);
    lines.push(`${r.label}: sold ${r.sold} of ${r.target}${r.capLabel ? ` · ${r.capLabel}` : ''} · ${r.remaining <= 0 ? goal === undefined ? 'selected levels reached (caps applied)' : `${goal}% reached` : `needs ${r.remaining} more${r.capLabel ? goal === undefined ? ' (caps applied)' : ` for ${goal}%` : ''} · ${perDayText(r.remaining, days)}`}`);
    if (r.finish) lines.push(`  ${r.finish}`);
    if (r.each.length > 1 || (r.each.length === 1 && !input.person)) for (const p of r.each) {
      if (p.target <= 0) continue;
      lines.push(`  ${p.name}: ${p.sold}/${p.target}${p.today ? ` (today ${p.today})` : ''}${p.cap !== undefined ? ` · Cap ${p.cap}%` : ''} · ${p.remaining <= 0 ? p.cap !== undefined ? `${p.level ?? Math.min(level, p.cap)}% reached` : 'reached' : `needs ${p.remaining}${p.cap !== undefined ? ` for ${p.level ?? Math.min(level, p.cap)}%` : ''} · ${perDayText(p.remaining, days)}`}`);
      if (p.finish) lines.push(`    ${p.finish}`);
    }
  }
  const need = used.reduce((a, r) => a + r.remaining, 0);
  lines.push('', need <= 0 ? used.some(r => r.capLabel) ? 'All selected levels reached (caps applied).' : `All segments reached ${level}%.` : `Total: ${need} more pieces · ${perDayText(need, days)}`);
  return lines.join('\n');
}
