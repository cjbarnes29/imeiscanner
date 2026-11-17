/**
 * Pace and finish dates for targets. Pure functions, no React.
 *  - perDayText: "2 a day" (whole numbers, rounded up) or "1 every 3 days" when it is less than one a day. Never "0.1/day".
 *  - finishAt: the day a level is reached if sales keep the pace of this month so far (pieces sold / days gone), or why there is no date.
 */
import { daysInMonth, daysLeft, monthOf, type DateKey, type Level, type Month } from './types';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Nov" for 2026-11-24. */
export function shortDate(key: DateKey): string {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1] || ''}`.trim();
}

/** A date key a number of days after another one (local calendar days, so month ends and leap years work). */
export function addDays(key: DateKey, days: number): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** How many pieces a day finish `remaining` in `days` days: whole numbers rounded up; under one a day it says how many days one piece takes. */
export function perDayText(remaining: number, days: number): string {
  if (remaining <= 0) return '';
  if (days <= 0) return `${remaining} now`;
  const rate = remaining / days;
  if (rate >= 1) return `${Math.ceil(rate - 1e-9)} a day`;
  const every = Math.max(1, Math.floor(days / remaining));
  return every === 1 ? '1 a day' : `1 every ${every} days`;
}

export type Finish =
  | { kind: 'reached' }
  | { kind: 'date'; date: DateKey }
  | { kind: 'late'; perDay: string }
  | { kind: 'early' }
  | { kind: 'none' }
  | { kind: 'over' };

/** Sales are not counted as a pace before this many days of the month have gone (one lucky first day would give a wild date). */
export const MIN_PACE_DAYS = 3;

/**
 * The day `remaining` more pieces are sold at the pace of this month so far (sold / days gone, today counted), starting tomorrow.
 * 'late' = after the month ends: it says the pace that would still make it. 'none' = nothing sold yet. 'early' = too few days gone to tell.
 */
export function finishAt(remaining: number, achieved: number, month: Month, today: DateKey): Finish {
  if (remaining <= 0) return { kind: 'reached' };
  const left = daysLeft(month, today);
  if (monthOf(today) > month || left <= 0) return { kind: 'over' };
  if (monthOf(today) < month) return { kind: 'early' };
  const gone = Number(today.slice(8, 10));
  if (gone < MIN_PACE_DAYS) return { kind: 'early' };
  if (achieved <= 0) return { kind: 'none' };
  const pace = achieved / gone;
  const daysNeeded = Math.ceil(remaining / pace - 1e-9);
  const date = addDays(today, daysNeeded);
  if (monthOf(date) !== month || Number(date.slice(8, 10)) > daysInMonth(month)) return { kind: 'late', perDay: perDayText(remaining, left - 1 > 0 ? left - 1 : left) };
  return { kind: 'date', date };
}

/** One short sentence for a level: "70% reached", "100% by 24 Nov", "120% not by month end (3 a day)". */
export function finishText(level: Level, finish: Finish): string {
  switch (finish.kind) {
    case 'reached': return `${level}% reached`;
    case 'date': return `${level}% by ${shortDate(finish.date)}`;
    case 'late': return `${level}% not by month end (needs ${finish.perDay})`;
    case 'early': return `${level}%: too early to tell`;
    case 'none': return `${level}%: no sales yet`;
    default: return `${level}%: month over`;
  }
}

/** The three standard levels in one line, for a person's segment or a total. */
export function finishLine(levelsRemaining: Partial<Record<Level, number>>, achieved: number, month: Month, today: DateKey, levels: Level[] = [70, 100, 120]): string {
  return levels.filter(level => levelsRemaining[level] !== undefined).map(level => finishText(level, finishAt(levelsRemaining[level] as number, achieved, month, today))).join(' · ');
}
