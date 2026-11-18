import { useEffect, useRef, useState } from 'react';
import { deviceRamGb } from './capacity';
import { eligibleStored } from './retail/planning';
import { monthOf, type PlanRequest } from './retail/types';
import { segmentOf } from './retail/catalog';
import type { RetailCtx } from './retail/ui-helpers';

const CACHE = 'retaillens-local-ai-v1';
export function LocalAISettings({ open }: { open: () => void }) {
  return <section className="settings-section"><h3>Local AI</h3><p className="settings-help">Optional on-device planning assistant. Download or remove its model in Plan. Your calculations work without AI.</p><button type="button" className="subtle-btn" onClick={open}>Local AI & model settings</button></section>;
}
export function LocalAI({ ctx, onDraft }: { ctx: RetailCtx; onDraft: (request: Partial<PlanRequest>) => void }) {
  const [prompt, setPrompt] = useState('Help me reach 70% today and spread the remaining releases through this month.');
  const [status, setStatus] = useState('Model is optional. It runs locally after download; speed depends on your phone.');
  const [busy, setBusy] = useState(false), [answer, setAnswer] = useState(''), [draft, setDraft] = useState<Partial<PlanRequest> | null>(null), [cached, setCached] = useState(false);
  const worker = useRef<Worker | null>(null);
  const stop = () => { worker.current?.terminate(); worker.current = null; setBusy(false); };
  useEffect(() => { if (typeof caches !== 'undefined') void caches.has(CACHE).then(async exists => { if (exists) setCached(!!(await (await caches.open(CACHE)).match('local-ai-ready'))); }); return () => { worker.current?.terminate(); }; }, []);
  const enabled = !!ctx.state.localAI?.enabled;
  const start = (loadOnly = false) => {
    if (!enabled) { setStatus('Enable local AI first. The model download is separate from the app.'); return; }
    if (typeof WebAssembly !== 'object' || !window.isSecureContext || typeof Worker === 'undefined' || typeof caches === 'undefined') { setStatus('Local AI is unavailable in this browser. Use the calculated planner, or try the Android app on a supported device.'); return; }
    if (deviceRamGb() < 4) { setStatus('This phone has less than 4 GB RAM. Use calculated planning; the optional model needs more memory.'); return; }
    setBusy(true); setAnswer(''); setDraft(null);
    if (!worker.current) {
      worker.current = new Worker(new URL('./local-ai.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onerror = () => { stop(); setStatus('The local model could not start. Calculated planning is still available.'); };
      worker.current.onmessage = e => {
        const data = e.data;
        if (data.type === 'status') setStatus(data.text);
        if (data.type === 'ready') { void caches.open(CACHE).then(cache => cache.put('local-ai-ready', new Response('ready'))); setCached(true); setStatus('Model loaded on this device.'); if (loadOnly) setBusy(false); }
        if (data.type === 'error') { stop(); setStatus(`Local AI unavailable: ${String(data.text).slice(0, 220)}`); }
        if (data.type === 'result') {
          setBusy(false);
          const first = Array.isArray(data.result) ? data.result[0]?.generated_text : '';
          const text = typeof first === 'string' ? first : Array.isArray(first) ? first.slice(-1)[0]?.content || '' : '';
          try {
            const match = text.match(/\{[\s\S]*\}/), parsed = JSON.parse(match?.[0] || '');
            const method = ['goal', 'points', 'spread', 'stored', 'quantity'].includes(parsed.method) ? parsed.method : 'goal';
            const value = Number(parsed.value), reserve = Number(parsed.reserve ?? 0);
            if (!Number.isFinite(value) || value < 0 || value > (method === 'quantity' ? 100000 : method === 'stored' ? 100 : 120) || !Number.isFinite(reserve) || reserve < 0) throw new Error('Invalid quantities');
            setAnswer(typeof parsed.explanation === 'string' ? parsed.explanation.slice(0, 1500) : 'Review this proposed calculation.');
            setDraft({ method, value, reserve: Math.floor(reserve), ...(typeof parsed.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.until) && parsed.until >= ctx.today && monthOf(parsed.until) === monthOf(ctx.today) ? { until: parsed.until } : {}) });
            setStatus('AI suggestion only. The next screen calculates and validates actual quantities.');
          } catch { setAnswer(text.slice(0, 1500)); setStatus('The AI did not return a valid plan. Use Create or adjust plan to enter your goal.'); }
        }
      };
    }
    const personId = ctx.state.settings.myPersonId || ctx.people[0]?.id || '';
    const target = ctx.state.targets[monthOf(ctx.today)]?.[personId];
    const stored: Record<string, number> = {};
    for (const r of eligibleStored(ctx.state, ctx.records).filter(r => !r.personId || r.personId === personId)) { const segment = segmentOf(ctx.state, r.model, monthOf(ctx.today), ctx.state.recordMeta[r.id]); stored[segment] = (stored[segment] || 0) + 1; }
    setStatus(cached ? 'Calculating locally…' : 'Downloading optional model files. You can cancel at any time.');
    worker.current.postMessage({ type: loadOnly ? 'load' : 'generate', prompt: JSON.stringify({ today: ctx.today, targets: target?.lines || [], stored, request: prompt }) });
  };
  return <div className="plan-local-ai"><p className="plan-alert">AI drafts suggestions. You review calculations, approve plans, and confirm releases yourself.</p><label className="plan-imei-choice"><input type="checkbox" checked={enabled} onChange={e => { if (!e.target.checked) stop(); ctx.change({ ...ctx.state, localAI: { enabled: e.target.checked } }, 'local AI preference'); }} />Enable optional on-device AI</label><p className="settings-help">Qwen 2.5 · 0.5B · 4-bit. Large download, potentially several hundred MB. Download over Wi-Fi. Your request and planning summary are processed here; no IMEIs or photos are sent to a model service.</p><div className="share-toolbar"><button className="subtle-btn" disabled={busy || !enabled} onClick={() => start(true)}>{cached ? 'Load downloaded model' : 'Download & check model'}</button><button className="plan-link" disabled={busy} onClick={() => { stop(); void caches.delete(CACHE).then(() => { setCached(false); setStatus('Downloaded AI model removed. Your plans and records are unchanged.'); }); }}>Remove model</button></div><label className="plan-swap">What would you like to plan?<textarea value={prompt} maxLength={1000} onChange={e => setPrompt(e.target.value)} /></label><div className="share-toolbar"><button className="primary" disabled={busy || !enabled || !prompt.trim()} onClick={() => start()}>Suggest a plan</button>{busy && <button className="subtle-btn" onClick={() => { stop(); setStatus('Cancelled. Your records and plans were not changed.'); }}>Cancel</button>}</div><p className="plan-ai-status" role="status">{status}</p>{answer && <div className="plan-ai-output">{answer}</div>}{draft && <button className="primary" onClick={() => onDraft(draft)}>Review calculated draft →</button>}</div>;
}
