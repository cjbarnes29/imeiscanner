import type { AvailabilityWindow, RetailState, ShiftCode, WorkSchedule } from './types';
const minutes = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
// Generic labels; timings taken from the user-supplied shift legend. Ambiguous definitions require review.
const starts = [420, 480, 540, 570, 600, 660, 720, 780, 810, 840, 900, 960, 1020, 1080, 1140, 1200, 1260, 1320];
export const BUILTIN_SHIFTS: ShiftCode[] = [
  ...starts.map((start, i) => ({ code: `MX${i + 1}`, name: `Regular shift ${i + 1}`, available: true, periods: [{ start: minutes(start), end: minutes(start + 540) }] })),
  { code: 'MXOFF', name: 'Not available', available: false, periods: [] },
  ...['AL', 'SL', 'EL', 'UPL', 'RS', 'MAL', 'PAL'].map(code => ({ code, name: `${code} · Not available`, available: false, periods: [] })),
  { code: 'PMPOFF', name: 'Compensatory code · verify availability', available: true, periods: [], needsReview: true },
  { code: 'TA', name: 'Training · verify hours', available: true, periods: [], needsReview: true },
  ...[['JA1', '16:00', '22:00'], ['JA2', '12:00', '20:00'], ['STOCK', '20:00', '02:00'], ['DDF1', '07:00', '19:00'], ['DDF2', '19:00', '07:00'], ['BDF1', '08:00', '20:00'], ['BDF2', '14:00', '23:00']].map(([code, start, end]) => ({ code, name: code, available: true, periods: [{ start, end }] })),
  { code: 'SPS1', name: 'Split shift 1 · confirm break periods', available: true, periods: [{ start: '10:00', end: '22:00' }], needsReview: true },
  { code: 'SPS2', name: 'Split shift 2 · confirm break periods', available: true, periods: [{ start: '10:00', end: '23:00' }], needsReview: true }
];
export const shiftCodes = (state: Pick<RetailState, 'shiftCodes'>): ShiftCode[] => [...new Map([...BUILTIN_SHIFTS, ...(state.shiftCodes || [])].map(s => [s.code.toUpperCase(), s])).values()];
export const findShift = (state: Pick<RetailState, 'shiftCodes'>, code: string) => shiftCodes(state).find(s => s.code.toUpperCase() === code.trim().toUpperCase());
export const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export function resolvedWindows(state: Pick<RetailState, 'shiftCodes'>, schedule?: WorkSchedule): AvailabilityWindow[] {
  return (schedule?.windows || []).flatMap(w => {
    if (!w.code) return [w];
    const code = findShift(state, w.code);
    if (!code || code.needsReview) return [{ ...w, available: false, startTime: undefined, endTime: undefined }];
    return code.periods.length ? code.periods.map(p => ({ ...w, available: code.available, startTime: p.start, endTime: p.end })) : [{ ...w, available: code.available, startTime: undefined, endTime: undefined }];
  });
}
