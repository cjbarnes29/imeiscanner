// Unfinished crop work ("Save for later"). Only the boxes are kept (a few bytes per photo), never the
// pictures, so a draft cannot fill the phone's storage. A draft is dropped when its photo is gone.
import { isUsableBox, type Box } from './crop-boxes';

export type DraftItem = { recordId: string; boxes: Box[] };
export type CropDraft = { version: 1; savedAt: string; index: number; items: DraftItem[] };
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DRAFT_KEY = 'imei-lens-crop-draft-v1';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const cleanBox = (value: unknown): Box | null => {
  const b = value as Partial<Box> | null;
  if (!b || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height)) return null;
  const box = { x: b.x, y: b.y, width: b.width, height: b.height };
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= 100.01 && box.y + box.height <= 100.01 && isUsableBox(box) ? box : null;
};

/** Only photos that still exist and boxes that are still valid come back; null when nothing is left. */
export function parseDraft(text: string | null, existingIds?: ReadonlySet<string>): CropDraft | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<CropDraft>;
    if (raw?.version !== 1 || !Array.isArray(raw.items)) return null;
    const items: DraftItem[] = [];
    for (const item of raw.items) {
      if (!item || typeof item.recordId !== 'string') continue;
      if (existingIds && !existingIds.has(item.recordId)) continue;
      const boxes = (Array.isArray(item.boxes) ? item.boxes : []).map(cleanBox).filter((b): b is Box => !!b);
      items.push({ recordId: item.recordId, boxes });
    }
    if (!items.some(item => item.boxes.length)) return null;
    const index = finite(raw.index) ? Math.max(0, Math.min(items.length - 1, Math.floor(raw.index))) : 0;
    return { version: 1, savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date(0).toISOString(), index, items };
  } catch { return null; }
}

/** True when the draft holds any box worth keeping. */
export const draftHasWork = (items: DraftItem[]) => items.some(item => item.boxes.length > 0);

export function draftSummary(draft: CropDraft) {
  const photos = draft.items.filter(item => item.boxes.length).length;
  const boxes = draft.items.reduce((sum, item) => sum + item.boxes.length, 0);
  return { photos, boxes };
}

export function writeDraft(storage: DraftStorage, items: DraftItem[], index: number, now = new Date()): boolean {
  if (!draftHasWork(items)) { storage.removeItem(DRAFT_KEY); return false; }
  const draft: CropDraft = { version: 1, savedAt: now.toISOString(), index, items: items.map(item => ({ recordId: item.recordId, boxes: item.boxes })) };
  try { storage.setItem(DRAFT_KEY, JSON.stringify(draft)); return true; } catch { return false; }
}

export function readDraft(storage: DraftStorage, existingIds?: ReadonlySet<string>): CropDraft | null {
  let text: string | null = null;
  try { text = storage.getItem(DRAFT_KEY); } catch { return null; }
  const draft = parseDraft(text, existingIds);
  // A draft whose photos are all gone is removed, so the "resume" banner does not come back.
  if (!draft && text) { try { storage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
  return draft;
}

export function clearDraft(storage: DraftStorage) { try { storage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
