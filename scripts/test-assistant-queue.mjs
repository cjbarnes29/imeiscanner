// The assistant's request queue (src/AssistantReview.tsx): a request is only reported as "saved" when it really was saved. With 20 requests already waiting
// on Home, a new one must be refused (nothing changed) and the chat must be told so. Synthetic data only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: "export { queueAssistant, saveAssistantHistory } from './src/AssistantReview'; export { emptyState } from './src/retail/data';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-assistant-queue-'));
const file = join(dir, 'assistant.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { queueAssistant, saveAssistantHistory, emptyState } = await import(pathToFileURL(file).href);

const pendingRequest = n => ({ id: 'r' + n, at: '2026-11-18T08:00:00.000Z', text: 'give 4 Fold6 to Asha', output: 'x', status: 'pending' });
const makeCtx = (pending, extra = {}) => {
  const calls = { change: [], notify: [] };
  let state = { ...emptyState(), assistantRequests: Array.from({ length: pending }, (_, i) => pendingRequest(i)), ...extra };
  const ctx = { state, latest: () => state, change: next => { state = next; calls.change.push(next); }, notify: text => calls.notify.push(text), records: [], people: [{ id: 'p1', name: 'Asha Test' }], today: '2026-11-18' };
  return { ctx, calls, get state() { return state; } };
};

// 1. room in the queue: it is saved and the id comes back
{
  const t = makeCtx(0);
  const id = saveAssistantHistory(t.ctx, 'what is my report', 'answer', 'pending');
  assert.equal(typeof id, 'string'); assert.ok(id.length > 8);
  assert.equal(t.calls.change.length, 1); assert.equal(t.state.assistantRequests.length, 1); assert.equal(t.state.assistantRequests[0].id, id); assert.equal(t.state.assistantRequests[0].status, 'pending');
}
// 2. 20 waiting: a new pending request is refused, nothing changes, the person is told
{
  const t = makeCtx(20);
  assert.equal(saveAssistantHistory(t.ctx, 'one more', 'answer', 'pending'), null, 'refused');
  assert.equal(t.calls.change.length, 0, 'nothing was saved'); assert.equal(t.state.assistantRequests.length, 20);
  assert.match(t.calls.notify.join(' '), /Review or reject some pending assistant requests first\. Nothing was changed\./);
}
// 3. a plain answer is still saved when the pending list is full (only pending requests are limited)
{
  const t = makeCtx(20);
  const id = saveAssistantHistory(t.ctx, 'what can you do', 'answer', 'answered');
  assert.equal(typeof id, 'string'); assert.equal(t.state.assistantRequests.length, 21);
}
// 4. the history keeps the latest 100 only
{
  const t = makeCtx(0, { assistantRequests: Array.from({ length: 100 }, (_, i) => ({ ...pendingRequest(i), status: 'answered' })) });
  saveAssistantHistory(t.ctx, 'newest', 'answer', 'answered');
  assert.equal(t.state.assistantRequests.length, 100); assert.equal(t.state.assistantRequests.at(-1).text, 'newest');
}
// 5. queueAssistant tells the truth: a request that needs review is NOT "saved" when the list is full
{
  const full = makeCtx(20);
  const refused = queueAssistant(full.ctx, 'give 4 Fold6 to Nobody Known');
  assert.ok(refused, 'the request was understood as an action: ' + JSON.stringify(refused));
  assert.equal(refused.pending, true, 'it needs review'); assert.equal(refused.saved, false, 'but it was not saved because 20 are waiting');
  assert.equal(full.calls.change.length, 0);
  const room = makeCtx(0);
  const accepted = queueAssistant(room.ctx, 'give 4 Fold6 to Nobody Known');
  assert.equal(accepted.pending, true); assert.equal(accepted.saved, true); assert.equal(room.state.assistantRequests.length, 1);
  assert.equal(queueAssistant(makeCtx(0).ctx, 'zzzz qqqq unrelated words'), null, 'something that is not a supported request is not queued');
}
console.log('assistant queue ok');
