import { useState } from 'react';
import { aiUsedToday, clearAiSettings, DAILY_AI_LIMIT, maskKey, readAiSettings, saveAiSettings, type AiMode, type AiSettings } from './agent/llm-settings';
import { buildAiContext } from './agent/llm-context';
import { AiError, aiMessage, complete, listModels, PROVIDER_IDS, PROVIDER_INFO, pickModel, type Provider } from './agent/providers';
import { clearConvo } from './agent/convo';
import type { RetailCtx } from './retail/ui-helpers';

/** The AI agent settings (shown in the full assistant: Settings > Local AI & model settings > AI agent). Off by default; nothing is sent until it is switched on. */
const callFetch = (url: string, init: Parameters<typeof fetch>[1]) => fetch(url, init);

export function AiBrainSettings(ctx: RetailCtx) {
  const [s, setS] = useState<AiSettings>(() => readAiSettings()), [keyDraft, setKeyDraft] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState('');
  const save = (next: AiSettings) => setS(saveAiSettings(next));
  const info = PROVIDER_INFO[s.provider];
  const test = async () => {
    const key = keyDraft.trim() || s.key;
    if (key.length < 20) { setNote('Paste your API key first.'); return; }
    setBusy(true); setNote('Checking the key…');
    try {
      const model = pickModel(s.provider, await listModels(s.provider, key, callFetch));
      if (!model) { setNote(s.provider === 'openrouter' ? 'The key works, but no free (":free") text model was found for it. Nothing was saved.' : 'The key works, but no suitable text model was found for it. Nothing was saved.'); return; }
      await complete({ provider: s.provider, key, model, system: 'Reply with JSON only.', turns: [{ role: 'user', text: 'Reply {"action":"reply","text":"ok"}' }], fetchImpl: callFetch, timeoutMs: 25000, maxTokens: 50 });
      save({ ...s, key, model }); setKeyDraft(''); setNote(`Connected to ${info.label}. Model: ${model}. Switch “Use the AI agent” on to start.`);
    } catch (e) { setNote(e instanceof AiError ? aiMessage(e.kind) : aiMessage('unexpected')); } finally { setBusy(false); }
  };
  const showSent = () => setPreview(buildAiContext(ctx.latest?.() || ctx.state, ctx.latestRecords?.() || ctx.records, ctx.latestPeople?.() || ctx.people, ctx.today, { shareNames: s.shareNames }).text);
  const ready = s.key.length >= 20 && !!s.model;
  return <details className="retail-card ai-brain">
    <summary><strong>AI agent (optional){s.enabled ? ' · on' : ' · off'}</strong></summary>
    <p className="settings-help">Chat naturally: typos, half sentences and follow-ups are understood, and the agent can look things up and propose changes across the app (stock, giving, targets, reports, people, leave, routines, settings). It <b>never changes anything itself</b>: you see a step-by-step plan, press Approve, and every step is saved, checked and can be undone. Removals still need press-and-hold or CONFIRM. If it is off, or there is no internet or allowance, the built-in assistant answers instead.</p>
    <label className="plan-swap">Provider<select value={s.provider} onChange={e => { setKeyDraft(''); save({ ...s, provider: e.target.value as Provider, key: '', model: '', enabled: false }); setNote('Provider changed. Paste that provider’s key and press Test & save key.'); }}>{PROVIDER_IDS.map(p => <option key={p} value={p}>{PROVIDER_INFO[p].label}</option>)}</select></label>
    <p className="settings-help"><b>Privacy:</b> only a short summary (counts and targets) is sent, never IMEIs, photos or files. People appear as “Person A, Person B…” unless you choose to share names. {info.note} Free key: {info.signup}.</p>
    <label className="plan-swap">API key<input type="password" autoComplete="off" spellCheck={false} placeholder={s.key ? `Saved: ${maskKey(s.key)}` : 'Paste your key'} value={keyDraft} onChange={e => setKeyDraft(e.target.value)} /></label>
    <div className="share-toolbar">
      <button type="button" className="primary" disabled={busy} onClick={() => void test()}>{ready ? 'Test connection again' : 'Test & save key'}</button>
      <button type="button" className="subtle-btn" disabled={!s.key} onClick={() => { clearAiSettings(); clearConvo(); setS(readAiSettings()); setKeyDraft(''); setNote('The key and the saved conversation were removed from this phone. The AI agent is off.'); }}>Remove key</button>
    </div>
    <label className="practice-choice"><input type="checkbox" checked={s.enabled} disabled={!ready} onChange={e => save({ ...s, enabled: e.target.checked })} />Use the AI agent</label>
    <label className="plan-swap">When to use it<select value={s.mode} onChange={e => save({ ...s, mode: e.target.value as AiMode })}><option value="always">Every message (best conversation and follow-ups)</option><option value="unsure">Only when the built-in assistant does not understand</option></select></label>
    <label className="practice-choice"><input type="checkbox" checked={s.memory} onChange={e => { save({ ...s, memory: e.target.checked }); if (!e.target.checked) clearConvo(); }} />Remember the recent conversation (on this phone, 24 hours, no IMEIs)</label>
    <label className="practice-choice"><input type="checkbox" checked={s.shareNames} onChange={e => save({ ...s, shareNames: e.target.checked })} />Share real people’s names with the AI (off = “Person A”)</label>
    <div className="share-toolbar"><button type="button" className="plan-link" onClick={showSent}>Show exactly what would be sent</button><button type="button" className="plan-link" onClick={() => { clearConvo(); setNote('The saved conversation was cleared.'); }}>Clear the conversation</button></div>
    {preview && <pre className="assistant-output" aria-label="Data that would be sent">{preview}</pre>}
    <p className="settings-help">Today: {aiUsedToday(ctx.today)} of {DAILY_AI_LIMIT} AI requests used (a safety limit). The key is stored only on this phone, not in backups or exports.</p>
    {note && <p role="status">{note}</p>}
  </details>;
}
