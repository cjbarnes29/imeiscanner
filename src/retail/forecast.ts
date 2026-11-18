/**
 * Month outlook for Home: where each segment will most likely end this month if sales keep the pace of the month so far, and what is worth pushing.
 * Pure functions, no React. Pace = pieces sold so far (sold plus sold-not-submitted) / days gone, today counted; the rest of the month starts tomorrow.
 *
 * For each segment line:
 *  - 'stop'  the top level (120%, or the highest level the segment allows) is reached: more sales here add nothing, put the effort elsewhere;
 *  - 'push'  the next level the current pace would miss is within reach if the pace goes up by at most PUSH_LIMIT times: push it;
 *  - 'keep'  on track for the top level, or the next level needs more than PUSH_LIMIT times the pace (not worth chasing): keep the pace;
 *  - 'far'   not even 70% at this pace and 70% needs more than PUSH_LIMIT times the pace: put the effort on the others.
 * In the first days of the month there is no pace yet, so nothing is projected and every line only says what the next level needs.
 */
import { pendingBySegment, submittedSince } from './dashboard';
import { perDayText, MIN_PACE_DAYS } from './pace';
import { segLabel } from './segments';
import { summarizeTarget } from './targets';
import { daysLeft, monthOf, type DateKey, type Month, type RetailState, type Segment } from './types';

export type Standard = 70 | 100 | 120;
const LEVELS3: Standard[] = [70, 100, 120];
/** The pace may have to go up by this many times for a level to still count as "worth pushing". */
export const PUSH_LIMIT = 2;

export type FcInput = { segment: Segment; label: string; target: number; /** sold plus sold-not-submitted */ sold: number; needed: Record<Standard, number>; /** highest level this segment counts */ top: 100 | 120 };
export type Advice = 'push' | 'keep' | 'far' | 'stop';
export type FcLine = {
  segment: Segment; label: string; target: number; sold: number; advice: Advice; text: string;
  /** Where the month ends at this pace: pieces and percent of target (undefined in the first days). */
  projected?: number; projectedPct?: number;
  /** The level to look at next and the pieces it still needs (undefined when the top level is reached). */
  next?: { level: Standard; remaining: number };
};
export type Outlook = { month: Month; early: boolean; daysAfter: number; lines: FcLine[]; target: number; sold: number; projected?: number; projectedPct?: number };

const ORDER: Advice[] = ['push', 'keep', 'far', 'stop'];

export function forecast(inputs: FcInput[], month: Month, today: DateKey): Outlook {
  const gone = monthOf(today) === month ? Number(today.slice(8, 10)) : 0;
  const left = daysLeft(month, today);
  const daysAfter = left > 1 ? left - 1 : Math.max(1, left);
  const early = gone < MIN_PACE_DAYS;
  const lines: FcLine[] = inputs.filter(i => i.target > 0).map(i => {
    const levels = LEVELS3.filter(lv => lv <= i.top);
    const pace = i.sold / Math.max(1, gone);
    const projected = early ? undefined : Math.round(i.sold + pace * daysAfter);
    const base = { segment: i.segment, label: i.label, target: i.target, sold: i.sold, projected, projectedPct: projected === undefined ? undefined : Math.round(projected / i.target * 100) };
    if (i.sold >= i.needed[i.top]) return { ...base, advice: 'stop' as const, text: `The top level (${i.top}%) is reached. More sales here add nothing: put the effort elsewhere.` };
    const reached = projected ?? i.sold;
    const expected = levels.filter(lv => reached >= i.needed[lv]).pop() ?? 0;
    const k = levels.find(lv => i.needed[lv] > reached);
    const firstUnreached = levels.find(lv => i.needed[lv] > i.sold) as Standard;
    if (early) {
      const remaining = i.needed[firstUnreached] - i.sold;
      return { ...base, advice: 'keep' as const, next: { level: firstUnreached, remaining }, text: `${firstUnreached}% needs ${remaining} more (${perDayText(remaining, daysAfter)}). Too early in the month to project.` };
    }
    if (!k) return { ...base, advice: 'keep' as const, text: `On track for ${expected}%: about ${projected} by the end (${base.projectedPct}% of ${i.target}). Keep the pace.` };
    const remaining = i.needed[k] - i.sold;
    const need = remaining / daysAfter;
    const effort = pace > 0 ? need / pace : need <= 1 ? PUSH_LIMIT : Infinity;
    const next = { level: k, remaining };
    const pct = `About ${projected} by the end (${base.projectedPct}% of ${i.target}) at this pace.`;
    if (effort <= PUSH_LIMIT) return { ...base, next, advice: 'push' as const, text: `Push ${k}%: ${remaining} more (${perDayText(remaining, daysAfter)}). ${pct}` };
    const times = Number.isFinite(effort) ? `about ${Math.ceil(effort)} times the current pace` : 'a pace of selling nothing so far cannot reach';
    if (expected > 0) return { ...base, next, advice: 'keep' as const, text: `Likely ${expected}%. ${k}% needs ${remaining} more (${perDayText(remaining, daysAfter)}), ${times}: not worth chasing. ${pct}` };
    return { ...base, next, advice: 'far' as const, text: `Unlikely to reach 70%: it needs ${remaining} more (${perDayText(remaining, daysAfter)}), ${times}. Put the effort on the others. ${pct}` };
  });
  lines.sort((a, b) => ORDER.indexOf(a.advice) - ORDER.indexOf(b.advice) || (a.next?.remaining ?? 0) - (b.next?.remaining ?? 0) || a.label.localeCompare(b.label));
  const target = lines.reduce((s, l) => s + l.target, 0), sold = lines.reduce((s, l) => s + l.sold, 0);
  const projected = early ? undefined : lines.reduce((s, l) => s + (l.projected ?? 0), 0);
  return { month, early, daysAfter, lines, target, sold, projected, projectedPct: projected === undefined || target <= 0 ? undefined : Math.round(projected / target * 100) };
}

/** The outlook for some people together (everyone, or one person), from their targets of the month the date is in. */
export function outlookFor(state: RetailState, personIds: string[], today: DateKey): Outlook | undefined {
  const month = monthOf(today);
  const rows = new Map<Segment, FcInput & { capped: boolean }>();
  for (const id of personIds) {
    const target = state.targets[month]?.[id];
    if (!target) continue;
    const summary = summarizeTarget(target, pendingBySegment(state, id), today, state.rates, submittedSince(state, id, target));
    for (const line of summary.lines) {
      if (line.target <= 0) continue;
      const row = rows.get(line.segment) || { segment: line.segment, label: segLabel(state, line.segment), target: 0, sold: 0, needed: { 70: 0, 100: 0, 120: 0 }, top: 100 as 100 | 120, capped: true };
      row.target += line.target; row.sold += line.projected;
      for (const lv of LEVELS3) row.needed[lv] += line.at[lv].needed;
      if (!(target.lines.find(l => l.segment === line.segment)?.cap !== undefined && (target.lines.find(l => l.segment === line.segment)?.cap as number) <= 100)) row.capped = false;
      rows.set(line.segment, row);
    }
  }
  if (!rows.size) return undefined;
  return forecast([...rows.values()].map(r => ({ segment: r.segment, label: r.label, target: r.target, sold: r.sold, needed: r.needed, top: r.capped ? 100 : 120 })), month, today);
}
