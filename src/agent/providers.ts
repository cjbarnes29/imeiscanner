/**
 * AI providers (free tiers first): Google Gemini, OpenRouter (free ":free" models) and Groq. One small interface: a system prompt plus the conversation so far in,
 * the model's JSON text out. Keys travel in a header, never in the web address and never in an error message. `fetchImpl` is passed in, so tests run with a
 * simulated server and no network. Nothing here is called unless the person switched the AI agent on.
 */
export type Provider = 'gemini' | 'openrouter' | 'groq';
export const PROVIDER_IDS: Provider[] = ['gemini', 'openrouter', 'groq'];
export const PROVIDER_INFO: Record<Provider, { label: string; signup: string; note: string }> = {
  gemini: { label: 'Google Gemini', signup: 'aistudio.google.com', note: 'Free key. On the free plan Google may use what is sent to improve its products.' },
  openrouter: { label: 'OpenRouter (free models)', signup: 'openrouter.ai/keys', note: 'Free models carry ":free" in their name. Free models may log prompts, depending on the model owner.' },
  groq: { label: 'Groq', signup: 'console.groq.com/keys', note: 'Free tier with daily limits. Fast.' }
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; headers?: { get: (name: string) => string | null } }>;
export type Turn = { role: 'user' | 'assistant'; text: string };
export type AiFailure = 'bad-key' | 'limit' | 'network' | 'timeout' | 'blocked' | 'unexpected';
export class AiError extends Error { constructor(public kind: AiFailure, message: string) { super(message); } }

const MESSAGES: Record<AiFailure, string> = {
  'bad-key': 'The AI key was not accepted. Check it in Settings > Local AI & model settings > AI agent.',
  limit: 'The free AI allowance is used up for now (it resets later). I used the built-in assistant instead.',
  network: 'Could not reach the AI service. I used the built-in assistant instead.',
  timeout: 'The AI took too long to answer. I used the built-in assistant instead.',
  blocked: 'The AI declined to answer that. Nothing was changed.',
  unexpected: 'The AI gave an answer I could not read. I used the built-in assistant instead.'
};
export const aiMessage = (kind: AiFailure) => MESSAGES[kind];
const fail = (kind: AiFailure) => new AiError(kind, MESSAGES[kind]);
/** After a "too many requests" answer nothing more is sent until the provider's wait time (or 30 s) has passed, so a used-up free allowance is never hammered. */
let cooldownUntil = 0;
export const aiCooldownSeconds = (now = Date.now()) => Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
export const resetAiCooldown = () => { cooldownUntil = 0; };
const kindOfStatus = (status: number): AiFailure => status === 400 || status === 401 || status === 403 ? 'bad-key' : status === 429 ? 'limit' : 'unexpected';

async function http(f: FetchLike, url: string, headers: Record<string, string>, body: unknown | null, timeoutMs: number): Promise<unknown> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await f(url, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller?.signal });
    if (!res.ok) {
      if (res.status === 429) { const wait = Number(res.headers?.get('retry-after')); cooldownUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 600) : 30) * 1000; }
      throw fail(kindOfStatus(res.status));
    }
    return await res.json();
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw fail((e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');
  } finally { if (timer) clearTimeout(timer); }
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE: Record<'openrouter' | 'groq', string> = { openrouter: 'https://openrouter.ai/api/v1', groq: 'https://api.groq.com/openai/v1' };

export type CompleteOptions = { provider: Provider; key: string; model: string; system: string; turns: Turn[]; fetchImpl: FetchLike; timeoutMs?: number; maxTokens?: number };

/**
 * Gemini. Google now recommends the Interactions API (one text input plus a separate system instruction, the answer at steps[].content[].text) and calls the older
 * generateContent format "legacy". The Interactions API is tried first; if it fails for any reason other than a bad key or a used-up allowance (unknown format, blocked
 * in the browser, a service error), the older format is tried once, and whichever works is remembered for the rest of the session. A conversation is sent as one
 * plain transcript, so no provider-specific turn format is needed.
 */
let geminiRoute: 'interactions' | 'legacy' = 'interactions';
export const resetGeminiRoute = () => { geminiRoute = 'interactions'; };
export const setGeminiRoute = (route: 'interactions' | 'legacy') => { geminiRoute = route; }; // for tests
export const currentGeminiRoute = () => geminiRoute;

function transcript(turns: Turn[]): string {
  if (turns.length === 1) return turns[0].text;
  return turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n\n') + '\n\nReply now as the Assistant, with the JSON object only.';
}
async function geminiInteractions(o: CompleteOptions, timeout: number, maxTokens: number): Promise<string> {
  const data = await http(o.fetchImpl, `${GEMINI}/interactions`, { 'x-goog-api-key': o.key }, {
    model: o.model, input: transcript(o.turns), system_instruction: o.system, store: false,
    generation_config: { max_output_tokens: Math.max(maxTokens, 1500) },
    response_format: { type: 'text', mime_type: 'application/json' }
  }, timeout) as { steps?: { type?: string; content?: { type?: string; text?: string }[]; text?: string }[]; output_text?: string; status?: string };
  const fromSteps = (data?.steps || []).filter(st => st?.type === 'model_output').map(st => (st.content || []).filter(c => c?.type === 'text').map(c => c.text || '').join('') || st.text || '').join('');
  const text = fromSteps || (typeof data?.output_text === 'string' ? data.output_text : '');
  if (!text.trim()) throw fail('unexpected');
  return text;
}
async function geminiLegacy(o: CompleteOptions, timeout: number, maxTokens: number): Promise<string> {
  const data = await http(o.fetchImpl, `${GEMINI}/models/${encodeURIComponent(o.model)}:generateContent`, { 'x-goog-api-key': o.key }, {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: o.turns.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, responseMimeType: 'application/json' }
  }, timeout) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  if (data?.promptFeedback?.blockReason) throw fail('blocked');
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text.trim()) throw fail(data?.candidates?.[0]?.finishReason === 'SAFETY' ? 'blocked' : 'unexpected');
  return text;
}
async function geminiComplete(o: CompleteOptions, timeout: number, maxTokens: number): Promise<string> {
  if (geminiRoute === 'legacy') return geminiLegacy(o, timeout, maxTokens);
  try { return await geminiInteractions(o, timeout, maxTokens); }
  catch (e) {
    if (!(e instanceof AiError) || e.kind === 'bad-key' || e.kind === 'limit' || e.kind === 'timeout') throw e;
    const text = await geminiLegacy(o, timeout, maxTokens); // the new route did not work here: use the older one and remember that
    geminiRoute = 'legacy';
    return text;
  }
}
/** One model call. Returns the raw text; the caller validates it (the model is never trusted). */
export async function complete(o: CompleteOptions): Promise<string> {
  const timeout = o.timeoutMs ?? 25000, maxTokens = o.maxTokens ?? 900;
  if (aiCooldownSeconds() > 0) throw fail('limit'); // still waiting after a "too many requests" answer: do not ask again yet
  if (o.provider === 'gemini') return geminiComplete(o, timeout, maxTokens);
  const data = await http(o.fetchImpl, `${OPENAI_BASE[o.provider]}/chat/completions`, { authorization: `Bearer ${o.key}` }, {
    model: o.model, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: o.system }, ...o.turns.map(t => ({ role: t.role, content: t.text }))]
  }, timeout) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; error?: unknown };
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw fail(data?.choices?.[0]?.finish_reason === 'content_filter' ? 'blocked' : 'unexpected');
  return text;
}

/** Models this key can use for text answers. */
export async function listModels(provider: Provider, key: string, fetchImpl: FetchLike, timeoutMs = 15000): Promise<string[]> {
  if (provider === 'gemini') {
    const data = await http(fetchImpl, `${GEMINI}/models?pageSize=200`, { 'x-goog-api-key': key }, null, timeoutMs) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    return (data?.models || []).filter(m => m.name && (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''));
  }
  const data = await http(fetchImpl, `${OPENAI_BASE[provider]}/models`, { authorization: `Bearer ${key}` }, null, timeoutMs) as { data?: { id?: string }[] };
  return (data?.data || []).map(m => String(m.id || '')).filter(Boolean);
}

/** Picks a small, fast text model that the free tier allows; never audio, image, embedding, guard or preview models. */
export function pickModel(provider: Provider, models: string[]): string {
  const bad = /(preview|tts|audio|live|image|transcribe|translate|native|thinking|embed|exp|whisper|guard|vision|moderation|safeguard)/i;
  if (provider === 'gemini') {
    const ok = models.filter(m => /^gemini-[\d.]+-flash/.test(m) && !bad.test(m));
    const rank = (m: string) => (/flash-lite/.test(m) ? 0 : 1) * 1000 - (Number(m.match(/^gemini-([\d.]+)/)?.[1]) || 0) * 10;
    return [...ok].sort((a, b) => rank(a) - rank(b))[0] || '';
  }
  if (provider === 'groq') {
    const ok = models.filter(m => !bad.test(m));
    for (const re of [/llama-3\.3-70b/i, /llama-3\.1-8b/i, /llama/i, /qwen/i, /gemma/i, /mixtral|mistral/i]) { const hit = ok.find(m => re.test(m)); if (hit) return hit; }
    return ok[0] || '';
  }
  const free = models.filter(m => /:free$/.test(m) && !bad.test(m));
  for (const re of [/llama-3\.3-70b/i, /llama.*instruct|llama/i, /qwen/i, /gemma/i, /mistral/i, /deepseek/i]) { const hit = free.find(m => re.test(m)); if (hit) return hit; }
  return free[0] || '';
}
