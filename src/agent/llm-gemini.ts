/**
 * Google Gemini adapter (the only provider so far). The API key goes in a header, never in the web address, and never into an error message.
 * Network calls happen only when the person has switched the AI brain on and asks something the offline assistant did not understand,
 * or presses Test connection. The `fetch` function is passed in, so tests run with a simulated server and no network.
 */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type AiFailure = 'bad-key' | 'limit' | 'network' | 'timeout' | 'blocked' | 'unexpected';
export class AiError extends Error { constructor(public kind: AiFailure, message: string) { super(message); } }

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MESSAGES: Record<AiFailure, string> = {
  'bad-key': 'The AI key was not accepted. Check it in Settings > Local AI & model settings > AI brain.',
  limit: 'The free AI allowance is used up for now (it resets later). Nothing was changed.',
  network: 'Could not reach the AI service. Check the internet connection. Nothing was changed.',
  timeout: 'The AI took too long to answer. Nothing was changed.',
  blocked: 'The AI declined to answer that. Nothing was changed.',
  unexpected: 'The AI gave an answer I could not read. Nothing was changed.'
};
export const aiMessage = (kind: AiFailure) => MESSAGES[kind];

async function call(f: FetchLike, url: string, key: string, body: unknown | null, timeoutMs: number) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await f(url, { method: body ? 'POST' : 'GET', headers: { 'x-goog-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller?.signal });
    if (!res.ok) throw new AiError(res.status === 400 || res.status === 401 || res.status === 403 ? 'bad-key' : res.status === 429 ? 'limit' : 'unexpected', MESSAGES[res.status === 400 || res.status === 401 || res.status === 403 ? 'bad-key' : res.status === 429 ? 'limit' : 'unexpected']);
    return await res.json();
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError((e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network', MESSAGES[(e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network']);
  } finally { if (timer) clearTimeout(timer); }
}

/** One question in, the model's text out. JSON output is requested; the caller still validates it. */
export async function geminiGenerate(o: { key: string; model: string; system: string; user: string; fetchImpl: FetchLike; timeoutMs?: number }): Promise<string> {
  const data = await call(o.fetchImpl, `${BASE}/models/${encodeURIComponent(o.model)}:generateContent`, o.key, {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: 'user', parts: [{ text: o.user }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json' }
  }, o.timeoutMs ?? 20000) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  if (data?.promptFeedback?.blockReason) throw new AiError('blocked', MESSAGES.blocked);
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text.trim()) throw new AiError(data?.candidates?.[0]?.finishReason === 'SAFETY' ? 'blocked' : 'unexpected', MESSAGES[data?.candidates?.[0]?.finishReason === 'SAFETY' ? 'blocked' : 'unexpected']);
  return text;
}

/** Models this key can use for text answers. */
export async function geminiModels(key: string, fetchImpl: FetchLike, timeoutMs = 15000): Promise<string[]> {
  const data = await call(fetchImpl, `${BASE}/models?pageSize=200`, key, null, timeoutMs) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  return (data?.models || []).filter(m => m.name && (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''));
}

/** Prefers a fast, small "flash-lite" model (the cheapest and the one free plans allow most of), then "flash"; never preview, audio, image or "thinking-only" variants. */
export function pickModel(models: string[]): string {
  const ok = models.filter(m => /^gemini-[\d.]+-flash/.test(m) && !/(preview|tts|audio|live|image|transcribe|translate|native|thinking|embedding|exp)/.test(m));
  const rank = (m: string) => (/flash-lite/.test(m) ? 0 : 1) * 1000 - (Number(m.match(/^gemini-([\d.]+)/)?.[1]) || 0) * 10;
  return [...ok].sort((a, b) => rank(a) - rank(b))[0] || '';
}
