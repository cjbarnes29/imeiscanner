import { resolvedWindows, shiftCodes } from './shift-codes';
import { dateKey, daysInMonth, LEVELS, monthOf, type RetailState, type LeaveTransfer, type WorkSchedule, type AvailabilityWindow } from './types';
export const emptySchedule = (): WorkSchedule => ({ offWeekdays: [], offDates: [], annualLeave: [] });
export function availability(state: RetailState, personId: string, date: string, ignoreAnnual = false): 'working' | 'off' | 'annual leave' {
  const schedule = state.workSchedules?.[personId];
  if (!schedule) return 'working';
  const windows = resolvedWindows(state, schedule).filter(w => w.start <= date && w.end >= date);
  if (windows.some(w => !w.available && !w.startTime && !w.endTime)) return 'off';
  if (!ignoreAnnual && schedule.annualLeave.some(l => l.start <= date && l.end >= date)) return 'annual leave';
  if (schedule.offDates.includes(date) || schedule.offWeekdays.includes(new Date(`${date}T12:00:00`).getDay())) return 'off';
  if (windows.some(w => w.available)) return 'working';
  if (schedule.requireSchedule && !windows.some(w => w.available)) return 'off';
  return 'working';
}
export const isWorking = (state: RetailState, personId: string, date: string) => availability(state, personId, date) === 'working';
export const localTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function availabilityAt(state: RetailState, personId: string, date: string, time = localTime()): 'working' | 'off' | 'annual leave' {
  const schedule = state.workSchedules?.[personId];
  if (schedule?.annualLeave.some(l => l.start <= date && l.end >= date)) return 'annual leave';
  if (schedule?.offDates.includes(date) || schedule?.offWeekdays.includes(new Date(`${date}T12:00:00`).getDay())) return 'off';
  const windows = resolvedWindows(state, state.workSchedules?.[personId]);
  const before = new Date(`${date}T12:00:00`); before.setDate(before.getDate() - 1); const previousDate = dateKey(before);
  const matches = (w: AvailabilityWindow) => {
    if (!w.startTime && !w.endTime) return w.start <= date && w.end >= date;
    const start = w.startTime || '00:00', end = w.endTime || '23:59';
    if (start <= end) return w.start <= date && w.end >= date && time >= start && time < end;
    return (w.start <= date && w.end >= date && time >= start) || (w.start <= previousDate && w.end >= previousDate && time < end);
  };
  if (windows.some(w => !w.available && matches(w))) return 'off';
  const available = windows.filter(w => w.available);
  if (available.some(matches)) return 'working';
  if (available.some(w => w.start <= date && w.end >= date)) return 'off';
  return availability(state, personId, date);
}
export const isAvailableAt = (state: RetailState, personId: string, date: string, time = localTime()) => availabilityAt(state, personId, date, time) === 'working';
export const calendarAvailability = (state: RetailState, personId: string, date: string) => date === dateKey() ? availabilityAt(state, personId, date) : availability(state, personId, date);
export const availabilityLabel = (state: RetailState, personId: string, date: string) => calendarAvailability(state, personId, date) === 'working' ? 'Available' : 'Not available';
export function calendarDates(start: string, end: string) {
  const out: string[] = [], d = new Date(`${start}T12:00:00`);
  for (let i = 0; i < 366 && !Number.isNaN(d.getTime()); i++, d.setDate(d.getDate() + 1)) { const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (date > end) break; out.push(date); }
  return out;
}
export const workingDates = (state: RetailState, personId: string, start: string, end: string) => calendarDates(start, end).filter(date => isWorking(state, personId, date));
export function remainingCalculationDays(state: RetailState, personId: string, date: string) {
  const month = monthOf(date);
  const offDivisor = state.workSchedules?.[personId]?.offDivisor?.[month];
  if (offDivisor && offDivisor > 0) return offDivisor;
  const from = `${month}-01`, until = `${month}-${daysInMonth(month)}`;
  const dates = calendarDates(from, until).filter(d => availability(state, personId, d, true) === 'working');
  const configured = state.workSchedules?.[personId]?.calculationDays?.[month];
  return Math.max(1, (configured ?? dates.length) - dates.filter(d => d < date).length);
}
export const calculationDates = (state: RetailState, personId: string, start: string, end: string) => {
  const dates = workingDates(state, personId, start, end);
  return state.workSchedules?.[personId]?.calculationDays?.[monthOf(start)] || state.workSchedules?.[personId]?.offDivisor?.[monthOf(start)] ? dates.slice(0, remainingCalculationDays(state, personId, start)) : dates;
};
export function equalShares(total: number, people: string[]) {
  return people.map((personId, i) => ({ personId, units: Math.floor(total / Math.max(1, people.length)) + (i < total % Math.max(1, people.length) ? 1 : 0) }));
}
const onDate = (total: number, dates: string[], from: string, until: string) => dates.reduce((n, date, i) => n + (date >= from && date <= until ? Math.floor(total / dates.length) + (i < total % dates.length ? 1 : 0) : 0), 0);
/** Net workload adjustment, never a change to official monthly targets or recorded sales. */
export function coverageUnits(state: RetailState, personId: string, segment: string, from: string, until: string): number {
  let units = 0;
  for (const transfer of state.leaveTransfers || []) {
    if (transfer.status !== 'active') continue;
    const line = transfer.segments.find(s => s.segment === segment); if (!line) continue;
    const dates = calendarDates(transfer.start, transfer.end);
    if (transfer.personId === personId) {
      // Deduct only quantities actually allocated to recipients who can work; unplaced coverage stays visible.
      const allocated = line.shares.filter(s => workingDates(state, s.personId, transfer.start, transfer.end).length).reduce((n, s) => n + s.units, 0);
      units -= onDate(Math.min(line.total, allocated), dates.filter(date => availability(state, personId, date, true) === 'working'), from, until);
    } else {
      const share = line.shares.find(s => s.personId === personId);
      if (share) units += onDate(share.units, workingDates(state, personId, transfer.start, transfer.end), from, until);
    }
  }
  return units;
}
export function suggestedLeaveTransfer(state: RetailState, personId: string, start: string, end: string, recipients: string[], today: string): LeaveTransfer {
  const month = monthOf(start), monthEnd = `${month}-${daysInMonth(month)}`;
  const monthDays = state.workSchedules?.[personId]?.calculationDays?.[month] || daysInMonth(month);
  const leaveDays = calendarDates(start, end).length;
  const divisor = state.workSchedules?.[personId]?.leaveDivisor?.[month] || Math.max(0, monthDays - leaveDays);
  const eligible = recipients.filter(id => id !== personId && !state.giveLimits?.[id]?.off && workingDates(state, id, start, end).length);
  return { id: crypto.randomUUID(), personId, start, end, createdAt: new Date().toISOString(), status: 'active', monthDays, leaveDays, divisor, segments: (state.targets[month]?.[personId]?.lines || []).filter(l => l.target > 0).map(l => { const total = divisor > 0 ? Math.min(l.target, Math.ceil(l.target / divisor * leaveDays)) : 0; return { segment: l.segment, total, shares: equalShares(total, eligible) }; }) };

}
/** A planning-only target view for Give; actual target state is never overwritten. */
export function allocationPlanningState(state: RetailState, month: string): RetailState {
  if (!state.leaveTransfers?.some(t => t.status === 'active' && !t.adjustmentsApplied && monthOf(t.start) === month)) return state;
  const from = `${month}-01`, end = `${month}-${daysInMonth(month)}`;
  return { ...state, targets: { ...state.targets, [month]: Object.fromEntries(Object.entries(state.targets[month] || {}).map(([id, target]) => [id, { ...target, lines: target.lines.map(line => { const extra = coverageUnits({ ...state, leaveTransfers: state.leaveTransfers?.filter(t => !t.adjustmentsApplied) }, id, line.segment, from, end); return { ...line, levels: Object.fromEntries(LEVELS.map(level => [level, Math.max(0, (line.levels?.[level] ?? Math.ceil(line.target * level / 100)) + extra)])) }; }) }])) } };
}

/** Apply balanced target deltas. Editing reverses the old adjustment before applying the replacement. */
export function applyLeaveTransfer(state: RetailState, transfer: LeaveTransfer): RetailState {
  const old = state.leaveTransfers?.find(t => t.id === transfer.id && t.status === 'active' && t.adjustmentsApplied);
  let next = state;
  const snapshots: NonNullable<LeaveTransfer['targetSnapshots']> = {};
  const adjust = (personId: string, segment: string, delta: number, month: string, reversing = false) => {
    const target = next.targets[month]?.[personId] || { personId, month, source: 'manual' as const, importedAt: new Date().toISOString(), lines: [] };
    const line = target.lines.find(l => l.segment === segment) || { segment, target: 0, achieved: 0 };
    const value = line.target + delta;
    if (value < 0) throw new Error('Transferred units exceed the source target. Edit the total before applying.');
    const previous = old?.targetSnapshots?.[personId]?.[segment];
    if (!reversing) (snapshots[personId] ||= {})[segment] = { target: line.target, levels: line.levels };
    const levels = reversing && previous && previous.target === value && JSON.stringify(line.levels) === JSON.stringify(previous.appliedLevels) ? previous.levels : line.levels ? Object.fromEntries(Object.entries(line.levels).map(([level, n]) => [level, line.target ? Math.ceil((n || 0) * value / line.target) : Math.ceil(value * Number(level) / 100)])) : undefined;
    const changed = { ...line, target: value, levels };
    if (!reversing) snapshots[personId][segment].appliedLevels = levels;
    const lines = target.lines.some(l => l.segment === segment) ? target.lines.map(l => l.segment === segment ? changed : l) : [...target.lines, changed];
    next = { ...next, targets: { ...next.targets, [month]: { ...next.targets[month], [personId]: { ...target, lines } } } };
  };
  const move = (t: LeaveTransfer, sign: number) => { for (const line of t.segments) { adjust(t.personId, line.segment, -sign * line.total, monthOf(t.start), sign < 0); for (const share of line.shares) adjust(share.personId, line.segment, sign * share.units, monthOf(t.start), sign < 0); } };
  if (old) move(old, -1);
  if (transfer.status === 'active') {
    for (const line of transfer.segments) if (line.total !== line.shares.reduce((sum, share) => sum + share.units, 0) || line.shares.some(s => s.personId === transfer.personId || s.units < 0 || !Number.isInteger(s.units))) throw new Error('Recipient shares must match the transferred total.');
    move(transfer, 1);
  }
  return { ...next, leaveTransfers: [...(next.leaveTransfers || []).filter(t => t.id !== transfer.id), { ...transfer, targetSnapshots: transfer.status === 'active' ? snapshots : transfer.targetSnapshots, adjustmentsApplied: transfer.status === 'active' }] };
}

export function scheduleFingerprint(state: RetailState) {
  return JSON.stringify([Object.entries(state.workSchedules || {}).sort(([a],[b]) => a.localeCompare(b)).map(([id,s]) => [id, [...s.offWeekdays].sort(), s.requireSchedule, [...s.offDates].sort(), [...s.annualLeave].sort((a,b)=>a.start.localeCompare(b.start)), [...(s.windows || [])].sort((a,b)=>a.id.localeCompare(b.id))]), shiftCodes(state).sort((a,b)=>a.code.localeCompare(b.code))]);
}
