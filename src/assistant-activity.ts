/**
 * What the assistant is really doing right now, for the little face in the header. Only real work is shown: a state comes from a piece of code that is
 * actually running (the forecast engine checking saved data, a file being read, the optional model answering, work paused while you edit by hand) or from
 * saved data (something waiting for your review on Home). Nothing is faked, no temperature or progress is invented, and nothing is delayed for show.
 * Pure store, no React except the hook at the bottom.
 */
import { useSyncExternalStore } from 'react';

export type Activity = 'idle' | 'checking' | 'reading' | 'thinking' | 'waiting' | 'ready' | 'error';
/** When several things happen at once the first one in this list is shown. */
export const ACTIVITY_PRIORITY: Activity[] = ['error', 'thinking', 'reading', 'checking', 'waiting', 'ready', 'idle'];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: 'Assistant is ready to help',
  checking: 'Checking your saved data',
  reading: 'Reading a file',
  thinking: 'Working out an answer',
  waiting: 'Paused while you edit',
  ready: 'Something is ready for your review on Home',
  error: 'Something could not be finished'
};

/** The state to show for a set of sources (each source says what it is doing, or nothing). */
export function resolveActivity(sources: Record<string, Activity | null | undefined>): Activity {
  const present = new Set(Object.values(sources).filter((kind): kind is Activity => !!kind));
  return ACTIVITY_PRIORITY.find(kind => present.has(kind)) || 'idle';
}

const sources: Record<string, Activity> = {};
let snapshot: Activity = 'idle';
const listeners = new Set<() => void>();

/** A piece of code says what it is doing (null = it is not doing anything). Listeners are told only when the shown state changes. */
export function setActivity(source: string, kind: Activity | null): void {
  if (kind === null) delete sources[source]; else sources[source] = kind;
  const next = resolveActivity(sources);
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}
export const getActivity = (): Activity => snapshot;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The state to show, with extra facts from saved data (for example { review: 'ready' } when a request waits on Home). */
export function useActivity(extra: Record<string, Activity | null | undefined> = {}): Activity {
  const running = useSyncExternalStore(subscribe, getActivity, getActivity);
  return resolveActivity({ running, ...extra });
}
