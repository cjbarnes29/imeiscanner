/**
 * Saves the retail state in the same IndexedDB (imei-lens-v2, table "inventory") the scan records live in, under keys that start with "retail:".
 * The record loader only reads keys that start with "record:", so the two never meet and the scan data is never touched. Every change keeps the
 * state before it as a numbered snapshot (the last 8), which is what Undo and "Restore a snapshot" use. A damaged or missing value gives the
 * empty state. Storage failures are reported to the caller, so inaccessible data is never mistaken for a new installation.
 */
import { cleanState, emptyState } from './data';
import type { RetailState } from './types';

const DATABASE = 'imei-lens-v2', TABLE = 'inventory', STATE_KEY = 'retail:state', SNAP_PREFIX = 'retail:snapshot:', KEEP = 8;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const wrap = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

export async function loadRetail(): Promise<RetailState> {
  const db = await open();
  try { const value = await wrap(db.transaction(TABLE, 'readonly').objectStore(TABLE).get(STATE_KEY)); return value ? cleanState(value) : emptyState(); }
  finally { db.close(); }
}

export type Snapshot = { n: number; at: string; why: string; state: RetailState };

/** Writes the state; when `before` and `why` are given, the previous state is kept as a snapshot first (same transaction, so both or neither). */
export async function saveRetail(state: RetailState, before?: RetailState, why = 'change'): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TABLE, 'readwrite'), store = tx.objectStore(TABLE);
      const fail = (error: unknown) => { tx.abort(); reject(error); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      try {
        if (before) {
          const keys = store.getAllKeys(IDBKeyRange.bound(SNAP_PREFIX, `${SNAP_PREFIX}￿`));
          keys.onsuccess = () => {
            try {
              const existing = (keys.result as string[]).map(k => Number(k.slice(SNAP_PREFIX.length))).filter(Number.isFinite).sort((a, b) => a - b);
              const n = (existing[existing.length - 1] ?? 0) + 1;
              store.put({ n, at: new Date().toISOString(), why, state: before } satisfies Snapshot, `${SNAP_PREFIX}${String(n).padStart(8, '0')}`);
              for (const old of existing.slice(0, Math.max(0, existing.length + 1 - KEEP))) store.delete(`${SNAP_PREFIX}${String(old).padStart(8, '0')}`);
            } catch (error) { fail(error); }
          };
        }
        store.put(state, STATE_KEY);
      } catch (error) { fail(error); }
    });
  } finally { db.close(); }
}

/** Snapshots, newest first (the states before each recent change). */
export async function listSnapshots(): Promise<Snapshot[]> {
  try {
    const db = await open();
    try {
      const rows = await wrap(db.transaction(TABLE, 'readonly').objectStore(TABLE).getAll(IDBKeyRange.bound(SNAP_PREFIX, `${SNAP_PREFIX}￿`))) as Snapshot[];
      return rows.map(r => ({ n: r.n, at: String(r.at), why: String(r.why), state: cleanState(r.state) })).sort((a, b) => b.n - a.n);
    } finally { db.close(); }
  } catch { return []; }
}
