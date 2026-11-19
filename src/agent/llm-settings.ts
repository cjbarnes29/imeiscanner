import { PROVIDER_IDS, type Provider } from './providers';

/**
 * AI agent settings. OFF by default. Kept in this phone's local storage under one key, NOT in the retail data, so the API key is never part of a backup,
 * an export, the audit log, a receipt or a diagnostics file. Nothing here makes a network call.
 */
export const AI_KEY = 'imei-lens-ai-v1';
export const AI_USAGE_KEY = 'imei-lens-ai-usage-v1';
export const DAILY_AI_LIMIT = 60;
/** Never more than this many AI requests in one minute (a loop or a fast typist cannot burn a free allowance). */
export const MINUTE_AI_LIMIT = 8;

/** mode "always": every message goes to the agent (best conversation, follow-ups). "unsure": the built-in assistant first, the agent only when it does not understand. */
export type AiMode = 'always' | 'unsure';
export type AiSettings = { enabled: boolean; provider: Provider; model: string; key: string; shareNames: boolean; mode: AiMode; memory: boolean };
export const DEFAULT_AI: AiSettings = { enabled: false, provider: 'gemini', model: '', key: '', shareNames: false, mode: 'always', memory: true };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** Only the exact shape is accepted; anything odd falls back to "off". */
export function cleanAiSettings(raw: unknown): AiSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const key = typeof v.key === 'string' ? v.key.trim().slice(0, 300) : '';
  const model = typeof v.model === 'string' && /^[a-z0-9][a-z0-9._:/-]{1,100}$/i.test(v.model) ? v.model : '';
  const provider = PROVIDER_IDS.includes(v.provider as Provider) ? v.provider as Provider : 'gemini';
  return { enabled: v.enabled === true && key.length >= 20 && !!model, provider, model, key, shareNames: v.shareNames === true, mode: v.mode === 'unsure' ? 'unsure' : 'always', memory: v.memory !== false };
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
/** The agent is only used when it is switched on AND a key and model are saved. */
export const aiReady = (s: AiSettings) => s.enabled && s.key.length >= 20 && !!s.model;
export const maskKey = (key: string) => key.length < 10 ? '' : `${key.slice(0, 4)}…${key.slice(-3)}`;

/** A small daily budget so a loop or a mistake can never run up requests (free plans have limits too). */
const recent: number[] = [];
export const resetMinuteBudget = () => { recent.length = 0; };
export function spendAiBudget(today: string, s: Store | null = store(), limit = DAILY_AI_LIMIT, now = Date.now()): { ok: boolean; used: number; reason?: 'minute' | 'day' } {
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= MINUTE_AI_LIMIT) return { ok: false, used: 0, reason: 'minute' };
  let used = 0;
  try { const v = JSON.parse(s?.getItem(AI_USAGE_KEY) || '{}'); used = v.day === today && Number.isFinite(v.used) ? v.used : 0; } catch { used = 0; }
  if (used >= limit) return { ok: false, used, reason: 'day' };
  try { s?.setItem(AI_USAGE_KEY, JSON.stringify({ day: today, used: used + 1 })); } catch { /* ignore */ }
  recent.push(now);
  return { ok: true, used: used + 1 };
}
export function aiUsedToday(today: string, s: Store | null = store()): number {
  try { const v = JSON.parse(s?.getItem(AI_USAGE_KEY) || '{}'); return v.day === today && Number.isFinite(v.used) ? v.used : 0; } catch { return 0; }
}
