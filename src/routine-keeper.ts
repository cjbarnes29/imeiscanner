import { nextRoutineAt } from './retail/routine-schedule';
import type { RetailState } from './retail/types';

/**
 * Page side of the Android routine helper. The page tells Android when the next timed routine is due; Android keeps the app
 * alive (foreground service with a notification) and wakes the page at that moment. In a plain browser there is no bridge: nothing happens.
 * `retaillens-routine-wake` is the event Android fires at the due time; the routine engine listens to it.
 */
export type KeeperBridge = { routineKeeper?: (on: boolean, label: string, atMillis: number) => void; routineKeeperStopRequested?: () => boolean };
export const ROUTINE_WAKE_EVENT = 'retaillens-routine-wake';
const bridge = (): KeeperBridge | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { AndroidScanner?: KeeperBridge }).AndroidScanner);

let last = '';
/** Sends the next due time to Android only when it changed. Returns what was sent, for tests. */
export function syncRoutineKeeper(state: Pick<RetailState, 'assistantRoutines'>, now: Date, today: string, enabled: boolean, graceMinutes: number, target: KeeperBridge | undefined = bridge()): string {
  if (!target?.routineKeeper) return '';
  const next = enabled ? nextRoutineAt(state.assistantRoutines || [], now, today, graceMinutes) : null;
  const key = next ? `${next.at}|${next.label}` : 'off';
  if (key === last) return key;
  last = key;
  try { target.routineKeeper(!!next, next?.label || '', next?.at || 0); } catch { /* the helper is optional: routines still run while the app is open */ }
  return key;
}
/** True once if the notification's "Turn off" button was tapped. */
export function keeperStopRequested(target: KeeperBridge | undefined = bridge()): boolean {
  try { return !!target?.routineKeeperStopRequested?.(); } catch { return false; }
}
export const resetRoutineKeeperForTests = () => { last = ''; };
