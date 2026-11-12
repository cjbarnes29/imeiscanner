const DATABASE = 'imei-lens-v2';
const TABLE = 'inventory';
const RECORD_PREFIX = 'record:';
let lastSaved = new Map<string, unknown>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadInventory<T extends { id: string }>(): Promise<T[] | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const store = database.transaction(TABLE, 'readonly').objectStore(TABLE);
      const request = store.getAll(IDBKeyRange.bound(RECORD_PREFIX, `${RECORD_PREFIX}\uffff`));
      request.onsuccess = () => {
        const rows = request.result as T[];
        if (rows.length) {
          lastSaved = new Map(rows.map(row => [row.id, row]));
          resolve(rows);
          return;
        }
        const legacy = store.get('records');
        legacy.onsuccess = () => {
          const previous = legacy.result as T[] | undefined;
          lastSaved = new Map((previous || []).map(row => [row.id, row]));
          resolve(previous);
        };
        legacy.onerror = () => reject(legacy.error);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/**
 * Stored original photos to delete: the source photo of every removed record that no remaining
 * record refers to. A photo that was cut into crops is released this way once its record is replaced
 * (the crops get a new picture group), while a photo that other records still use is kept.
 */
export function orphanedSources(removed: ({ sourcePictureId?: string } | undefined)[], remaining: { sourcePictureId?: string }[]): Set<string> {
  const stillUsed = new Set(remaining.map(row => row.sourcePictureId).filter(Boolean));
  return new Set(removed.map(row => row?.sourcePictureId).filter((id): id is string => !!id && !stillUsed.has(id)));
}

export async function saveInventory<T extends { id: string; sourcePictureId?: string }>(records: T[]): Promise<void> {
  const current = new Map(records.map(row => [row.id, row]));
  const changed = records.filter(row => lastSaved.get(row.id) !== row);
  const removed = [...lastSaved.keys()].filter(id => !current.has(id));
  const unusedSources = orphanedSources(removed.map(id => lastSaved.get(id) as T | undefined), records);
  if (!changed.length && !removed.length) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TABLE, 'readwrite');
      const store = transaction.objectStore(TABLE);
      for (const row of changed) store.put(row, `${RECORD_PREFIX}${row.id}`);
      for (const id of removed) store.delete(`${RECORD_PREFIX}${id}`);
      for (const sourceId of unusedSources) store.delete(`source:${sourceId}`);
      store.delete('records');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    lastSaved = current;
  } finally {
    database.close();
  }
}

export async function saveOriginalSource(pictureId: string, photo: Blob): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TABLE, 'readwrite');
      transaction.objectStore(TABLE).put(photo, `source:${pictureId}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
