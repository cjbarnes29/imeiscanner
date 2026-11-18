/** Optional on-device model. Worker termination cancels loading/inference without touching retail data. */
import { env, pipeline } from '@huggingface/transformers';
const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e';
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
type Generator = (messages: { role: string; content: string }[], options: Record<string, unknown>) => Promise<unknown>;
let generator: Generator | undefined;
const worker = self as unknown as { postMessage: (message: unknown) => void; onmessage: ((event: MessageEvent) => void) | null };
worker.onmessage = async event => {
  try {
    env.customCache = await caches.open('retaillens-local-ai-v1');
    if (!generator) {
      worker.postMessage({ type: 'status', text: 'Loading the optional model on this device…' });
      generator = await pipeline('text-generation', MODEL, { revision: REVISION, dtype: 'q4', device: 'wasm', progress_callback: (progress: unknown) => {
        const p = progress as { status?: string; progress?: number };
        if (p.status === 'progress') worker.postMessage({ type: 'status', text: `Downloading model · ${Math.round(p.progress || 0)}% of current file` });
      } }) as unknown as Generator;
      worker.postMessage({ type: 'ready' });
    }
    if (event.data.type === 'load') return;
    const result = await generator([
      { role: 'system', content: 'You help plan phone releases. Use only the supplied summary. No IMEIs or photos are supplied. You cannot approve actions. Respond with ONLY JSON: {"explanation":"short helpful explanation", "method":"goal", "value":70, "reserve":0, "until":"YYYY-MM-DD"}. Valid methods: goal, points, spread, stored, quantity. value must be between 0 and 120 except quantity. Never claim a release or report happened. Calculations will be validated by the app.' },
      { role: 'user', content: String(event.data.prompt || '').slice(0, 7000) }
    ], { max_new_tokens: 220, do_sample: false, return_full_text: false });
    worker.postMessage({ type: 'result', result });
  } catch (error) { worker.postMessage({ type: 'error', text: error instanceof Error ? error.message : 'Local model unavailable. The calculated planner still works.' }); generator = undefined; }
};
