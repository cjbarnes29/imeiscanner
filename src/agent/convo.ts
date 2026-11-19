import { maskImeis } from './log';
import type { Turn } from './providers';

/**
 * The recent conversation, so "do the same for Bilal", "make it 5" and "and the other one" can be understood. Kept only on this phone (local storage, not the retail
 * data), IMEIs removed, at most 14 turns and 24 hours, and clearable at any time. Real names stay here; they are replaced by "Person A" only when a turn is sent.
 */
export const CONVO_KEY = 'imei-lens-convo-v1';
export const CONVO_MAX_TURNS = 14;
export const CONVO_MAX_AGE_MS = 24 * 3600 * 1000;
export type StoredTurn = Turn & { at: number };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function readConvo(now = Date.now(), s: Store | null = store()): StoredTurn[] {
  try {
    const list = JSON.parse(s?.getItem(CONVO_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((t): t is StoredTurn => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && typeof t.at === 'number' && now - t.at <= CONVO_MAX_AGE_MS && t.at <= now + 60000).slice(-CONVO_MAX_TURNS);
  } catch { return []; }
}
export function appendConvo(turn: Turn, now = Date.now(), s: Store | null = store()): StoredTurn[] {
  const text = maskImeis(turn.text).replace(/\b\d{15}\b/g, '[IMEI hidden]').slice(0, 600);
  const next = [...readConvo(now, s), { role: turn.role, text, at: now }].slice(-CONVO_MAX_TURNS);
  try { s?.setItem(CONVO_KEY, JSON.stringify(next)); } catch { /* storage full: the conversation just is not remembered */ }
  return next;
}
export function clearConvo(s: Store | null = store()) { try { s?.removeItem(CONVO_KEY); } catch { /* nothing to clear */ } }
