/**
 * Optional AI brain settings. OFF by default. Kept in this phone's local storage under one key, NOT in the retail data, so the API key is never part of a
 * backup, an export, the audit log, a receipt or a diagnostics file. Nothing here makes a network call.
 */
export const AI_KEY = 'imei-lens-ai-v1';
export const AI_USAGE_KEY = 'imei-lens-ai-usage-v1';
export const DAILY_AI_LIMIT = 40;

export type AiSettings = { enabled: boolean; provider: 'gemini'; model: string; key: string; shareNames: boolean };
export const DEFAULT_AI: AiSettings = { enabled: false, provider: 'gemini', model: '', key: '', shareNames: false };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** Only the exact shape is accepted; anything odd falls back to "off". */
export function cleanAiSettings(raw: unknown): AiSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const key = typeof v.key === 'string' ? v.key.trim().slice(0, 200) : '';
  const model = typeof v.model === 'string' && /^[a-z0-9][a-z0-9._-]{1,80}$/i.test(v.model) ? v.model : '';
  return { enabled: v.enabled === true && key.length >= 20 && !!model, provider: 'gemini', model, key, shareNames: v.shareNames === true };
}
export function readAiSettings(s: Store | null = store()): AiSettings {
  try { return cleanAiSettings(JSON.parse(s?.getItem(AI_KEY) || '{}')); } catch { return { ...DEFAULT_AI }; }
}
export function saveAiSettings(next: AiSettings, s: Store | null = store()): AiSettings {
  const clean = cleanAiSettings(next);
  try { s?.setItem(AI_KEY, JSON.stringify(clean)); } catch { /* storage full or blocked: stays off */ }
  return clean;
}
export function clearAiSettings(s: Store | null = store()) { try { s?.removeItem(AI_KEY); s?.removeItem(AI_USAGE_KEY); } catch { /* nothing to clear */ } }
/** The brain is only used when it is switched on AND a key and model are saved. */
export const aiReady = (s: AiSettings) => s.enabled && s.key.length >= 20 && !!s.model;
export const maskKey = (key: string) => key.length < 10 ? '' : `${key.slice(0, 4)}…${key.slice(-3)}`;

/** A small daily budget so a loop or a mistake can never run up requests (free plans have limits too). */
export function spendAiBudget(today: string, s: Store | null = store(), limit = DAILY_AI_LIMIT): { ok: boolean; used: number } {
  let used = 0;
  try { const v = JSON.parse(s?.getItem(AI_USAGE_KEY) || '{}'); used = v.day === today && Number.isFinite(v.used) ? v.used : 0; } catch { used = 0; }
  if (used >= limit) return { ok: false, used };
  try { s?.setItem(AI_USAGE_KEY, JSON.stringify({ day: today, used: used + 1 })); } catch { /* ignore */ }
  return { ok: true, used: used + 1 };
}
export function aiUsedToday(today: string, s: Store | null = store()): number {
  try { const v = JSON.parse(s?.getItem(AI_USAGE_KEY) || '{}'); return v.day === today && Number.isFinite(v.used) ? v.used : 0; } catch { return 0; }
}
