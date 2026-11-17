import { perDayText } from './pace';

/** A short text to copy and send: what each person still needs, how many pieces a day, and the day each level is reached at the pace so far. */
export type SummaryPerson = { name: string; target: number; sold: number; remaining: number; perDay: number; today?: number; /** "70% reached · 100% by 24 Nov · …" */ finish?: string };
export type SummaryRow = { label: string; target: number; sold: number; remaining: number; perDay: number; each: SummaryPerson[]; finish?: string };

export function targetSummary(input: { month: string; level: number; days: number; rows: SummaryRow[]; person?: string }): string {
  const { month, level, days, rows } = input;
  const used = rows.filter(r => r.target > 0);
  const head = `Targets ${month} · ${level}%${input.person ? ` · ${input.person}` : ''} · ${days} day${days === 1 ? '' : 's'} left`;
  if (!used.length) return `${head}\nNo targets set yet.`;
  const lines = [head, ''];
  for (const r of used) {
    lines.push(r.remaining <= 0 ? `${r.label}: sold ${r.sold} of ${r.target} · ${level}% reached` : `${r.label}: sold ${r.sold} of ${r.target} · needs ${r.remaining} more · ${perDayText(r.remaining, days)}`);
    if (r.finish) lines.push(`  ${r.finish}`);
    if (r.each.length > 1 || (r.each.length === 1 && !input.person)) for (const p of r.each) {
      if (p.target <= 0) continue;
      lines.push(`  ${p.name}: ${p.sold}/${p.target}${p.today ? ` (today ${p.today})` : ''} · ${p.remaining <= 0 ? 'reached' : `needs ${p.remaining} · ${perDayText(p.remaining, days)}`}`);
      if (p.finish) lines.push(`    ${p.finish}`);
    }
  }
  const need = used.reduce((a, r) => a + r.remaining, 0);
  lines.push('', need <= 0 ? `All segments reached ${level}%.` : `Total: ${need} more pieces · ${perDayText(need, days)}`);
  return lines.join('\n');
}
