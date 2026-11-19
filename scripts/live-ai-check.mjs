// LIVE check of the AI agent against the REAL providers (Gemini, Groq, OpenRouter). It needs your own free keys, which are read from environment variables or a local file and
// are NEVER printed or written anywhere:
//   PowerShell:  $env:GEMINI_API_KEY='...'; $env:GROQ_API_KEY='...'; $env:OPENROUTER_API_KEY='...'; node scripts/live-ai-check.mjs
//   or a file (outside the project) with lines  GEMINI_API_KEY=...   GROQ_API_KEY=...   OPENROUTER_API_KEY=... :   node scripts/live-ai-check.mjs --keys-file C:\path\keys.txt
// Options: --only gemini|groq|openrouter   --pause 4000 (ms between requests; free plans are rate limited)
// It uses synthetic data only (people Asha and Bilal, made-up phones), runs the same agent code the app runs, and checks: connection and model choice, typo questions, follow-ups,
// clarification, a what-if (must never become a plan), multi-step plans, removal proposals, look-ups, and that no real name or IMEI is ever sent. Results depend on the model; each
// scenario gets one retry. Exit code 0 only if every provider you supplied passes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : ''; };
const keys = { gemini: process.env.GEMINI_API_KEY || '', groq: process.env.GROQ_API_KEY || '', openrouter: process.env.OPENROUTER_API_KEY || '' };
if (opt('keys-file')) for (const line of readFileSync(opt('keys-file'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*(GEMINI|GROQ|OPENROUTER)_API_KEY\s*=\s*(\S+)\s*$/); if (m) keys[m[1].toLowerCase()] = m[2]; }
const only = opt('only'), pause = Number(opt('pause')) || 4000;
const providers = ['gemini', 'groq', 'openrouter'].filter(p => keys[p] && (!only || only === p));
if (!providers.length) { console.log('No keys found. Set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY (or use --keys-file). Nothing was run.'); process.exit(2); }

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export * from './src/agent/providers'; export * from './src/agent/agent'; export * from './src/agent/llm-settings'; export { emptyState } from './src/retail/data'; export { setTargetLine } from './src/retail/targets';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-live-ai-')); const file = join(dir, 'l.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const M = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const today = new Date().toISOString().slice(0, 10), month = today.slice(0, 7);
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const records = Array.from({ length: 14 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: i < 5 ? 'p1' : '', name: 'r' + i, createdAt: today + 'T01:00:00Z', raw: 'Galaxy Z Fold6' }));
let state = { ...M.emptyState(), assistantRequests: [] };
state = M.setTargetLine(state, month, 'p1', 'flagship1', { target: 12, achieved: 3 });
const fold = 'Galaxy Z Fold6', give = (who, qty) => `give ${qty} ${fold} to ${who}`;

let failures = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const provider of providers) {
  const key = keys[provider]; console.log(`\n=== ${provider} ===`);
  const sentBodies = []; const spy = async (url, init) => { sentBodies.push(String(init.body || '')); const res = await fetch(url, init); return res; };
  let model = '';
  try {
    model = M.pickModel(provider, await M.listModels(provider, key, spy)); assert.ok(model, 'no suitable text model was listed for this key');
    console.log(`  connection OK, model chosen: ${model}`);
  } catch (e) { console.log(`  FAIL  connection: ${e.kind || ''} ${e.message}`); failures++; continue; }
  const settings = M.cleanAiSettings({ enabled: true, provider, key, model });
  M.resetGeminiRoute(); M.resetAiCooldown();
  const ask = async (userText, history = []) => { await sleep(pause); return M.runAgent({ userText, settings, state, records, people, today, history, fetchImpl: spy }); };
  const scenarios = [
    ['typo question is answered with the right number', async () => { const r = await ask('hw many phnes does asha hav'); assert.equal(r.result.type, 'reply'); assert.match(r.result.text, /\b5\b/); }],
    ['typo + nickname request becomes a give plan', async () => { const r = await ask('pls giv ash 2 fold6'); assert.equal(r.result.type, 'plan'); assert.equal(r.result.steps[0].command, give('Asha', 2)); }],
    ['follow-up "same for bilal" uses the conversation', async () => { const r = await ask('same for bilal', [{ role: 'user', text: 'give asha 2 fold6' }, { role: 'assistant', text: `Plan: ${give('Asha', 2)}` }]); assert.equal(r.result.type, 'plan'); assert.equal(r.result.steps[0].command, give('Bilal', 2)); }],
    ['follow-up "make it 5" changes the quantity', async () => { const r = await ask('actually make it 5', [{ role: 'user', text: 'give bilal 2 fold6' }, { role: 'assistant', text: `Plan: ${give('Bilal', 2)}` }]); assert.equal(r.result.type, 'plan'); assert.equal(r.result.steps[0].command, give('Bilal', 5)); }],
    ['a missing detail is asked, not guessed', async () => { const r = await ask('give some phones to asha'); assert.equal(r.result.type, 'clarify'); }],
    ['a what-if never becomes a plan', async () => { const r = await ask('what if i give bilal 3 fold6'); assert.notEqual(r.result.type, 'plan'); }],
    ['a multi-step request becomes an ordered plan', async () => { const r = await ask('add a new person called Zed and give him 2 fold6'); assert.equal(r.result.type, 'plan'); assert.deepEqual(r.result.steps.map(s => s.command), ['add person Zed', give('Zed', 2)]); }],
    ['removing a person is only a proposal', async () => { const r = await ask('remove bilal from the team'); assert.equal(r.result.type, 'plan'); assert.equal(r.result.steps[0].command, 'delete Bilal'); }],
    ['a look-up question about two people is answered', async () => { const r = await ask('who has more fold6, asha or bilal?'); assert.equal(r.result.type, 'reply'); assert.match(r.result.text, /Asha/); }],
    ['a target change in plain words', async () => { const r = await ask('put asha at 15 for flagship 1'); assert.equal(r.result.type, 'plan'); assert.equal(r.result.steps[0].command, 'set Asha Flagship 1 target to 15'); }],
    ['leave in plain words', async () => { const r = await ask('asha is off on 2030-01-15'); assert.equal(r.result.type, 'plan'); assert.equal(r.result.steps[0].command, 'mark Asha off on 2030-01-15'); }],
    ['small talk gets a reply and no change', async () => { const r = await ask('thanks, that is all for now'); assert.equal(r.result.type, 'reply'); }]
  ];
  for (const [name, fn] of scenarios) {
    let ok = false, last = '';
    for (let attempt = 0; attempt < 2 && !ok; attempt++) { try { await fn(); ok = true; } catch (e) { last = e.kind ? `${e.kind}: ${e.message}` : String(e.message).split('\n')[0].slice(0, 160); if (e.kind === 'limit') break; } }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + last}`); if (!ok) failures++;
  }
  // privacy: nothing that was sent contains a real name or an IMEI, and the key is only in a header
  const all = sentBodies.join('\n');
  const leaks = [/\bAsha\b/i.test(all.replace(/hw many phnes does asha hav|pls giv ash 2 fold6|same for bilal|give asha|give bilal|remove bilal|who has more fold6, asha or bilal|put asha at|asha is off/gi, '')) ? 'a real name' : '', /\b\d{15}\b/.test(all) ? 'an IMEI' : '', all.includes(key) ? 'the API key in a request body' : ''].filter(Boolean);
  console.log(`  ${leaks.length ? 'FAIL' : 'PASS'}  privacy: nothing private in ${sentBodies.length} request bodies${leaks.length ? '  -> ' + leaks.join(', ') : ''}`); if (leaks.length) failures++;
  if (provider === 'gemini') console.log(`  info  Gemini route used: ${M.currentGeminiRoute()} (interactions = the new API; legacy = the older generateContent fallback)`);
}
console.log(`\n${failures ? failures + ' check(s) FAILED' : 'All live checks passed'} for: ${providers.join(', ')}.`);
process.exit(failures ? 1 : 0);
