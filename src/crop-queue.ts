// The background crop queue: photos waiting to be cut and read, one at a time. Only record ids, box positions, a status and a
// short message are kept (never pictures). Items whose photo no longer exists are dropped.
//   pending  waits for its turn          later    set aside; included again when the queue is resumed
//   failed   could not be cut or read: shown under Needs Review with a reason; retry puts it back to pending
// "Processing" is never stored: an item that was being read when the app stopped simply starts again (pending).
// Finished photos are written to a small log (see QueueLogEntry) so Completed / Needs Review survive a restart.
import { cleanBox, type DraftStorage } from './crop-draft';
import type { Box } from './crop-boxes';

export type QueueStatus = 'pending' | 'later' | 'failed';
export type QueueItem = { recordId: string; boxes: Box[]; auto: boolean; status: QueueStatus; error?: string; attempts: number; name?: string };
export const QUEUE_KEY = 'imei-lens-crop-queue-v1';

const STATUSES: QueueStatus[] = ['pending', 'later', 'failed'];

export function parseQueue(text: string | null, existingIds?: ReadonlySet<string>): QueueItem[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as { version?: number; items?: unknown[] };
    if (raw?.version !== 1 || !Array.isArray(raw.items)) return [];
    const seen = new Set<string>(), out: QueueItem[] = [];
    for (const entry of raw.items) {
      const item = entry as Partial<QueueItem> | null;
      if (!item || typeof item.recordId !== 'string' || seen.has(item.recordId)) continue;
      if (existingIds && !existingIds.has(item.recordId)) continue;
      const boxes = (Array.isArray(item.boxes) ? item.boxes : []).map(cleanBox).filter((b): b is Box => !!b);
      seen.add(item.recordId);
      out.push({
        recordId: item.recordId, boxes, auto: !!item.auto || !boxes.length,
        status: STATUSES.includes(item.status as QueueStatus) ? item.status as QueueStatus : 'pending',
        error: typeof item.error === 'string' ? item.error.slice(0, 200) : undefined,
        attempts: Number.isInteger(item.attempts) ? Math.max(0, Math.min(9, item.attempts as number)) : 0,
        name: typeof item.name === 'string' ? item.name.slice(0, 120) : undefined
      });
    }
    return out;
  } catch { return []; }
}

export const newItem = (recordId: string, boxes: Box[], name?: string, status: QueueStatus = 'pending'): QueueItem =>
  ({ recordId, boxes, auto: !boxes.length, status, attempts: 0, name });

/** Add entries. A photo already waiting is not queued twice: its entry is replaced (new boxes, status, a fresh start). */
export function mergeQueue(queue: QueueItem[], entries: QueueItem[]): QueueItem[] {
  const ids = new Set(entries.map(entry => entry.recordId));
  return [...queue.filter(item => !ids.has(item.recordId)), ...entries.map(entry => ({ ...entry, auto: entry.auto || !entry.boxes.length }))];
}

/** The next photo to read: the first pending one. */
export const nextPending = (queue: QueueItem[]) => queue.find(item => item.status === 'pending');
export const counts = (queue: QueueItem[]) => ({
  pending: queue.filter(i => i.status === 'pending').length,
  later: queue.filter(i => i.status === 'later').length,
  failed: queue.filter(i => i.status === 'failed').length
});
const update = (queue: QueueItem[], id: string, change: (item: QueueItem) => QueueItem) => queue.map(item => item.recordId === id ? change(item) : item);
/** Set aside without losing its boxes. */
export const setLater = (queue: QueueItem[], id: string) => update(queue, id, item => item.status === 'failed' ? item : { ...item, status: 'later' });
/** Resuming includes everything that was set aside. */
export const promoteLater = (queue: QueueItem[]) => queue.map(item => item.status === 'later' ? { ...item, status: 'pending' as const } : item);
export const markFailed = (queue: QueueItem[], id: string, error: string) => update(queue, id, item => ({ ...item, status: 'failed', error: error.slice(0, 200), attempts: item.attempts + 1 }));
/** Retry: back to pending, same boxes if there were any, otherwise automatic. */
export const retryItem = (queue: QueueItem[], id: string) => update(queue, id, item => item.status === 'failed' ? { ...item, status: 'pending', error: undefined } : item);
export const retryAllFailed = (queue: QueueItem[]) => queue.map(item => item.status === 'failed' ? { ...item, status: 'pending' as const, error: undefined } : item);
export const removeItem = (queue: QueueItem[], id: string) => queue.filter(item => item.recordId !== id);

export function writeQueue(storage: DraftStorage, queue: QueueItem[]): boolean {
  if (!queue.length) { try { storage.removeItem(QUEUE_KEY); } catch { /* ignore */ } return true; }
  try { storage.setItem(QUEUE_KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), items: queue })); return true; } catch { return false; }
}

export function readQueue(storage: DraftStorage, existingIds?: ReadonlySet<string>): QueueItem[] {
  let text: string | null = null;
  try { text = storage.getItem(QUEUE_KEY); } catch { return []; }
  const queue = parseQueue(text, existingIds);
  if (!queue.length && text) { try { storage.removeItem(QUEUE_KEY); } catch { /* ignore */ } }
  return queue;
}

// ---- Log of finished photos ----------------------------------------------------------------------------------------------
/** One finished photo. `recordIds` are the records its crops became (the original is gone). */
export type QueueLogEntry = { originalId: string; name: string; recordIds: string[]; at: string; note?: string; approved?: boolean };
export const LOG_KEY = 'imei-lens-crop-log-v1';
const LOG_LIMIT = 300;

export function readLog(storage: DraftStorage, existingIds?: ReadonlySet<string>): QueueLogEntry[] {
  try {
    const raw = JSON.parse(storage.getItem(LOG_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const out: QueueLogEntry[] = [];
    for (const entry of raw as Partial<QueueLogEntry>[]) {
      if (!entry || typeof entry.originalId !== 'string' || !Array.isArray(entry.recordIds)) continue;
      const recordIds = entry.recordIds.filter((id): id is string => typeof id === 'string' && (!existingIds || existingIds.has(id)));
      if (!recordIds.length) continue;
      out.push({ originalId: entry.originalId, name: String(entry.name || '').slice(0, 120), recordIds, at: String(entry.at || ''), note: entry.note ? String(entry.note).slice(0, 200) : undefined, approved: !!entry.approved });
    }
    return out;
  } catch { return []; }
}
export function writeLog(storage: DraftStorage, log: QueueLogEntry[]): boolean {
  try { storage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_LIMIT))); return true; } catch { return false; }
}
export const addLog = (log: QueueLogEntry[], entry: QueueLogEntry) => [...log.filter(old => old.originalId !== entry.originalId), entry].slice(-LOG_LIMIT);

/** Needs Review = failed photos plus finished photos with a crop that is not certain and not approved. Completed = the rest. */
export function classifyLog(log: QueueLogEntry[], flaggedIds: ReadonlySet<string>) {
  const review: QueueLogEntry[] = [], completed: QueueLogEntry[] = [];
  for (const entry of log) (!entry.approved && entry.recordIds.some(id => flaggedIds.has(id)) ? review : completed).push(entry);
  return { review, completed };
}
