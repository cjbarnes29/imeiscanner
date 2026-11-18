/**
 * Scheduled routines ("every day at 9:00 ..."), like Claude routines but local and offline.
 * Pure logic only. A routine has an instruction, an optional time of day and optional weekdays (none = every day).
 */
export type RoutineRun = { at: string; kind: 'task' | 'request' | 'answer' | 'missed'; refId?: string; note: string; late?: boolean };
export type TimedRoutine = { id: string; text: string; enabled: boolean; lastPrepared?: string; time?: string; days?: number[]; lastRun?: RoutineRun; runs?: RoutineRun[] };

const DAY_NAMES: [string, number][] = [['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6]];
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_WORD = 'sun(?:day)?s?|mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?';
const TIME = /(?:\bat\s+|@\s*)?(?:\b(\d{1,2}):([0-5]\d)\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b)/i;
const BARE_TIME = /\bat\s+(\d{1,2})\b(?!\s*(?:fold|phones?|units?|%|percent))/i;
const RECURRENCE = new RegExp(`\\b(?:every\\s*day|everyday|daily|each\\s+day|every\\s+(?:week\\s*day|weekend|${DAY_WORD})|week\\s*days|weekends)\\b`, 'i');

const pad = (n: number) => String(n).padStart(2, '0');
function toTime(h: number, m: number, ap?: string): string | null {
  let hour = h;
  if (ap) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (ap.toLowerCase() === 'pm' ? 12 : 0); }
  return hour > 23 || m > 59 ? null : `${pad(hour)}:${pad(m)}`;
}

/** "give phones by the limits every day at 9:00" -> { task: "give phones by the limits", time: "09:00", days: [] }. Needs both a time and a recurrence word. */
export function parseSchedule(input: string): { task: string; time: string; days: number[] } | null {
  let text = input.trim();
  if (!RECURRENCE.test(text)) return null;
  let time: string | null = null;
  const t = text.match(TIME);
  if (t) { time = t[1] !== undefined ? toTime(+t[1], +t[2], t[3]) : toTime(+t[4], 0, t[5]); text = text.replace(TIME, ' '); }
  else { const b = text.match(BARE_TIME); if (b) { time = toTime(+b[1], 0); text = text.replace(BARE_TIME, ' '); } }
  if (!time) return null;
  let days: number[] = [];
  const phrase = text.match(new RegExp(`\\bevery\\s+(?:week\\s*day|weekend|(?:${DAY_WORD})(?:\\s*(?:,|and|&)\\s*(?:${DAY_WORD}))*)\\b|\\bweek\\s*days\\b|\\bweekends\\b`, 'i'));
  if (phrase) {
    const p = phrase[0].toLowerCase();
    if (/week\s*days?$/.test(p) && !/weekend/.test(p)) days = [1, 2, 3, 4, 5];
    else if (/weekends?/.test(p)) days = [0, 6];
    else days = DAY_NAMES.filter(([k]) => new RegExp(`\\b${k}`).test(p)).map(([, n]) => n);
  }
  const task = text
    .replace(new RegExp(`\\bevery\\s+(?:week\\s*day|weekend|(?:${DAY_WORD})(?:\\s*(?:,|and|&)\\s*(?:${DAY_WORD}))*)\\b|\\bevery\\s*day\\b|\\beveryday\\b|\\bdaily\\b|\\beach\\s+day\\b|\\bweek\\s*days\\b|\\bweekends\\b`, 'ig'), ' ')
    .replace(/^\s*(?:please\s+)?(?:(?:add|create|save|schedule|set up)\s+(?:a\s+)?(?:daily\s+)?routine\s+(?:to\s+|for\s+)?|schedule\s+(?:to\s+)?|run\s+)/i, '')
    .replace(/\s+/g, ' ').replace(/\s+(?:at|on|and)\s*$/i, '').replace(/^\s*(?:at|on|and|to|:|,|-)\s+/i, '').replace(/[\s,;:.-]+$/g, '').trim();
  return task.length >= 3 ? { task, time, days } : null;
}

export type Due = { due: boolean; late: boolean; minutesLate: number; skip: boolean };
/** Is a timed routine due right now? It runs at its time only: later than `graceMinutes` it is skipped (and logged as missed), never run at a strange hour. */
export function routineDueNow(routine: TimedRoutine, now: Date, today: string, graceMinutes = 5): Due {
  const none: Due = { due: false, late: false, minutesLate: 0, skip: false };
  if (!routine.enabled || !routine.time || routine.lastPrepared === today) return none;
  if (routine.days?.length && !routine.days.includes(now.getDay())) return none;
  const [h, m] = routine.time.split(':').map(Number);
  const minutesLate = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
  if (!Number.isFinite(minutesLate) || minutesLate < 0) return none;
  return { due: true, late: minutesLate > 2, minutesLate, skip: minutesLate > graceMinutes };
}

export const describeSchedule = (r: Pick<TimedRoutine, 'time' | 'days'>) => !r.time ? 'No time: once a day when the app is open' : `${!r.days?.length || r.days.length === 7 ? 'Every day' : r.days.join(',') === '1,2,3,4,5' ? 'Weekdays' : r.days.join(',') === '0,6' ? 'Weekends' : r.days.map(d => DAY_LABELS[d]).join(', ')} at ${r.time}`;

/** When it runs next, in plain words. */
export function nextRun(r: TimedRoutine, now: Date, today: string, graceMinutes = 5): string {
  if (!r.time) return '';
  if (!r.enabled) return 'Paused';
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    if (r.days?.length && !r.days.includes(d.getDay())) continue;
    if (i === 0) { const [h, m] = r.time.split(':').map(Number); if (r.lastPrepared === today) continue; if (now.getHours() * 60 + now.getMinutes() > h * 60 + m + graceMinutes) continue; return `Today ${r.time}`; }
    return `${i === 1 ? 'Tomorrow' : DAY_LABELS[d.getDay()]} ${r.time}`;
  }
  return '';
}

export const addRun = <T extends TimedRoutine>(r: T, run: RoutineRun, today: string, countAsScheduled: boolean): T =>
  ({ ...r, lastRun: run, runs: [...(r.runs || []), run].slice(-10), lastPrepared: countAsScheduled ? today : r.lastPrepared });

/** The next moment a timed routine should run (epoch ms), for the Android helper that wakes the app. Today's slot counts until its grace time has passed. */
export function nextRoutineAt(routines: TimedRoutine[], now: Date, today: string, graceMinutes = 5): { at: number; label: string } | null {
  let best: { at: number; label: string } | null = null;
  for (const r of routines) {
    if (!r.enabled || !r.time) continue;
    const [h, m] = r.time.split(':').map(Number);
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
      if (r.days?.length && !r.days.includes(d.getDay())) continue;
      if (i === 0 && (r.lastPrepared === today || now.getTime() > d.getTime() + graceMinutes * 60000)) continue;
      if (!best || d.getTime() < best.at) best = { at: d.getTime(), label: `${r.text.length > 40 ? r.text.slice(0, 40) + '…' : r.text} at ${r.time}` };
      break;
    }
  }
  return best;
}
