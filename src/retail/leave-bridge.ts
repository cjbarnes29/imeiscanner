import { calendarDates, suggestedLeaveTransfer } from './availability';
import { withAudit } from './data';
import { monthOf, type DateKey, type LeaveTransfer, type RetailState } from './types';

/**
 * Bridge between the Shift Calendar (imported roster windows) and the annual-leave target calculation.
 * Pure functions only: nothing here changes targets. A roster's AL days become a *proposed* leave range;
 * the existing reviewed "Availability & calculation days" flow still previews and applies any target change.
 */
export type RosterLeaveRange = { personId: string; start: DateKey; end: DateKey; month: string; leaveDays: number };
export type LeaveMark = 'applied' | 'saved' | 'leave' | 'roster';

const isLeaveCode = (code?: string) => code?.trim().toUpperCase() === 'AL';
const nextDay = (date: DateKey) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inRange = (date: DateKey, start: DateKey, end: DateKey) => start <= date && end >= date;

/** Dates already handled for this person: hand-entered leave ranges and any non-cancelled adjustment. */
function handledDates(state: RetailState, personId: string, date: DateKey) {
  const schedule = state.workSchedules?.[personId];
  return !!schedule?.annualLeave.some(l => inRange(date, l.start, l.end))
    || !!state.leaveTransfers?.some(t => t.personId === personId && t.status !== 'cancelled' && inRange(date, t.start, t.end));
}

/** AL days in imported rosters that are not yet a leave range or adjustment; consecutive days merge, one range per month. */
export function rosterLeaveRanges(state: RetailState): RosterLeaveRange[] {
  const out: RosterLeaveRange[] = [];
  for (const [personId, schedule] of Object.entries(state.workSchedules || {})) {
    const dates = new Set<DateKey>();
    for (const w of schedule.windows || []) if (isLeaveCode(w.code) && !w.available) for (const date of calendarDates(w.start, w.end)) if (!handledDates(state, personId, date)) dates.add(date);
    let current: DateKey[] = [];
    const flush = () => { if (current.length) out.push({ personId, start: current[0], end: current[current.length - 1], month: monthOf(current[0]), leaveDays: current.length }); current = []; };
    for (const date of [...dates].sort()) {
      const last = current[current.length - 1];
      if (last && (nextDay(last) !== date || monthOf(last) !== monthOf(date))) flush();
      current.push(date);
    }
    flush();
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.personId.localeCompare(b.personId));
}

/** Read-only preview of the target effect, using the same formula as the manual flow: target / (month days - leave days) x leave days. */
export function previewRosterLeave(state: RetailState, range: RosterLeaveRange, recipients: string[], today: DateKey): LeaveTransfer {
  const schedule = state.workSchedules?.[range.personId];
  const staged: RetailState = { ...state, workSchedules: { ...state.workSchedules, [range.personId]: { ...(schedule || { offWeekdays: [], offDates: [], annualLeave: [] }), annualLeave: [...(schedule?.annualLeave || []), { id: 'preview', start: range.start, end: range.end }] } } };
  return suggestedLeaveTransfer(staged, range.personId, range.start, range.end, recipients, today);
}

/** Saves the range as annual leave. No target changes: the reviewed calculation flow does that. */
export function saveRosterLeave(state: RetailState, range: RosterLeaveRange, name: string): RetailState {
  const schedule = state.workSchedules?.[range.personId] || { offWeekdays: [], offDates: [], annualLeave: [] };
  if (schedule.annualLeave.some(l => l.start <= range.end && l.end >= range.start)) throw new Error('These dates already overlap a saved annual-leave range.');
  const next = { ...state, workSchedules: { ...state.workSchedules, [range.personId]: { ...schedule, annualLeave: [...schedule.annualLeave, { id: crypto.randomUUID(), start: range.start, end: range.end }] } } };
  return withAudit(next, 'leave target range from shift roster', `${name}: ${range.start} to ${range.end} (${range.leaveDays} AL days) saved from the shift calendar. Targets unchanged until the calculation is reviewed and applied.`);
}

/** Small status for the calendar view: what happened to this person's leave on this date. */
export function leaveMark(state: RetailState, personId: string, date: DateKey): LeaveMark | null {
  const transfer = state.leaveTransfers?.find(t => t.personId === personId && t.status !== 'cancelled' && inRange(date, t.start, t.end));
  if (transfer) return transfer.adjustmentsApplied ? 'applied' : 'saved';
  const schedule = state.workSchedules?.[personId];
  if (schedule?.annualLeave.some(l => inRange(date, l.start, l.end))) return 'leave';
  if (schedule?.windows?.some(w => isLeaveCode(w.code) && !w.available && inRange(date, w.start, w.end))) return 'roster';
  return null;
}

export const leaveMarkLabel: Record<LeaveMark, string> = {
  applied: 'AL · targets adjusted',
  saved: 'AL · calculation saved, targets unchanged',
  leave: 'AL · leave saved, calculation not reviewed',
  roster: 'AL · from roster, not yet in target calculation'
};
