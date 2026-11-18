import { clipAudio, isSilent, MAX_VOICE_SECONDS, SAMPLE_RATE, toMono16k } from './voice-text';

/** Voice input, browser part: record the microphone, hand the audio to the offline model, return text. Nothing is stored or uploaded. */
export const VOICE_MODEL_MB = 43;
const CACHE = 'retaillens-voice-v1';
const READY_KEY = 'https://retaillens.invalid/voice-ready'; // the same absolute key the worker writes

export async function voiceModelCached(): Promise<boolean> {
  try { return typeof caches !== 'undefined' && await caches.has(CACHE) && !!(await (await caches.open(CACHE)).match(READY_KEY)); } catch { return false; }
}
/** Frees the downloaded model (about 43 MB). It downloads again the next time voice is used. */
export async function removeVoiceModel(): Promise<void> { try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* nothing to remove */ } }

export const voiceSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && typeof Worker !== 'undefined';

/** One recording. `stop()` resolves with 16 kHz mono audio; `cancel()` throws the audio away. The microphone is released either way. */
export type Recording = { stop: () => Promise<Float32Array>; cancel: () => void };
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream), chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const release = () => stream.getTracks().forEach(track => track.stop());
  const timer = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, MAX_VOICE_SECONDS * 1000); // a forgotten recording ends by itself
  recorder.start(250);
  return {
    stop: () => new Promise<Float32Array>((resolve, reject) => {
      window.clearTimeout(timer);
      const finish = async () => {
        release();
        try {
          const context = new AudioContext({ sampleRate: SAMPLE_RATE }), decoded = await context.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
          void context.close();
          resolve(clipAudio(toMono16k(Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)), decoded.sampleRate)));
        } catch (error) { reject(error); }
      };
      if (recorder.state === 'inactive') void finish(); else { recorder.onstop = () => void finish(); recorder.stop(); }
    }),
    cancel: () => { window.clearTimeout(timer); recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); release(); }
  };
}

/** The speech model in a worker. Create one, `load()` it (downloads once), `transcribe()` clips, `dispose()` to free the memory. */
export class VoiceEngine {
  private worker: Worker | null = null;
  private onStatus: (text: string) => void;
  constructor(onStatus: (text: string) => void = () => {}) { this.onStatus = onStatus; }
  private start() { return this.worker ||= new Worker(new URL('./voice.worker.ts', import.meta.url), { type: 'module' }); }
  private ask(message: Record<string, unknown>, until: 'ready' | 'result'): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = this.start();
      const handle = (event: MessageEvent) => {
        const data = event.data as { type: string; text?: string };
        if (data.type === 'status') this.onStatus(data.text || '');
        else if (data.type === 'error') { worker.removeEventListener('message', handle); reject(new Error(data.text || 'Voice failed.')); }
        else if (data.type === until) { worker.removeEventListener('message', handle); resolve(data.text || ''); }
      };
      worker.addEventListener('message', handle);
      worker.postMessage(message);
    });
  }
  load() { return this.ask({ type: 'load' }, 'ready'); }
  async transcribe(audio: Float32Array): Promise<string> {
    if (isSilent(audio)) return '';
    await this.load();
    return this.ask({ type: 'transcribe', audio }, 'result');
  }
  dispose() { this.worker?.terminate(); this.worker = null; }
}
