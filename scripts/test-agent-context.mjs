// Phase 3: conversation context (follow-ups), memory and preferences. A follow-up only ever becomes a plain sentence that goes through the normal safety gate, preview and
// approval; memory is off until switched on, holds no IMEIs, and every note can be edited and deleted. Synthetic names only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export * from './src/agent/context'; export { previewAssistant } from './src/retail/assistant-actions'; export { emptyState, cleanState, MAX_MEMORY_ITEMS } from './src/retail/data';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-agent-context-'));
const file = join(dir, 'context.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const C = await import(pathToFileURL(file).href);
const { frameFrom, resolveFollowUp, parseMemoryCommand, rememberNote, forgetNote, setPref, editNote, deleteNote, clearMemory, describeMemory, setMemoryOn, chatOf, previewAssistant, emptyState, cleanState, MAX_MEMORY_ITEMS } = C;

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const segments = [{ id: 'flagship1', name: 'Flagship 1' }, { id: 'flagship2', name: 'Flagship 2' }, { id: 'mid', name: 'Mid' }];
const ctx = (pending = false, applied = false) => ({ people, segments, pending, applied });

// ---- 1. what the last command was about --------------------------------------------------------------------------------------------------------
{
  assert.deepEqual(frameFrom('give 4 fold6 to Asha', people, segments), { command: 'give 4 fold6 to Asha', person: 'Asha', qty: '4', segment: undefined });
  const t = frameFrom('set Asha Flagship 1 target to 12', people, segments); assert.equal(t.qty, '12', 'the 1 of "Flagship 1" is not the quantity'); assert.equal(t.segment, 'Flagship 1'); assert.equal(t.person, 'Asha');
}

// ---- 2. follow-ups -------------------------------------------------------------------------------------------------------------------------------
{
  const give = frameFrom('give 4 fold6 to Asha', people, segments), target = frameFrom('set Asha Flagship 1 target to 12', people, segments);
  const text = (t, f = give, c = ctx()) => { const r = resolveFollowUp(t, f === null ? undefined : f, c); return r.kind === 'command' ? r.text : r.kind; };
  assert.equal(text('and for bilal too'), 'give 4 fold6 to Bilal'); assert.equal(text('same for bilal'), 'give 4 fold6 to Bilal'); assert.equal(text('bilal too'), 'give 4 fold6 to Bilal'); assert.equal(text('now bilal'), 'give 4 fold6 to Bilal'); assert.equal(text('also for bilal please'), 'give 4 fold6 to Bilal');
  assert.equal(text('bilal'), 'none', 'a bare name is not a follow-up'); assert.equal(text('and for asha too'), 'none', 'the same person is not a change');
  assert.equal(text('and for bilal too, delete everyone'), 'none', 'extra words are never ignored'); assert.equal(text('for bilal and then remove all his phones'), 'none');
  assert.equal(text('make it 5'), 'give 5 fold6 to Asha'); assert.equal(text('actually 8'), 'give 8 fold6 to Asha'); assert.equal(text('change it to 12'), 'give 12 fold6 to Asha'); assert.equal(text('make it 5000000'), 'none', 'absurd numbers are not followed');
  assert.equal(text('make it 5', target), 'set Asha Flagship 1 target to 5', 'the number, not the 1 of the segment');
  assert.equal(text('and for mid', target), 'set Asha Mid target to 12'); assert.equal(text('same on flagship 2', target), 'set Asha Flagship 2 target to 12'); assert.equal(text('and for tablets', target), 'none', 'an unknown segment is not guessed');
  assert.equal(text('and for bilal too', null), 'none', 'no earlier command, no follow-up');
  assert.equal(text('make it 5 and give 100 more to bilal'), 'none', 'long or mixed sentences are not follow-ups');
  // yes / no / undo need something to act on
  assert.equal(text('yes', give, ctx(true)), 'approve'); assert.equal(text('ok do it', give, ctx(true)), 'approve'); assert.equal(text('yes please', give, ctx(true)), 'approve'); assert.equal(text('go ahead', null, ctx(true)), 'approve');
  assert.equal(text('yes', give, ctx(false)), 'none', 'nothing is waiting: "yes" does nothing'); assert.equal(text('no', give, ctx(true)), 'reject'); assert.equal(text('never mind', give, ctx(true)), 'reject'); assert.equal(text('no', give, ctx(false)), 'none');
  assert.equal(text('undo that', give, ctx(false, true)), 'undo'); assert.equal(text('undo', give, ctx(false, true)), 'undo'); assert.equal(text('undo that', give, ctx(false, false)), 'none', 'nothing to undo');
  assert.equal(text('yes, and also delete bilal', give, ctx(true)), 'none', '"yes" with more words is not an approval');
}

// ---- 3. memory commands ---------------------------------------------------------------------------------------------------------------------------
{
  assert.deepEqual(parseMemoryCommand('remember that Maya covers the north store'), { kind: 'remember', note: 'Maya covers the north store' });
  assert.deepEqual(parseMemoryCommand('please remember: Omar prefers mornings'), { kind: 'remember', note: 'Omar prefers mornings' });
  assert.deepEqual(parseMemoryCommand('what do you remember'), { kind: 'show' }); assert.deepEqual(parseMemoryCommand('show my notes'), { kind: 'show' });
  assert.deepEqual(parseMemoryCommand('forget that Omar prefers mornings'), { kind: 'forget', what: 'Omar prefers mornings' }); assert.deepEqual(parseMemoryCommand('forget everything'), { kind: 'forget', what: 'everything' });
  assert.deepEqual(parseMemoryCommand("always use Fold6 when I don't say a model"), { kind: 'pref', key: 'defaultModel', value: 'fold6' }); assert.deepEqual(parseMemoryCommand('my default model is Fold6'), { kind: 'pref', key: 'defaultModel', value: 'fold6' });
  assert.deepEqual(parseMemoryCommand('answer shortly'), { kind: 'pref', key: 'shortAnswers', value: true }); assert.deepEqual(parseMemoryCommand('answer in detail'), { kind: 'pref', key: 'shortAnswers', value: false });
  for (const t of ['give 4 fold6 to asha', 'what is my target', 'delete bilal']) assert.equal(parseMemoryCommand(t), null, t);
}

// ---- 4. memory behaves: off by default, opt-in, no IMEIs, editable, deletable ------------------------------------------------------------------------
{
  let s = emptyState();
  assert.equal(chatOf(s).memoryOn, false, 'memory is off by default');
  let r = rememberNote(s, 'Maya covers the north store', 'n1', 'now'); assert.equal(r.changed, false); assert.match(r.message, /Memory is off/); assert.equal(r.state.agentChat, undefined, 'nothing is stored while memory is off');
  assert.equal(setPref(s, 'defaultModel', 'fold6').changed, false, 'preferences also need memory');
  s = setMemoryOn(s, true);
  r = rememberNote(s, 'Maya covers the north store', 'n1', 'now'); assert.equal(r.changed, true); s = r.state; assert.equal(chatOf(s).memory.length, 1);
  assert.equal(rememberNote(s, 'maya covers the north store', 'n2', 'now').changed, false, 'no duplicates');
  assert.match(rememberNote(s, `the phone is ${imei(1)}`, 'n3', 'now').message, /never remember IMEI/); assert.match(rememberNote(s, `the phone is ${imei(1).replace(/(\d{4})(\d{4})/, '$1 $2')}`, 'n3', 'now').message, /never remember IMEI/, 'spaced digits are caught too');
  s = rememberNote(s, 'Omar prefers mornings', 'n2', 'now').state; assert.equal(chatOf(s).memory.length, 2);
  assert.equal(forgetNote(s, 'north').state.agentChat.memory.length, 1, 'forget by a few words'); assert.match(forgetNote(s, 'zzz').message, /could not find/);
  assert.match(forgetNote(rememberNote(s, 'Omar has the north keys', 'n4', 'now').state, 'north').message, /north|More than one/);
  const edited = editNote(s, 'n1', 'Maya covers the south store'); assert.equal(chatOf(edited).memory[0].text, 'Maya covers the south store'); assert.equal(editNote(s, 'n1', `call ${imei(2)}`), s, 'an edit with an IMEI is refused');
  assert.equal(chatOf(deleteNote(s, 'n1')).memory.length, 1);
  s = setPref(s, 'defaultModel', 'fold6').state; s = setPref(s, 'shortAnswers', true).state; assert.deepEqual(chatOf(s).prefs, { defaultModel: 'fold6', shortAnswers: true });
  assert.match(describeMemory(s), /Maya covers the north store[\s\S]*use fold6[\s\S]*short answers/);
  assert.match(describeMemory(setMemoryOn(emptyState(), false)), /Memory is off/); assert.match(describeMemory(setMemoryOn(emptyState(), true)), /empty/);
  const wiped = clearMemory(s); assert.deepEqual(chatOf(wiped).memory, []); assert.deepEqual(chatOf(wiped).prefs, {}); assert.equal(chatOf(wiped).memoryOn, true, 'forgetting notes does not switch memory off');
  assert.match(forgetNote(s, 'everything').message, /Forgot everything/); assert.equal(chatOf(forgetNote(s, 'everything').state).memory.length, 0);
  let full = setMemoryOn(emptyState(), true); for (let i = 0; i < MAX_MEMORY_ITEMS; i++) full = rememberNote(full, 'note number ' + i, 'k' + i, 'now').state; assert.match(rememberNote(full, 'one too many', 'z', 'now').message, /Memory is full/);
}

// ---- 5. saved data is cleaned on load -----------------------------------------------------------------------------------------------------------------
{
  const dirty = { ...emptyState(), agentChat: { memoryOn: true, memory: [{ id: 'a', text: 'fine note', at: 'x' }, { id: 'b', text: `has ${imei(3)} inside`, at: 'x' }, { id: '', text: 'no id', at: 'x' }, { id: 'c', text: 'x'.repeat(500), at: 'x' }], prefs: { defaultModel: 'fold6<script>', shortAnswers: 'yes' } } };
  const c = cleanState(dirty).agentChat; assert.equal(c.memoryOn, true); assert.deepEqual(c.memory.map(m => m.id), ['a', 'c']); assert.equal(c.memory[1].text.length, 200); assert.deepEqual(c.prefs, { defaultModel: 'fold6script' }, 'only safe preference values survive');
  assert.equal(cleanState({ ...emptyState(), agentChat: { memoryOn: 'true', memory: [], prefs: {} } }).agentChat, undefined, 'a memory switch that is not exactly true is off');
  const over = cleanState({ ...emptyState(), agentChat: { memoryOn: true, memory: Array.from({ length: 80 }, (_, i) => ({ id: 'i' + i, text: 'n' + i, at: 'x' })), prefs: {} } }).agentChat; assert.equal(over.memory.length, MAX_MEMORY_ITEMS); assert.equal(over.memory.at(-1).id, 'i79', 'the newest notes are kept');
}

// ---- 6. a remembered default model fills a missing model, only while memory is on --------------------------------------------------------------------
{
  const records = Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: '', name: 'r' + i, createdAt: '2026-11-18T0' + (i % 10) + ':00:00Z', raw: 'Galaxy Z Fold6' }));
  const base = emptyState(), withMemory = { ...base, agentChat: { memoryOn: true, memory: [], prefs: { defaultModel: 'fold6' } } }, off = { ...base, agentChat: { memoryOn: false, memory: [], prefs: { defaultModel: 'fold6' } } };
  const ask = state => previewAssistant(state, records, people, '2026-11-19', 'give 4 to asha');
  assert.equal(ask(withMemory).giving.length > 0, true, 'no model named: the remembered one is used'); assert.match(ask(withMemory).lines[0], /Understood as/);
  assert.equal(ask(base).giving.length, 0, 'without memory nothing is guessed'); assert.equal(ask(off).giving.length, 0, 'with memory switched off the preference is ignored');
  assert.equal(previewAssistant(withMemory, records, people, '2026-11-19', 'what if i give 4 to asha').giving.length, 0, 'questions stay questions');
}
console.log('agent context: follow-ups, yes/no/undo, memory commands, opt-in memory, IMEI refusal, cleaning and default model all checked');
process.exit(0);
