/**
 * Archive of original photos that were cut into crops. An original is never deleted: before its record is replaced by its
 * crops, the whole record is written here (own IndexedDB keys `archive:<id>`, separate from the visible inventory) and the
 * stored copy of its photo (`source:<sourcePictureId>`) is protected from the orphan clean-up.
 * Undo / Restore puts the original back; the crops that are taken out for that are kept in the same entry, so nothing is lost.
 */
const DATABASE = 'imei-lens-v2';
const TABLE = 'inventory';
const ARCHIVE_PREFIX = 'archive:';

export type ArchiveEntry<T> = {
  id: string;                // id of the archived original record
  record: T;                 // the original record exactly as it was
  cropIds: string[];         // the crops that replaced it
  archivedAt: string;
  reason: string;            // e.g. 'crop-studio', 'queue', 'auto-split'
  restoredAt?: string;
  /** For archived duplicates: the id of the record that was kept for the same IMEI. */
  duplicateOf?: string;
  removedCrops?: T[];        // crops taken out when the original was restored (kept for recovery)
};

const protectedSources = new Set<string>();
/** Source photos that belong to an archived original; the inventory clean-up must not delete them. */
export const isProtectedSource = (sourcePictureId: string) => protectedSources.has(sourcePictureId);
export function setProtectedSources(entries: ArchiveEntry<{ sourcePictureId?: string }>[]) {
  protectedSources.clear();
  for (const entry of entries) if (!entry.restoredAt && entry.record.sourcePictureId) protectedSources.add(entry.record.sourcePictureId);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadArchive<T extends { sourcePictureId?: string }>(): Promise<ArchiveEntry<T>[]> {
  const database = await openDatabase();
  try {
    const rows = await new Promise<ArchiveEntry<T>[]>((resolve, reject) => {
      const request = database.transaction(TABLE, 'readonly').objectStore(TABLE).getAll(IDBKeyRange.bound(ARCHIVE_PREFIX, `${ARCHIVE_PREFIX}￿`));
      request.onsuccess = () => resolve(request.result as ArchiveEntry<T>[]);
      request.onerror = () => reject(request.error);
    });
    setProtectedSources(rows);
    return rows;
  } finally { database.close(); }
}

/** Resolves only when the entry is safely written, so the caller can then replace the original. */
export async function putArchiveEntry<T extends { sourcePictureId?: string }>(entry: ArchiveEntry<T>): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TABLE, 'readwrite');
      transaction.objectStore(TABLE).put(entry, `${ARCHIVE_PREFIX}${entry.id}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    if (!entry.restoredAt && entry.record.sourcePictureId) protectedSources.add(entry.record.sourcePictureId);
  } finally { database.close(); }
}

/** Pure helpers (unit-tested). */
export function makeEntry<T extends { id: string }>(record: T, cropIds: string[], reason: string, at = new Date().toISOString()): ArchiveEntry<T> {
  return { id: record.id, record, cropIds, archivedAt: at, reason };
}
/** What restoring does: the original returns, its crops leave the visible list (and are kept in the entry). */
export function planRestore<T extends { id: string; sourceRecordId?: string }>(entry: ArchiveEntry<T>, visible: T[], at = new Date().toISOString()): { records: T[]; entry: ArchiveEntry<T> } {
  const crops = visible.filter(row => entry.cropIds.includes(row.id) || row.sourceRecordId === entry.id);
  const keep = visible.filter(row => !crops.includes(row));
  const position = visible.findIndex(row => crops.includes(row));
  const records = [...keep];
  records.splice(position < 0 ? records.length : Math.min(position, records.length), 0, entry.record);
  return { records, entry: { ...entry, restoredAt: at, removedCrops: [...(entry.removedCrops || []), ...crops] } };
}

/** Entries not yet written. The inventory save waits for flushArchive(), so an original is never removed from storage before it is archived. */
const pending = new Map<string, ArchiveEntry<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
export function queueArchive<T extends { sourcePictureId?: string }>(entry: ArchiveEntry<T>) {
  pending.set(entry.id, entry);
  if (!entry.restoredAt && entry.record.sourcePictureId) protectedSources.add(entry.record.sourcePictureId);
}
export async function flushArchive(): Promise<void> {
  for (const [id, entry] of [...pending]) {
    await putArchiveEntry(entry);
    if (pending.get(id) === entry) pending.delete(id);
  }
}
