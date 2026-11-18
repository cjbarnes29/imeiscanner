// Suggestions in the small assistant chat (src/retail/assistant-suggestions.ts): they come from the person's own history, never show an IMEI or a one-off
// date, never repeat, and only fall back to starters when there is little history. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/retail/assistant-suggestions.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const dir = await mkdtemp(join(tmpdir(), 'imei-suggest-'));
const file = join(dir, 's.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const S = await import(pathToFileURL(file).href);
const req = text => ({ id: text, at: '2026-11-18T08:00:00.000Z', text, output: 'x', status: 'answered' });

// no history: starters only, five of them, all marked Try
let r = S.suggestFromHistory({});
assert.deepEqual(r.map(s => s.kind), ['Try', 'Try', 'Try', 'Try', 'Try']); assert.deepEqual(r.map(s => s.text), S.STARTER_QUESTIONS);
// asked twice comes first, then the latest, then saved, then starters; nothing repeats
r = S.suggestFromHistory({
  assistantRequests: [req('Check my report'), req('give 4 Fold6 to Asha'), req('Check my report'), req('How much real stock do we have?'), req('set report Fold6 to 6'), req('make a powerpoint report for last month')],
  savedQuestions: ['Plan to reach 70 percent today', 'Check my report']
});
assert.equal(r[0].text, 'Check my report'); assert.equal(r[0].kind, 'Often asked');
assert.deepEqual(r.slice(1, 4).map(s => s.kind), ['Recent', 'Recent', 'Recent']);
assert.deepEqual(r.slice(1, 4).map(s => s.text), ['make a powerpoint report for last month', 'set report Fold6 to 6', 'How much real stock do we have?'], 'latest first');
assert.ok(r.some(s => s.kind === 'Saved' && s.text === 'Plan to reach 70 percent today'));
assert.equal(new Set(r.map(s => s.text.toLowerCase())).size, r.length, 'no repeats'); assert.ok(r.length <= 6);
// the same text in another case or with extra spaces counts as the same
r = S.suggestFromHistory({ assistantRequests: [req('Check my report'), req('  check   MY report ')] });
assert.equal(r[0].kind, 'Often asked'); assert.equal(r.filter(s => /check my report/i.test(s.text)).length, 1);
// IMEIs, fixed dates, the old "Report requested" output and silly lengths are never suggested
r = S.suggestFromHistory({ assistantRequests: [req('add phone stock F956 IMEI 490154209100009'), req('prepare report for 2026-11-18'), req('Report requested: an Excel file'), req('ok'), req('x'.repeat(200)), req('Show my targets')] });
assert.deepEqual(r.filter(s => s.kind !== 'Try').map(s => s.text), ['Show my targets']);
assert.ok(!r.some(s => /\d{15}/.test(s.text)));
// limit
assert.equal(S.suggestFromHistory({ assistantRequests: Array.from({ length: 30 }, (_, i) => req('question number ' + i)) }, 4).length, 4);

// the reply layout helpers (src/AssistantAnswer.tsx): short sentences, important numbers in bold (dates stay plain), next steps that leave out the question just asked
const bundled2 = await build({ entryPoints: ['src/AssistantAnswer.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent' });
const file2 = join(dir, 'answer.mjs');
await writeFile(file2, bundled2.outputFiles[0].text);
const AN = await import(pathToFileURL(file2).href);
assert.deepEqual(AN.sentences('To reach 70% over 7 calendar day(s): propose 0 releases, 12 more eligible stock needed. 0 remain Stored. Segment caps are respected.'), ['To reach 70% over 7 calendar day(s): propose 0 releases, 12 more eligible stock needed.', '0 remain Stored.', 'Segment caps are respected.']);
assert.deepEqual(AN.sentences('- first thing; Second thing'), ['first thing;', 'Second thing']);
assert.deepEqual(AN.emphasise('Needs 12 more by 2026-11-18 (70%)').filter(n => typeof n === 'object').map(n => n.props.children), ['12', '70%'], 'numbers and percents are bold, the date is not');
assert.deepEqual(AN.nextSteps('Check my report', ''), ['Make an Excel report for this month', 'Make simple notes of my targets', 'How much real stock do we have?']);
assert.ok(AN.nextSteps('How much real stock do we have?', '').every(q => q !== 'How much real stock do we have?'), 'the question just asked is not offered again');
assert.ok(AN.nextSteps('anything', '').length >= 3 && AN.nextSteps('Turn off auto-detection', '').includes('Check and explain my settings'));
console.log('assistant suggestions ok');
