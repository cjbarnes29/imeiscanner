// AI brain: settings, privacy of what is sent, the Gemini request, and above all the safety layer between the AI and the app.
// A simulated server is used: no network, no real key. Synthetic names and IMEIs only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export * from './src/agent/llm-settings'; export * from './src/agent/llm-context'; export * from './src/agent/llm-gemini'; export * from './src/agent/llm-brain'; export { emptyState } from './src/retail/data'; export { setTargetLine } from './src/retail/targets';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-ai-'));
const file = join(dir, 'ai.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const M = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const today = '2026-11-19', KEY = 'AIzaSyFAKEKEYFORTESTS0123456789abcdef';
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const records = Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: i < 5 ? 'p1' : '', name: 'r' + i, createdAt: '2026-11-18T01:00:00Z', raw: 'Galaxy Z Fold6' }));
let state = { ...M.emptyState(), assistantRequests: [] };
state = M.setTargetLine(state, '2026-11', 'p1', 'flagship1', { target: 12, achieved: 3 });
const fakeStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

// ---- settings: off by default, strict, one key, never in the app data -----------------------------------------------------------------------------------
{
  const s = fakeStore(); assert.deepEqual(M.readAiSettings(s), M.DEFAULT_AI); assert.equal(M.aiReady(M.readAiSettings(s)), false);
  assert.equal(M.saveAiSettings({ ...M.DEFAULT_AI, enabled: true, key: 'short', model: 'gemini-x-flash-lite' }, s).enabled, false, 'no key, no brain');
  assert.equal(M.saveAiSettings({ ...M.DEFAULT_AI, enabled: true, key: KEY, model: '' }, s).enabled, false, 'no model, no brain');
  const on = M.saveAiSettings({ ...M.DEFAULT_AI, enabled: true, key: KEY, model: 'gemini-3.5-flash-lite' }, s); assert.ok(M.aiReady(on));
  assert.deepEqual([...s.m.keys()], [M.AI_KEY], 'one storage key only'); assert.equal(M.maskKey(KEY).includes('FAKEKEY'), false);
  s.setItem(M.AI_KEY, '{broken'); assert.equal(M.aiReady(M.readAiSettings(s)), false, 'damaged settings fall back to off');
  assert.equal(M.saveAiSettings({ ...M.DEFAULT_AI, enabled: true, key: KEY, model: 'bad model!!' }, s).model, '', 'odd model names are refused');
  M.clearAiSettings(s); assert.equal(s.m.size, 0);
  const b = fakeStore(); let last; for (let i = 0; i < M.DAILY_AI_LIMIT; i++) last = M.spendAiBudget(today, b); assert.ok(last.ok); assert.equal(M.spendAiBudget(today, b).ok, false, 'daily budget stops a loop'); assert.equal(M.spendAiBudget('2026-11-20', b).ok, true, 'a new day resets it');
}

// ---- what is sent: no IMEIs, no real names, only counts ------------------------------------------------------------------------------------------------
{
  const c = M.buildAiContext(state, records, people, today);
  assert.ok(!/\b\d{15}\b/.test(c.text), 'no IMEI'); assert.ok(!/Asha|Bilal/.test(c.text), 'names are replaced by labels'); assert.match(c.text, /Person A/); assert.match(c.text, /Galaxy Z Fold6: 12 total, 7 unassigned; with Person A 5/); assert.match(c.text, /Person A .*target 12, achieved 3/);
  assert.equal(c.aliases.get('Person B'), 'Bilal'); assert.equal(M.unalias('Give 2 to Person A and Person B', c.aliases), 'Give 2 to Asha and Bilal');
  const shared = M.buildAiContext(state, records, people, today, { shareNames: true }); assert.match(shared.text, /Asha/); assert.ok(!/\b\d{15}\b/.test(shared.text), 'IMEIs are never sent, even when names are shared');
  const many = M.buildAiContext(state, Array.from({ length: 3000 }, (_, i) => ({ ...records[0], id: 'x' + i, model: 'M' + (i % 400) })), people, today); assert.ok(many.text.length <= M.MAX_CONTEXT_CHARS, 'size is capped');
  const gone = M.buildAiContext({ ...state, recordMeta: Object.fromEntries(records.map(r => [r.id, { status: 'given' }])) }, records, people, today); assert.match(gone.text, /- none/, 'removed phones are not counted');
}

// names hide in free text too: routine sentences and the question itself, including a first name on its own; a word shared by two people is left alone
{
  const withRoutine = { ...state, assistantRoutines: [{ id: 'r1', text: 'give 1 Fold6 to Asha Demo, then to bilal', enabled: true, time: '09:00', days: [] }] };
  const two = [{ id: 'p1', name: 'Asha Demo' }, { id: 'p2', name: 'Bilal Demo' }];
  const c = M.buildAiContext(withRoutine, records, two, today); assert.ok(!/Asha|Bilal/i.test(c.text), 'names inside a routine sentence are hidden: ' + c.text);
  assert.match(c.text, /give 1 Fold6 to Person A, then to Person B/); assert.match(M.maskNames('please sort asha out and tell Bilal Demo', two), /please sort Person A out and tell Person B/); assert.match(M.maskNames('the Demo team', two), /the Demo team/, 'a shared word is not turned into one person');
  assert.equal(M.maskNames('ashamed', two), 'ashamed', 'only whole words are replaced');
  assert.equal(M.maskNames('anna-lee and Zoë', [{ id: 'x', name: 'Zoë' }]), 'anna-lee and Person A', 'names with accents work');
}

// ---- the Gemini request ----------------------------------------------------------------------------------------------------------------------------------
const reply = (text, extra = {}) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }) });
{
  const calls = []; const f = async (url, init) => { calls.push({ url, init }); return reply('{"kind":"answer","text":"ok"}'); };
  assert.equal(await M.geminiGenerate({ key: KEY, model: 'gemini-3.5-flash-lite', system: 'S', user: 'U', fetchImpl: f }), '{"kind":"answer","text":"ok"}');
  const c = calls[0]; assert.match(c.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/); assert.ok(!c.url.includes(KEY), 'the key is never in the web address');
  assert.equal(c.init.headers['x-goog-api-key'], KEY); const body = JSON.parse(c.init.body); assert.equal(body.systemInstruction.parts[0].text, 'S'); assert.equal(body.contents[0].parts[0].text, 'U'); assert.equal(body.generationConfig.responseMimeType, 'application/json');
  const fail = async (status, expect) => { await assert.rejects(() => M.geminiGenerate({ key: KEY, model: 'm', system: '', user: '', fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) }), e => { assert.equal(e.kind, expect); assert.ok(!e.message.includes(KEY)); return true; }); };
  await fail(403, 'bad-key'); await fail(401, 'bad-key'); await fail(429, 'limit'); await fail(500, 'unexpected');
  await assert.rejects(() => M.geminiGenerate({ key: KEY, model: 'm', system: '', user: '', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), e => e.kind === 'network');
  await assert.rejects(() => M.geminiGenerate({ key: KEY, model: 'm', system: '', user: '', fetchImpl: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } }), e => e.kind === 'timeout');
  await assert.rejects(() => M.geminiGenerate({ key: KEY, model: 'm', system: '', user: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }) }), e => e.kind === 'blocked');
  await assert.rejects(() => M.geminiGenerate({ key: KEY, model: 'm', system: '', user: '', fetchImpl: async () => reply('   ') }), e => e.kind === 'unexpected');
  const list = await M.geminiModels(KEY, async () => ({ ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.5-flash-lite-preview', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-3.5-flash-tts', supportedGenerationMethods: ['generateContent'] }] }) }));
  assert.deepEqual(list, ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash-lite-preview', 'gemini-3.5-flash-tts']); assert.equal(M.pickModel(list), 'gemini-3.5-flash-lite', 'a small stable model is preferred; preview and audio models never'); assert.equal(M.pickModel(['embedding-001']), '');
}

// ---- parsing is strict ----------------------------------------------------------------------------------------------------------------------------------
assert.deepEqual(M.parseBrain('{"kind":"answer","text":"Asha has 5"}'), { kind: 'answer', text: 'Asha has 5' });
assert.equal(M.parseBrain('```json\n{"kind":"clarify","text":"Which model?"}\n```').kind, 'clarify');
for (const bad of ['give 2 fold6 to asha', '{"kind":"delete","text":"x"}', '{"kind":"command"}', '{"kind":"command","text":""}', '[]', '{"kind":"answer","text":' + JSON.stringify('x'.repeat(900)) + '}']) assert.equal(M.parseBrain(bad), null, 'refused: ' + bad.slice(0, 30));

// ---- the safety layer between the AI and the app ---------------------------------------------------------------------------------------------------------
{
  const ctx = M.buildAiContext(state, records, people, today); const deps = { state, records, people, today, ctx };
  const decide = (user, kind, text) => M.decideBrain(user, { kind, text }, deps);
  assert.deepEqual(decide('how many does asha have', 'answer', 'Person A has 5 phones.'), { type: 'answer', text: 'Asha has 5 phones.' }, 'answers are mapped back to real names');
  const ok = decide('can you hand asha 2 fold6 please', 'command', 'give 2 Galaxy Z Fold6 to Person A'); assert.equal(ok.type, 'command'); assert.equal(ok.command, 'give 2 Galaxy Z Fold6 to Asha', 'the command uses the real name');
  assert.equal(decide('what if i give asha 2 fold6', 'command', 'give 2 Galaxy Z Fold6 to Person A').type, 'answer', 'a what-if is never turned into a change');
  assert.equal(decide('should i give asha 2 fold6', 'command', 'give 2 Galaxy Z Fold6 to Person A').type, 'answer', 'a question is never turned into a change');
  assert.equal(decide('dont give asha anything', 'command', 'give 2 Galaxy Z Fold6 to Person A').type, 'answer', 'a negation is never turned into a change');
  assert.equal(decide('maybe give asha 2 fold6', 'command', 'give 2 Galaxy Z Fold6 to Person A').type, 'answer', 'a maybe is never turned into a change');
  assert.equal(decide('please hand asha 2 fold6', 'command', 'delete everyone').type, 'answer', 'a command the assistant does not understand is refused');
  assert.equal(decide('please hand asha 2 fold6', 'command', 'give 2 Galaxy Z Fold6 to Person A\ndelete Person B').type, 'answer', 'two lines are refused');
  assert.equal(decide('please hand asha 2 fold6', 'command', 'give 2 Galaxy Z Fold6 to Person A; delete Person B').type, 'answer', 'two commands are refused');
  assert.equal(decide('please clear it all', 'command', 'delete all people').type, 'answer', 'bulk deletes are refused by the existing gate');
  assert.equal(decide('please hand nobody 2 fold6', 'command', 'give 2 Galaxy Z Fold6 to Nobody').type, 'answer', 'a person who does not exist is not accepted');
  assert.equal(decide('please hand asha 99 fold6', 'command', 'give 99 Galaxy Z Fold6 to Person A').type, 'answer', 'a command with a blocker is not accepted');
  assert.equal(decide('hand asha 2 fold6 please', 'clarify', 'Which model?').type, 'answer');
  const del = decide('please remove bilal from the team', 'command', 'delete Person B'); assert.equal(del.type, 'command'); assert.equal(del.command, 'delete Bilal', 'a removal is only a proposal: it still needs press-and-hold on Home');
}

// ---- end to end with a simulated server: what leaves the phone, and that nothing is called unless asked --------------------------------------------------
{
  let seen = null, n = 0; const f = async (_url, init) => { n++; seen = JSON.parse(init.body); return reply(JSON.stringify({ kind: 'command', text: 'give 2 Galaxy Z Fold6 to Person B' })); };
  const settings = M.saveAiSettings({ ...M.DEFAULT_AI, enabled: true, key: KEY, model: 'gemini-3.5-flash-lite' }, fakeStore());
  const r = await M.askBrain({ userText: `bilal could take 2 fold6, imei ${imei(555)}`, settings, state, records, people, today, fetchImpl: f });
  const sent = seen.contents[0].parts[0].text; assert.equal(n, 1);
  assert.ok(!/Asha|Bilal/.test(sent), 'real names do not leave the phone'); assert.ok(!sent.includes(imei(100)) && !sent.includes(imei(555)), 'no IMEI leaves the phone'); assert.match(sent, /Person B could take 2 fold6, imei \[IMEI hidden\]/); assert.equal(r.sent, sent);
  assert.equal(JSON.stringify(seen).includes(KEY), false, 'the key is not in the request body');
  assert.equal(r.decision.type, 'answer', 'the sentence read as a maybe, so it stays an answer (nothing changed)');
  const clear = await M.askBrain({ userText: 'please give bilal 2 fold6', settings, state, records, people, today, fetchImpl: f }); assert.equal(clear.decision.type, 'command'); assert.equal(clear.decision.command, 'give 2 Galaxy Z Fold6 to Bilal');
  await assert.rejects(() => M.askBrain({ userText: 'x', settings, state, records, people, today, fetchImpl: async () => reply('not json at all') }), e => e.kind === 'unexpected');
  assert.equal(M.aiReady(M.DEFAULT_AI), false, 'off by default: the app never calls the AI');
}
console.log('ai brain: settings, privacy of what is sent, the Gemini request and the safety layer all checked');
process.exit(0);
