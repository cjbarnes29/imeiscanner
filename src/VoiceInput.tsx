import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { fullCatalog } from './retail/catalog';
import { normalizeTranscript } from './voice-text';
import { VOICE_MODEL_MB, VoiceEngine, startRecording, voiceModelCached, voiceSupported, type Recording } from './voice';
import type { RetailCtx } from './retail/ui-helpers';

/** What the assistant already knows, so a mis-heard name or "Fold 6" can be put right: the people, and product codes such as Fold6. */
export function voiceVocabulary(ctx: Pick<RetailCtx, 'people' | 'state'>): { names: string[]; products: string[] } {
  const skip = new Set(['demo', 'test', 'person', 'promoter']);
  const names = ctx.people.flatMap(p => (p.name.match(/[A-Za-z]{4,}/g) || []).filter(w => !skip.has(w.toLowerCase())));
  let products: string[] = [];
  try { products = [...new Set(fullCatalog(ctx.state).flatMap(item => (String(item.name || '').match(/\b[A-Za-z]{3,}\d+\b/g) || [])))].slice(0, 300); } catch { products = []; }
  return { names, products };
}

type Phase = 'idle' | 'consent' | 'loading' | 'recording' | 'thinking';
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Speak instead of typing. The words are turned into text on this phone (Whisper tiny, English, offline after a one-time download).
 * The text goes into the question box so you can read and fix it first. Audio is never saved or sent anywhere.
 */
export function VoiceInput({ ctx, disabled, autoSend, onText }: { ctx: RetailCtx; disabled?: boolean; autoSend?: boolean; onText: (text: string, send: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('idle'), [seconds, setSeconds] = useState(0), [message, setMessage] = useState(''), [error, setError] = useState(''), [heard, setHeard] = useState('');
  const engine = useRef<VoiceEngine | null>(null), recording = useRef<Recording | null>(null), ticker = useRef<number | undefined>(undefined);
  const ensureEngine = () => engine.current ||= new VoiceEngine(setMessage);
  const stopTicker = () => { if (ticker.current !== undefined) window.clearInterval(ticker.current); ticker.current = undefined; };
  useEffect(() => () => { stopTicker(); recording.current?.cancel(); engine.current?.dispose(); }, []);

  const record = async () => {
    setError(''); setHeard('');
    try {
      recording.current = await startRecording(); setSeconds(0); setPhase('recording');
      ticker.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
    } catch (e) {
      setPhase('idle');
      setError(/denied|permission|notallowed/i.test(String((e as Error)?.name) + String((e as Error)?.message)) ? 'The microphone is off. Allow the microphone for AI LENS in Android settings, then try again.' : 'The microphone could not start. Typing still works.');
    }
  };
  const begin = async () => {
    setError(''); setHeard('');
    if (!voiceSupported()) { setError('Voice is not available on this device. Typing still works.'); return; }
    if (!(await voiceModelCached())) { setPhase('consent'); return; }
    await record();
  };
  const download = async () => {
    setPhase('loading'); setMessage('Starting the download…');
    try { await ensureEngine().load(); await record(); }
    catch (e) { setPhase('idle'); setError(`The voice model could not be loaded: ${(e as Error).message}. Check the internet once, or type instead.`); }
  };
  const stop = async () => {
    stopTicker(); const active = recording.current; recording.current = null; if (!active) return;
    setPhase('thinking'); setMessage('Understanding what you said…');
    try {
      const raw = await ensureEngine().transcribe(await active.stop());
      const { names, products } = voiceVocabulary(ctx), text = normalizeTranscript(raw, names, products);
      if (!text) { setError('I did not hear anything. Move closer to the phone and try again.'); setPhase('idle'); return; }
      setHeard(text); setPhase('idle'); onText(text, !!autoSend);
    } catch (e) { setPhase('idle'); setError(`I could not understand the recording: ${(e as Error).message}. Typing still works.`); }
  };
  const cancel = () => { stopTicker(); recording.current?.cancel(); recording.current = null; setPhase('idle'); };

  return <div className="voice-input">
    {phase === 'idle' && <button type="button" className="plan-link voice-btn" aria-label="Speak to the assistant" disabled={disabled} onClick={() => void begin()}><Mic size={16} aria-hidden="true" /> Speak</button>}
    {phase === 'consent' && <div className="voice-consent" role="group" aria-label="Voice download"><p className="settings-help">Voice understanding needs a one-time download of about {VOICE_MODEL_MB} MB. After that it works offline. Your voice is never saved or sent anywhere: only the text is kept.</p><div className="share-toolbar"><button type="button" className="primary" onClick={() => void download()}>Download and speak</button><button type="button" className="plan-link" onClick={() => setPhase('idle')}>Cancel</button></div></div>}
    {phase === 'loading' && <p className="settings-help" role="status" aria-live="polite">{message || 'Loading the voice model…'}</p>}
    {phase === 'recording' && <div className="voice-recording" role="group" aria-label="Recording"><span className="voice-dot" aria-hidden="true" /><strong role="timer">Listening · {clock(seconds)}</strong><div className="share-toolbar"><button type="button" className="primary" onClick={() => void stop()}>Stop and understand</button><button type="button" className="plan-link" onClick={cancel}>Cancel</button></div></div>}
    {phase === 'thinking' && <p className="settings-help" role="status" aria-live="polite">{message || 'Understanding what you said…'}</p>}
    {error && <p role="alert" className="plan-alert">{error}</p>}
    {heard && !autoSend && <p className="voice-heard settings-help">Heard: “{heard}”. Edit it if needed, then press Get answer.</p>}
  </div>;
}
