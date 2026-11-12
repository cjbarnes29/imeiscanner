// The background crop queue: photos waiting to be cut and read one by one. Only record ids and box positions are kept
// (a few bytes per photo), never pictures. Items whose photo no longer exists are dropped. An item with no boxes (or auto)
// is cut by the automatic detector when its turn comes.
import { cleanBox, type DraftStorage } from './crop-draft';
import type { Box } from './crop-boxes';

export type QueueItem = { recordId: string; boxes: Box[]; auto: boolean };
export const QUEUE_KEY = 'imei-lens-crop-queue-v1';

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
      out.push({ recordId: item.recordId, boxes, auto: !!item.auto || !boxes.length });
    }
    return out;
  } catch { return []; }
}

/** Add entries; an entry for a photo already waiting replaces the old one. */
export function mergeQueue(queue: QueueItem[], entries: QueueItem[]): QueueItem[] {
  const ids = new Set(entries.map(entry => entry.recordId));
  return [...queue.filter(item => !ids.has(item.recordId)), ...entries.map(entry => ({ ...entry, auto: entry.auto || !entry.boxes.length }))];
}

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
