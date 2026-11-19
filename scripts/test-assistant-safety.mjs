// Phase 0 safety: a question, a "what if", a plan, a past statement, a negation or an unclear request must NEVER change anything, in any module,
// in chat, in a multi-step task, or in Autopilot with every kind of change allowed. Plain commands must still work. Synthetic names and IMEIs only.
// Part of `npm test`: a single failure fails the build.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ALL_CLASSES = ['stock', 'give', 'report', 'calendar', 'targets', 'routine', 'whatsapp', 'settings', 'accessory', 'add-stock', 'people', 'remove'];
let stored = { 'retaillens-auto-workflow-v1': JSON.stringify({ assistantMode: 'autopilot', autopilotAllow: ALL_CLASSES, autopilotDailyCap: 200 }) };
globalThis.localStorage = { getItem: k => stored[k] ?? null, setItem(k, v) { stored[k] = String(v); }, removeItem(k) { delete stored[k]; } };
const bundled = await build({
  stdin: { contents: "export { previewAssistant, applyAssistantRequest } from './src/retail/assistant-actions'; export { startAssistantTask } from './src/AssistantTasks'; export { guardVerdict } from './src/retail/guard'; export { emptyState } from './src/retail/data';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-assistant-safety-'));
const file = join(dir, 'safety.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { previewAssistant, applyAssistantRequest, startAssistantTask, guardVerdict, emptyState } = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const records = Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: '', name: 'r' + i, createdAt: '2026-11-18T0' + (i % 10) + ':00:00Z', raw: 'Galaxy Z Fold6' }));
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const today = '2026-11-19';
const changes = p => !!(p.giving.length || p.business || p.report || p.settings || p.additions?.length || p.people?.ops.length);
const preview = text => previewAssistant(emptyState(), records, people, today, text);

// ---- 1. sentences that must not change anything, grouped by what they are about -------------------------------------------------------------
const UNSAFE = {
  'questions / what-if (giving)': ['what if i give 4 fold6 to asha', 'would it be ok to give asha 4 fold6', 'if i give asha 4 fold6 how many are left', 'should i give asha 4 fold6', 'can i give asha 4 fold6', 'is it ok to give 4 fold6 to bilal?', 'give 4 fold6 to asha?', 'i might give 4 fold6 to asha later', 'maybe give 4 fold6 to asha', 'i am going to give asha 4 fold6', 'give 4 fold6 to asha if there are enough'],
  'questions / what-if (stock)': ['should i store 4 fold6', 'can i remove 2 fold6 from stock', 'what happens if i remove 2 fold6 from stock', 'how do i hold 3 fold6', 'what if i make 2 fold6 available', 'is it possible to store 4 fold6', 'does removing 2 fold6 from stock delete them', 'we could hold 3 fold6'],
  'questions / what-if (targets)': ['how do i set asha flagship 1 target to 12', 'tell me how to split store target 120 for flagship 1 among everyone', 'what happens if i set everyones flagship 1 target to 8', 'should i change flagship 3 target to 12', 'can i set my flagship 1 target to 10', 'if i change asha flagship 1 target to 12 what changes'],
  'questions / what-if (reports)': ['what happens if i set report fold6 to 6', 'should i prepare todays report', 'how do i update report fold6 to 4', 'could i set report fold6 to 6', 'what would the report look like if i set fold6 to 6'],
  'questions / what-if (calendar)': ['is it possible to mark asha not available 2026-11-20', 'what if asha is on leave tomorrow', 'will asha be on leave tomorrow', 'can i mark bilal sick on 2026-11-21', 'did bilal take leave yesterday', 'who is off tomorrow', 'asha might be off friday'],
  'questions / what-if (people)': ['what happens if i delete bilal', 'should i remove asha', 'how do i add a person', 'can i rename asha to ashley', 'if i delete bilal what happens to his phones', 'is it possible to add 3 people', 'what is the best way to remove asha'],
  'questions / what-if (settings, routines, WhatsApp)': ['what if i turn off auto detection', 'should i turn on auto give', 'how do i create a daily routine', 'what happens if i prepare a whatsapp report', 'can i stop automatic crop?', 'turn off auto detection only if i say so'],
  'negations': ['do not give 4 fold6 to asha', "don't give anything", 'never store 4 fold6', "don't remove asha", 'do not delete bilal', "i don't want to delete bilal", 'stop giving 4 fold6 to asha', 'please do not set report fold6 to 6', "don't mark asha on leave", 'never delete anyone', 'cancel', 'undo that', 'do not turn off auto detection', 'no need to add maya', 'can you not delete bilal'],
  'plans / maybes / past statements': ['i gave 4 fold6 to asha yesterday', 'we already stored 4 fold6', 'asha was sick yesterday', 'i am thinking of deleting bilal', 'perhaps remove bilal', 'one day i will delete asha', 'i planned to give asha 4 fold6', 'i think i will store 3 fold6', "i'll give asha 4 fold6 later", 'we will hold 2 fold6 tomorrow', 'i guess i should remove 2 fold6 from stock', 'i should have given asha 4 fold6', 'we could have stored 4 fold6', 'bilal would have received 5 fold6'],
  'unclear requests (fuzzy numbers, "or" choices, delete everything)': ['give about 4 fold6 to asha', 'give some fold6 to asha', 'store a few fold6', 'give 4 fold6 to asha or bilal', 'remove 2 fold6 or 3 fold6 from stock', 'delete everything', 'remove all phones', 'clear all targets', 'wipe the app', 'reset everything', 'delete all people', 'set report fold6 or flip6 to 6'],
};
let total = 0;
for (const [group, list] of Object.entries(UNSAFE)) for (const text of list) {
  total++;
  const p = preview(text);
  assert.equal(changes(p), false, `${group}: "${text}" must not change anything`);
  assert.notEqual(guardVerdict(text).kind, 'command', `${group}: "${text}" must not be read as a command`);
}
assert.ok(total >= 80, `at least 80 unsafe sentences are checked (${total})`);

// ---- 2. multi-step sentences and Autopilot with every kind of change allowed: nothing may start, nothing may change --------------------------
const makeCtx = () => {
  let state = { ...emptyState(), assistantRequests: [], assistantTasks: [] };
  const base = JSON.stringify({ ...state, assistantRequests: undefined, assistantTasks: undefined, audit: undefined });
  const ctx = { get state() { return state; }, latest: () => state, change: next => { state = next; }, notify() {}, records, latestRecords: () => records, people, latestPeople: () => people, today, readOnly: false, assign: () => true };
  const untouched = () => JSON.stringify({ ...state, assistantRequests: undefined, assistantTasks: undefined, audit: undefined }) === base;
  return { ctx, untouched, get state() { return state; } };
};
const MULTI_UNSAFE = [
  'store 4 fold6, then what if i give 4 fold6 to asha', "store 4 fold6, then don't give anything", 'give 4 fold6 to asha, then should i remove bilal?', 'give 4 fold6 to asha, then delete everything',
  'store 4 fold6, then maybe give some fold6 to asha', "give 4 fold6 to asha and don't remove bilal", 'store 4 fold6 and then give 4 fold6 to asha or bilal', 'what if i store 4 fold6 and then give 4 fold6 to asha',
  'store 4 fold6; if possible give 4 fold6 to asha', 'mark asha not available 2026-11-20, then wipe everything', 'set report fold6 to 6, then i might remove bilal', 'give 4 fold6 to asha, then about 3 fold6 to bilal',
];
for (const text of MULTI_UNSAFE) {
  const t = makeCtx();
  const result = startAssistantTask(t.ctx, text);
  assert.equal(result.taskId, undefined, `no task may start for: ${text}`);
  assert.equal(t.state.assistantTasks.length, 0, `no task saved for: ${text}`);
  assert.equal(t.untouched(), true, `Autopilot changed data for: ${text}`);
}
for (const text of [...Object.values(UNSAFE).flat()]) {
  const t = makeCtx();
  const result = startAssistantTask(t.ctx, text);
  assert.equal(result.taskId, undefined, `no Autopilot task may start for: ${text}`);
  assert.equal(t.untouched(), true, `Autopilot changed data for: ${text}`);
}

// ---- 3. plain commands still work (the gate must not block real work) ------------------------------------------------------------------------
for (const text of ['give 4 fold6 to asha', 'give 2 fold6 to bilal', 'store 4 fold6', 'make 2 fold6 available', 'set report fold6 to 6', 'set asha flagship 1 target to 12', 'split store target 120 for flagship 1 among everyone', 'mark asha not available from 2026-11-20 to 2026-11-24', 'bilal is sick tomorrow', 'add 3 people maya omar lee', 'rename asha to ashley', 'turn off auto-detection', 'create daily routine to prepare todays report', "prepare today's WhatsApp report", 'remove 2 fold6 from stock']) {
  const state = { ...emptyState(), recordMeta: Object.fromEntries(records.slice(26).map(r => [r.id, { status: 'held' }])) };
  const p = previewAssistant(state, records, people, today, text);
  assert.ok(p.handled && (changes(p) || p.blockers.length === 0), `a plain command must still be understood: ${text}`);
  if (!/WhatsApp|routine/.test(text)) assert.equal(changes(p), true, `a plain command must still produce a preview: ${text}`);
  assert.equal(guardVerdict(text).kind, 'command', text);
}
{
  const t = makeCtx();
  const result = startAssistantTask(t.ctx, 'store 2 fold6, then give 2 fold6 to asha');
  assert.ok(result.taskId, 'a clear two-step command still becomes a task in Autopilot');
  assert.equal(t.state.assistantTasks[0].steps.length, 2);
}

// ---- 4. stock removal is a status change, never a hard delete ---------------------------------------------------------------------------------
{
  const state = { ...emptyState(), assistantRequests: [{ id: 'q', at: '2026-11-19T00:00:00Z', text: 'remove 2 fold6 from stock', output: '', status: 'pending' }] };
  const before = JSON.stringify(records);
  const applied = applyAssistantRequest(state, records, people, today, 'q', true);
  assert.equal(JSON.stringify(records), before, 'the phone records are untouched');
  assert.equal(applied.additions, undefined); assert.deepEqual(applied.changes, [], 'no phone changes owner or is removed');
  const marked = Object.entries(applied.next.recordMeta).filter(([, m]) => m.status === 'given');
  assert.equal(marked.length, 2, 'exactly two phones are marked as removed from stock'); assert.ok(marked.every(([id]) => records.some(r => r.id === id)), 'and they are still saved records');
}

// ---- 5. the polite wording of a real request is not mistaken for a question ------------------------------------------------------------------
for (const text of ['can you add maya to the team', 'could you please give asha 2 fold6', 'would you mark bilal sick tomorrow']) assert.equal(guardVerdict(text).kind, 'command', text);
console.log(`assistant safety: ${total} unsafe sentences, ${MULTI_UNSAFE.length} multi-step sentences and ${total} Autopilot runs changed nothing; plain commands still work; stock removal keeps every record`);
process.exit(0);
