/**
 * Offline speech to text: Whisper tiny (English), run on this device. The model is downloaded once (about 43 MB) and kept in the app,
 * after that nothing is sent anywhere. Audio is never stored. Worker termination cancels loading or listening without touching any data.
 */
import { env, pipeline } from '@huggingface/transformers';
/** One absolute key for the "model is downloaded" marker. A relative key resolves differently in the page and in the worker. */
const VOICE_READY_KEY = 'https://retaillens.invalid/voice-ready';
const MODEL = 'onnx-community/whisper-tiny.en';
const REVISION = '794207fec2761281fe63a23a94b7e9f53a4efbc1'; // pinned: the same files every time (Apache-2.0)
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
type Recognizer = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
let recognizer: Recognizer | undefined;
const worker = self as unknown as { postMessage: (message: unknown) => void; onmessage: ((event: MessageEvent) => void) | null };
worker.onmessage = async event => {
  try {
    env.customCache = await caches.open('retaillens-voice-v1');
    if (!recognizer) {
      worker.postMessage({ type: 'status', text: 'Loading the voice model on this device…' });
      recognizer = await pipeline('automatic-speech-recognition', MODEL, { revision: REVISION, dtype: 'q8', device: 'wasm', progress_callback: (progress: unknown) => {
        const p = progress as { status?: string; progress?: number };
        if (p.status === 'progress') worker.postMessage({ type: 'status', text: `Downloading voice model · ${Math.round(p.progress || 0)}% of current file` });
      } }) as unknown as Recognizer;
      await (await caches.open('retaillens-voice-v1')).put(VOICE_READY_KEY, new Response('1'));
    }
    if (event.data.type === 'load') { worker.postMessage({ type: 'ready' }); return; } // answers every time, also when it was loaded before
    worker.postMessage({ type: 'status', text: 'Understanding what you said…' });
    const result = await recognizer(event.data.audio as Float32Array, { chunk_length_s: 30, return_timestamps: false });
    worker.postMessage({ type: 'result', text: String((Array.isArray(result) ? result[0] : result)?.text || '') });
  } catch (error) {
    recognizer = undefined;
    worker.postMessage({ type: 'error', text: error instanceof Error ? error.message : 'The voice model is not available. Typing still works.' });
  }
};
