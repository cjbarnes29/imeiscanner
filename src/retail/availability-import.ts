import { isDateKey, type AvailabilityWindow, type RetailState, type ShiftCode, type RosterEntry } from './types';
import { emptySchedule } from './availability';
import { findShift, validTime } from './shift-codes';
import { withAudit } from './data';

export type { RosterEntry } from './types';
const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function readRosterDate(value: string, month: string, order: 'DMY' | 'MDY' = 'DMY'): string {
  const s = value.trim(), iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return isDateKey(iso[1]) ? iso[1] : '';
  const numbers = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/);
  if (numbers) { const a = Number(numbers[1]), b = Number(numbers[2]), year = numbers[3] ? Number(numbers[3]) + (numbers[3].length === 2 ? 2000 : 0) : Number(month.slice(0,4)); const date = `${year}-${String(order === 'DMY' ? b : a).padStart(2,'0')}-${String(order === 'DMY' ? a : b).padStart(2,'0')}`; return isDateKey(date) ? date : ''; }
  const named = s.match(/^(?:[A-Za-z]+\s+)?(\d{1,2})\s*([A-Za-z]{3,})\s*(\d{4})?$/);
  if (named) { const m = months.indexOf(named[2].slice(0,3).toLowerCase()) + 1, date = `${named[3] || month.slice(0,4)}-${String(m).padStart(2,'0')}-${named[1].padStart(2,'0')}`; return isDateKey(date) ? date : ''; }
  const day = s.match(/^(?:(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*)?(\d{1,2})$/i);
  const date = day ? `${month}-${day[1].padStart(2,'0')}` : '';
  return isDateKey(date) ? date : '';
}
export function readRosterTime(value: string): string {
  const s = value.trim(), match = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return '';
  let hour = Number(match[1]); const minute = Number(match[2] || 0);
  if (match[3]) { if (hour < 1 || hour > 12) return ''; hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0); }
  const time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  return validTime(time) ? time : '';
}
export function csvGrid(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] || '', sep = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i+1] === '"') { value += '"'; i++; } else quoted = !quoted; } else if (c === sep && !quoted) { row.push(value.trim()); value = ''; } else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row=[];value=''; } else value += c; }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row); return rows.slice(0, 10000);
}
const stateOf = (s: string): boolean | null => /^(?:not\s*available|unavailable|off|mxoff|al|sl|el|upl|rs|mal|pal|leave|absent|no)$/i.test(s.trim()) ? false : /^(?:available|working|work|present|yes|p|w)$/i.test(s.trim()) ? true : null;
function shiftValue(state: RetailState, value: string) {
  const code = findShift(state, value), status = stateOf(value);
  if (code) return { code: code.code, available: code.available, startTime: '', endTime: '' };
  const times = value.match(/\d{1,2}:\d{2}\s*(?:am|pm)?/ig) || [];
  if (times.length >= 2) return { code: '', available: status ?? true, startTime: readRosterTime(times[0] || ''), endTime: readRosterTime(times[1] || '') };
  const short = value.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  return { code: '', available: short ? true : status, startTime: short ? readRosterTime(short[1] || '') : '', endTime: short ? readRosterTime(short[2] || '') : '' };
}
export function parseRosterGrid(grid: string[][], state: RetailState, people: { id: string; name: string }[], month: string, order: 'DMY' | 'MDY', source: string): { entries: RosterEntry[]; warnings: string[] } {
  const entries: RosterEntry[] = [], warnings: string[] = [];
  if (!grid.length) return { entries, warnings: ['No rows were read.'] };
  const headers = grid[0].map(normal), col = (...names: string[]) => headers.findIndex(h => names.includes(h));
  const personColumn = col('person','promoter','name','employee','staff','personname','employeename');
  const make = (personText: string, start: string, end: string, value: string, startTime = '', endTime = '') => {
    const matches = people.filter(p => normal(p.name) === normal(personText) || p.id === personText);
    const shift = shiftValue(state, value);
    entries.push({ id: crypto.randomUUID(), personId: matches.length === 1 ? matches[0].id : '', personText, start, end: end || start, ...shift, startTime: startTime ? readRosterTime(startTime) || startTime : shift.startTime, endTime: endTime ? readRosterTime(endTime) || endTime : shift.endTime, source });
  };
  const datedHeaders = grid[0].map((h, i) => ({ i, date: readRosterDate(h, month, order) })).filter(h => h.date);
  if (personColumn >= 0 && datedHeaders.length >= 1) {
    for (const row of grid.slice(1)) for (const h of datedHeaders) if (row[h.i]?.trim()) make(row[personColumn] || '', h.date, h.date, row[h.i]);
  } else if (personColumn >= 0 && col('date','from','start','startdate','datefrom') >= 0) {
    const dateColumn = col('date','startdate','datefrom','from','start'), endColumn = col('enddate','dateto','until','to','end'), statusColumn = col('status','availability','shift','shiftcode','code','type','reason','isworkingday');
    const startTimeColumn = col('starttime','timefrom','fromtime','clockin'), endTimeColumn = col('endtime','timeto','totime','clockout');
    for (const row of grid.slice(1)) { const start = readRosterDate(row[dateColumn] || '', month, order), end = endColumn >= 0 ? readRosterDate(row[endColumn] || '', month, order) : start; make(row[personColumn] || '', start, end || start, row[statusColumn] || '', row[startTimeColumn] || (dateColumn !== col('from') && readRosterTime(row[col('from')] || '') ? row[col('from')] : ''), row[endTimeColumn] || (readRosterTime(row[col('to')] || '') ? row[col('to')] : '')); }
  } else {
    for (const row of grid) {
      const text = row.join(' '), person = people.filter(p => text.toLowerCase().includes(p.name.toLowerCase()));
      const dates = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?|\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/g) || [];
      const codes = text.match(/\b(?:MX\d+|MXOFF|AL|SL|EL|UPL|RS|MAL|PAL|TA|JA[12]|DDF[12]|BDF[12]|SPS[12]|STOCK|Available|Unavailable|OFF|Not available)\b/ig) || [];
      if (!dates.length || !codes.length) { warnings.push(`Could not interpret: ${text.slice(0,100)}`); continue; }
      make(person.length === 1 ? person[0].name : text.split(/\s{2,}/)[0], readRosterDate(dates[0] || '', month, order), readRosterDate(dates[1] || dates[0] || '', month, order), codes[codes.length-1]);
    }
  }
  if (!entries.length) warnings.push('No dated roster entries found. A code legend contains shift definitions, not staff dates.');
  return { entries, warnings };
}
export function parseCodeLegend(grid: string[][]): ShiftCode[] {
  if (!grid.length) return [];
  const headers = grid[0].map(normal), code = headers.findIndex(h => ['code','shiftcode'].includes(h)), start = headers.indexOf('starttime'), end = headers.indexOf('endtime'), name = headers.indexOf('shiftname'), working = headers.findIndex(h => ['isworkingday','available','availability','status'].includes(h));
  if (code < 0 || start < 0 || end < 0) return [];
  return grid.slice(1).filter(row => /^[A-Za-z0-9_-]{1,24}$/.test(row[code] || '')).map(row => { const available = stateOf(row[working] || ''), startTime = readRosterTime(row[start] || ''), endTime = readRosterTime(row[end] || ''); return { code: row[code].toUpperCase(), name: row[name] || row[code], available: available ?? false, periods: startTime && endTime ? [{ start: startTime, end: endTime }] : [], needsReview: available === null || (!!row[start] !== !!startTime) || (!!row[end] !== !!endTime) || (available === true && (!startTime || !endTime)) }; });
}
export function rosterIssues(entry: RosterEntry, state: RetailState): string[] {
  const errors: string[] = [];
  if (!entry.personId) errors.push(`Choose the person for “${entry.personText}”.`);
  if (!isDateKey(entry.start) || !isDateKey(entry.end) || entry.end < entry.start) errors.push('Enter valid from/to dates.');
  if (entry.available === null && !entry.code) errors.push('Choose Available or Not available.');
  if (entry.code && (!findShift(state, entry.code) || findShift(state, entry.code)?.needsReview)) errors.push(`Review the ${entry.code} code definition first.`);
  if (entry.startTime && entry.startTime === entry.endTime) errors.push('Times are equal; clear both for an all-day entry.');
  if (!!entry.startTime !== !!entry.endTime || (entry.startTime && !validTime(entry.startTime)) || (entry.endTime && !validTime(entry.endTime))) errors.push('Enter both valid times, or leave both blank for all day.');
  return errors;
}
export function applyRoster(state: RetailState, entries: RosterEntry[], targetMode: 'manual' | 'linked', requireSchedule?: boolean): RetailState {
  if (!entries.length || entries.some(e => rosterIssues(e, state).length)) throw new Error('Correct the highlighted people, dates, times and codes before saving.');
  const workSchedules = { ...state.workSchedules };
  for (const personId of new Set(entries.map(e => e.personId))) {
    const schedule = workSchedules[personId] || emptySchedule(), incoming = entries.filter(e => e.personId === personId);
    const windows: AvailabilityWindow[] = incoming.map(e => ({ id: e.id, start: e.start, end: e.end, available: e.available ?? false, startTime: e.startTime || undefined, endTime: e.endTime || undefined, code: e.code || undefined, source: e.source }));
    const editingExisting = incoming.some(e => schedule.windows?.some(w => w.id === e.id));
    const same = (a: AvailabilityWindow, b: AvailabilityWindow) => a.id === b.id || (!editingExisting && a.start === b.start && a.end === b.end) || [a.start,a.end,a.code,a.startTime,a.endTime,a.available].join('|') === [b.start,b.end,b.code,b.startTime,b.endTime,b.available].join('|');
    workSchedules[personId] = { ...schedule, targetMode, ...(requireSchedule !== undefined ? { requireSchedule } : {}), windows: [...(schedule.windows || []).filter(w => !windows.some(n => same(w,n))), ...windows] };
  }
  return withAudit({ ...state, workSchedules, scheduleReview: undefined }, 'availability file applied', `${entries.length} reviewed entries saved to the actual calendar. Mode: ${targetMode}. Target adjustments require a separate reviewed application. No sales or stock changed.`);
}
