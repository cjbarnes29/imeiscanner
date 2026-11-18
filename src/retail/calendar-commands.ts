import { mentioned } from './people-commands';

/**
 * Everyday wording for "this person is away": "asha is on leave 2026-11-20 to 2026-11-24", "bilal is sick tomorrow", "put asha on annual leave next week",
 * "bilal off friday", "asha away from 20 nov until 22 nov". Pure logic: it only finds WHO and WHICH DATES; the assistant shows the exact dates in its
 * preview and nothing changes until you approve. Questions ("is bilal available today") and sentences with no person or no date are left alone.
 */
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_INDEX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY = '(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)';
const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const LEAVE = /\b(?:not available|unavailable|annual leave|on leave|leave|away|off|days? off|sick|ill|holiday|vacation|not working|not in|out of office|absent|can'?t (?:work|come|make it)|cannot (?:work|come|make it)|unable to (?:come|work|make it)|(?:not|never)\s+(?:coming|come|working|work|attending)(?:\s+in)?|won'?t (?:be )?(?:coming|in|working|here|around|available)|will not (?:be )?(?:in|working|coming|available))\b/i;
const QUESTION = /^(?:is|are|was|were|who|what|when|where|does|do|did|how|why|which|will|should|can i|could i)\b|\?\s*$/i;

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const real = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d, 12)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
export const addDays = (date: string, n: number) => { const t = new Date(`${date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The date of a day-month with no year: this year, or next year when it is more than a month in the past. */
function yearless(today: string, month: number, day: number): string | undefined {
  const year = +today.slice(0, 4);
  if (!real(year, month, day)) return undefined;
  const here = key(year, month, day);
  return here < addDays(today, -30) && real(year + 1, month, day) ? key(year + 1, month, day) : here;
}

type Hit = { index: number; end: number; date: string };
type Week = { index: number; end: number; start: string; last: string };
/** Every date written in the sentence, in the order written. A bare weekday is the next one from today (today counts); "next monday" is the one after today. */
export function findDates(q: string, today: string): { hits: Hit[]; week?: Week } {
  const hits: Hit[] = [];
  const push = (m: RegExpMatchArray, date: string | undefined) => { if (date) hits.push({ index: m.index!, end: m.index! + m[0].length, date }); };
  for (const m of q.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, real(+m[1], +m[2], +m[3]) ? m[0] : undefined);
  for (const m of q.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, 'g'))) push(m, yearless(today, MONTH_INDEX.indexOf(m[2].slice(0, 3)) + 1, +m[1]));
  for (const m of q.matchAll(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))) push(m, yearless(today, MONTH_INDEX.indexOf(m[1].slice(0, 3)) + 1, +m[2]));
  for (const m of q.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined; push(m, y ? (real(y, +m[2], +m[1]) ? key(y, +m[2], +m[1]) : undefined) : yearless(today, +m[2], +m[1])); }
  // "on the 28th": that day of this month, or of next month when it has already passed
  for (const m of q.matchAll(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/g)) {
    const year = +today.slice(0, 4), month = +today.slice(5, 7), day = +m[1];
    const here = real(year, month, day) ? key(year, month, day) : undefined;
    const nextYear = month === 12 ? year + 1 : year, nextMonth = month === 12 ? 1 : month + 1;
    push(m, here && here >= today ? here : real(nextYear, nextMonth, day) ? key(nextYear, nextMonth, day) : undefined);
  }
  for (const m of q.matchAll(/\b(day after tomorrow|tomorrow|today|tonight)\b/g)) push(m, m[1] === 'tomorrow' ? addDays(today, 1) : m[1] === 'day after tomorrow' ? addDays(today, 2) : today);
  for (const m of q.matchAll(new RegExp(`\\b(?:(next|this|coming|on)\\s+)?${WEEKDAY}\\b`, 'g'))) {
    const target = WEEKDAY_INDEX[m[2].slice(0, 3)];
    let ahead = (target - weekdayOf(today) + 7) % 7;
    if (m[1] === 'next' && ahead === 0) ahead = 7;
    push(m, addDays(today, ahead));
  }
  hits.sort((a, b) => a.index - b.index);
  const kept: Hit[] = [];
  for (const h of hits) if (!kept.length || h.index >= kept[kept.length - 1].end) kept.push(h);
  const w = /\bnext week\b/.exec(q);
  const week = w ? { index: w.index, end: w.index + w[0].length, start: addDays(today, (8 - weekdayOf(today)) % 7 || 7), last: addDays(addDays(today, (8 - weekdayOf(today)) % 7 || 7), 6) } : undefined;
  return { hits: kept, week };
}

/** Same shape as the older regular-expression match, `[sentence, person name, from, to]`, so the existing reviewed Not-available path is reused. */
export function leaveMatch(text: string, today: string, people: { id: string; name: string }[]): string[] | null {
  const q = text.toLowerCase().trim().replace(/^(?:(?:ok(?:ay)?|hey|so|please|kindly|also)[ ,]+)*(?:(?:can|could|would)\s+(?:you|u)\s+(?:please\s+)?|i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+)?/, '').replace(/\s+/g, ' ');
  if (!q || QUESTION.test(q) || !LEAVE.test(q)) return null;
  const who = mentioned(q, people);
  if (who.length !== 1) return null;
  const { hits, week } = findDates(q, today);
  let start: string | undefined, end: string | undefined;
  const span = /\bfor\s+(\d{1,2})\s+days?\b/.exec(q) || /\b(\d{1,2})\s+days?\s+(?:from|starting|beginning)\b/.exec(q);
  if (week && !hits.length) { start = week.start; end = week.last; }
  else if (hits.length >= 2) { start = hits[0].date; end = hits[1].date; }
  else if (hits.length === 1 && span && +span[1] >= 1 && +span[1] <= 60) { start = hits[0].date; end = addDays(start, +span[1] - 1); }
  else if (hits.length === 1 && /\b(?:until|till|through|thru|to)\s*$/.test(q.slice(0, hits[0].index).trim()) && !/\bfrom\b/.test(q)) { start = today; end = hits[0].date; }
  else if (hits.length === 1) { start = end = hits[0].date; }
  if (!start || !end) return null;
  if (end < start && hits.length >= 2 && !/\d{4}-\d{2}-\d{2}/.test(q)) end = addDays(end, 7);
  return [text, who[0].name, start, end];
}
