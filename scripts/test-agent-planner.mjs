// Phase 5: duplicate guard, recovery of a task a closed app left half-way, checkpoint wording. Synthetic data only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export { queueAssistant } from './src/AssistantReview'; export { findDuplicateTask, findDuplicateRequest, recoverInterrupted, taskCheckpoint, INTERRUPTED, finishTask, newTask, patchStep } from './src/retail/assistant-tasks'; export { emptyState } from './src/retail/data'; export { splitSteps } from './src/retail/assistant-tasks'; export { suitableRoutine } from './src/retail/routines';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-agent-planner-'));
const file = join(dir, 'p.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const { queueAssistant, findDuplicateTask, findDuplicateRequest, recoverInterrupted, taskCheckpoint, INTERRUPTED, finishTask, newTask, patchStep, emptyState, splitSteps, suitableRoutine } = await import(pathToFileURL(file).href);

const now = '2026-11-19T10:00:00.000Z';
let n = 0; const sid = () => 's' + ++n;
const task = (text, mode = 'autopilot', steps = ['store 2 fold6', 'give 2 fold6 to asha']) => newTask('t' + ++n, text, mode, steps, now, sid);

// duplicate task: same words (case / punctuation ignored) while one is open; a finished one does not block a new start
{
  const t = { ...task('store 2 fold6, then give 2 fold6 to asha'), status: 'review' };
  const st = { ...emptyState(), assistantTasks: [t] };
  assert.equal(findDuplicateTask(st, 'Store 2 Fold6, then give 2 Fold6 to Asha!', 'autopilot')?.id, t.id);
  assert.equal(findDuplicateTask(st, t.text, 'assistant'), undefined, 'a task in another mode is not a copy');
  assert.equal(findDuplicateTask(st, 'store 3 fold6, then give 3 fold6 to asha', 'autopilot'), undefined, 'different numbers are a different task');
  assert.equal(findDuplicateTask({ ...st, assistantTasks: [{ ...t, status: 'done' }] }, t.text, 'autopilot'), undefined);
}

// duplicate request: the second identical ask reuses the waiting one; nothing is added
{
  const people = [{ id: 'p1', name: 'Asha' }];
  let st = { ...emptyState(), assistantRequests: [] };
  const ctx = { get state() { return st; }, latest: () => st, readOnly: false, today: '2026-11-19', notify() {}, records: [], latestRecords: () => [], people, latestPeople: () => people, change: next => { st = next; } };
  const a = queueAssistant(ctx, 'add 2 people zed and yan'); assert.ok(a.pending && a.id && !a.duplicate);
  const b = queueAssistant(ctx, 'Add 2 people Zed and Yan.'); assert.ok(b.duplicate && b.id === a.id && b.pending, 'the same request is not queued twice');
  assert.equal(st.assistantRequests.filter(r => r.status === 'pending').length, 1);
  assert.equal(findDuplicateRequest(st, 'add 2 people zed and yan')?.id, a.id);
  const c = queueAssistant(ctx, 'add 2 people zed and omar'); assert.ok(!c.duplicate && c.id !== a.id, 'a different request is queued normally');
}

// recovery: a step left "running" by a closed app goes back to pending, the task waits for a person, nothing resumes by itself
{
  let t = task('store 2 fold6, then give 2 fold6 to asha');
  t = patchStep(t, t.steps[0].id, { status: 'done', requestId: 'r1', doneAt: now }, now); t = patchStep(t, t.steps[1].id, { status: 'running', attempts: 1 }, now); t = finishTask(t, now);
  assert.equal(t.status, 'running');
  const st = { ...emptyState(), assistantTasks: [t] };
  assert.equal(recoverInterrupted(st, new Set([t.id]), now), st, 'a task a runner is working on is left alone');
  const back = recoverInterrupted(st, new Set(), now), r = back.assistantTasks[0];
  assert.equal(r.status, 'review'); assert.equal(r.steps[0].status, 'done', 'saved steps stay saved'); assert.equal(r.steps[1].status, 'pending'); assert.equal(r.steps[1].error, INTERRUPTED);
  assert.equal(recoverInterrupted(back, new Set(), now), back, 'nothing more to do the second time');
  const cp = taskCheckpoint(r); assert.ok(cp.canRollBack && cp.saved === 1 && cp.total === 2); assert.match(cp.line, /1 of 2 steps saved; stopped at “give 2 fold6 to asha”.*newest first/);
}

// checkpoint wording
{
  const fresh = task('x'); assert.deepEqual([taskCheckpoint(fresh).canRollBack, taskCheckpoint(fresh).line], [false, 'Nothing applied yet.']);
  let t = patchStep(fresh, fresh.steps[0].id, { status: 'done', requestId: 'r1' }, now); t = patchStep(t, t.steps[1].id, { status: 'failed', error: 'x' }, now);
  assert.match(taskCheckpoint(finishTask(t, now)).line, /1 of 2 steps saved; stopped at “give 2 fold6 to asha”/);
  const undone = finishTask(patchStep(patchStep(fresh, fresh.steps[0].id, { status: 'undone' }, now), fresh.steps[1].id, { status: 'skipped' }, now), now);
  assert.equal(undone.status, 'undone'); assert.equal(taskCheckpoint(undone).canRollBack, false);
}
// a routine is a plan: its saved sentence is run through the task runner, so several steps become several checked steps
{
  const text = "give 1 fold6 to asha, then prepare today's report";
  assert.ok(suitableRoutine(text), 'a multi-step sentence can be saved as a routine');
  assert.deepEqual(splitSteps(text), ['give 1 fold6 to asha', "prepare today's report"]);
}
console.log('agent planner: duplicate guard, interrupted-task recovery and checkpoints all checked');
process.exit(0);
