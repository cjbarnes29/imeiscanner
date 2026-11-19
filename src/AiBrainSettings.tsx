import { useState } from 'react';
import { aiUsedToday, clearAiSettings, DAILY_AI_LIMIT, maskKey, readAiSettings, saveAiSettings, type AiSettings } from './agent/llm-settings';
import { buildAiContext } from './agent/llm-context';
import { AiError, aiMessage, geminiGenerate, geminiModels, pickModel } from './agent/llm-gemini';
import type { RetailCtx } from './retail/ui-helpers';

/** Optional AI brain: off by default. Shown in the full assistant (Settings > Local AI & model settings). Nothing is sent until it is switched on and a question needs it. */
const callFetch = (url: string, init: Parameters<typeof fetch>[1]) => fetch(url, init);

export function AiBrainSettings(ctx: RetailCtx) {
  const [s, setS] = useState<AiSettings>(() => readAiSettings()), [keyDraft, setKeyDraft] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState('');
  const save = (next: AiSettings) => setS(saveAiSettings(next));
  const test = async () => {
    const key = keyDraft.trim() || s.key;
    if (key.length < 20) { setNote('Paste your API key first.'); return; }
    setBusy(true); setNote('Checking the key…');
    try {
      const models = await geminiModels(key, callFetch), model = pickModel(models);
      if (!model) { setNote('The key works, but no suitable text model was found for it. Nothing was saved.'); return; }
      await geminiGenerate({ key, model, system: 'Reply with JSON only.', user: 'Reply {"kind":"answer","text":"ok"}', fetchImpl: callFetch, timeoutMs: 20000 });
      save({ ...s, key, model, enabled: s.enabled });
      setKeyDraft(''); setNote(`Connected. Model: ${model}. Switch “Use the AI brain” on to start using it.`);
    } catch (e) { setNote(e instanceof AiError ? aiMessage(e.kind) : aiMessage('unexpected')); } finally { setBusy(false); }
  };
  const showSent = () => { const state = ctx.latest?.() || ctx.state; setPreview(buildAiContext(state, ctx.latestRecords?.() || ctx.records, ctx.latestPeople?.() || ctx.people, ctx.today, { shareNames: s.shareNames }).text); };
  const ready = s.key.length >= 20 && !!s.model;
  return <details className="retail-card ai-brain">
    <summary><strong>AI brain (optional){s.enabled ? ' · on' : ' · off'}</strong></summary>
    <p className="settings-help">When something you type is not understood by the built-in assistant, an online AI (Google Gemini) can answer questions about your app data or suggest ONE change for you to review. It never changes anything itself: you still see a preview and press Approve (removals still need press-and-hold or CONFIRM). Off by default.</p>
    <p className="settings-help"><b>Privacy:</b> only a short summary is sent (counts and targets). Never IMEIs, photos or files. People appear as “Person A, Person B…” unless you choose to share real names. On Google’s <b>free</b> plan, Google may use what is sent to improve its products; a paid key does not. Get a free key at aistudio.google.com (“Get API key”), then paste it here.</p>
    <label className="plan-swap">Gemini API key<input type="password" autoComplete="off" spellCheck={false} placeholder={s.key ? `Saved: ${maskKey(s.key)}` : 'Paste your key'} value={keyDraft} onChange={e => setKeyDraft(e.target.value)} /></label>
    <div className="share-toolbar">
      <button type="button" className="primary" disabled={busy} onClick={() => void test()}>{ready ? 'Test connection again' : 'Test & save key'}</button>
      <button type="button" className="subtle-btn" disabled={!s.key} onClick={() => { clearAiSettings(); setS(readAiSettings()); setKeyDraft(''); setNote('The key was removed from this phone. The AI brain is off.'); }}>Remove key</button>
    </div>
    <label className="practice-choice"><input type="checkbox" checked={s.enabled} disabled={!ready} onChange={e => save({ ...s, enabled: e.target.checked })} />Use the AI brain when the built-in assistant does not understand</label>
    <label className="practice-choice"><input type="checkbox" checked={s.shareNames} onChange={e => save({ ...s, shareNames: e.target.checked })} />Share real people’s names with the AI (off = “Person A”)</label>
    <div className="share-toolbar"><button type="button" className="plan-link" onClick={showSent}>Show exactly what would be sent</button></div>
    {preview && <pre className="assistant-output" aria-label="Data that would be sent">{preview}</pre>}
    <p className="settings-help">Today: {aiUsedToday(ctx.today)} of {DAILY_AI_LIMIT} AI requests used (a safety limit). The key is stored only on this phone, not in backups or exports.</p>
    {note && <p role="status">{note}</p>}
  </details>;
}
