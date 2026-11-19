// Every question the assistant chat can be asked is made or answered, and the chat never approves or submits anything by itself.
//  1. A battery of questions (starters, saved questions, every example command, natural wording, report requests, unsupported text, nonsense) goes through the
//     same understanding steps as the chat: a report request, a reviewable request (or a clear reason it cannot be made), or a saved-data answer.
//     Each must give a non-empty response. The data is frozen, so any attempt to change it throws.
//  2. Source guards: only the Home review card's Approve button can apply a request; no assistant file confirms a sale, marks a submission, takes a sale back
//     or re-attributes one. Synthetic data only. Part of `npm test`.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const cache = join(process.cwd(), 'node_modules', '.cache', 'imei-coverage-test');
await mkdir(cache, { recursive: true });
const entry = `
export { previewAssistant } from './src/retail/assistant-actions';
export { localAnswer } from './src/retail/local-assistant';
export { parseReportIntent } from './src/retail/report-intent';
export { emptyState } from './src/retail/data';
export { putTarget } from './src/retail/targets';`;
const bundled = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.css': 'empty' } });
const file = join(cache, 'coverage.mjs');
await writeFile(file, bundled.outputFiles[0].text);
// the settings reader looks at the browser's saved settings: an empty stand-in is enough here
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const A = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
let seq = 930000;
const imei = () => { const body = '49015420' + String(seq++).padStart(6, '0'); return body + luhn(body); };
const TODAY = '2026-11-18', NOW = '2026-11-18T10:00:00.000Z';
const people = [{ id: 'me', name: 'Maya Demo' }, { id: 'asha', name: 'Noor Demo' }, { id: 'c', name: 'Lee Demo' }];
let state = A.emptyState();
for (const id of ['me', 'asha']) state = A.putTarget(state, { personId: id, month: '2026-11', source: 'manual', importedAt: NOW, lines: [{ segment: 'low', target: 10, achieved: 4 }, { segment: 'flagship1', target: 3, achieved: 1 }] });
const records = [
  { id: 'r1', imei: imei(), model: 'SM-A176B', personId: '', raw: '6GB | 128GB\nColour: Black' }, { id: 'r2', imei: imei(), model: 'SM-A176B', personId: 'me', raw: '6GB | 128GB\nColour: Black' },
  { id: 'r3', imei: imei(), model: 'SM-F956B', personId: '', raw: '12GB | 256GB\nColour: Silver' }, { id: 'r4', imei: imei(), model: 'SM-F956B', personId: '', raw: '12GB | 256GB\nColour: Silver' }
];
const deepFreeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); } return value; };
const frozenState = deepFreeze(JSON.parse(JSON.stringify(state)));
deepFreeze(records); deepFreeze(people);
const before = JSON.stringify([frozenState, records, people]);

// what the chat does with a text (the order of RetailPlanAI.requestSettings and savedAnswer), without the screen
const COMMAND = /^(?:please\s+|can you\s+|could you\s+)?(?:change|set|make|update|adjust|add|remove|delete|give|put|assign|move|store|hold|divide|split|mark|create|prepare)\b/i;
function respond(text) {
  const intent = A.parseReportIntent(text, people, TODAY);
  if (intent) return { kind: 'report request', text: intent.summary };
  const preview = A.previewAssistant(frozenState, records, people, TODAY, text);
  if (preview.handled) {
    // the chat shows the lines, the reasons and the warnings; when there are none (a settings question) it explains the current settings instead (queueAssistant)
    const said = [...preview.lines, ...preview.blockers, ...preview.warnings].join(' ').trim() || 'the current settings are explained';
    return { kind: preview.blockers.length && !preview.business && !preview.report && !preview.settings && !preview.giving?.length ? 'clear reason' : 'reviewable request', text: said };
  }
  if (COMMAND.test(text.trim())) return { kind: 'not understood, explained', text: 'I could not turn this into a change I can show you first, so nothing was changed.' };
  const answer = A.localAnswer(frozenState, records, people, TODAY, text);
  return { kind: 'saved-data answer', text: answer.answer };
}

const QUESTIONS = [
  // starters and saved questions
  'Check my report', 'How much real stock do we have?', 'Plan to reach 70 percent today', 'Check and explain my settings', 'Make a PowerPoint report for this month', 'Show only plans and warnings on Home', 'Store uploads automatically', 'Turn off auto-detection',
  // questions
  'what can you do', 'how many phones are unassigned', 'which segment should I push this month', 'what is my target for flagship 3', 'show my targets', 'who needs help', 'how do I share my targets',
  // commands (supported)
  'give 4 Fold6 to Maya and 10 to Noor', 'set report Fold6 to 6', 'prepare today report', 'store 2 Fold6', 'make 2 Fold6 available', 'remove 1 Fold6 from stock', 'set Buds4 stock to 8',
  'split store target 120 for Flagship 1 among everyone', 'change flagship 3 target to 12 and divide it to promoters', 'set store target for Flagship 2 to 20 and share it among everyone',
  'mark Maya not available from 2026-12-20 to 2026-12-22', 'create daily routine to prepare today report', 'add phone stock F956 IMEI 490154209100009',
  // commands that are unclear or unsupported
  'change flagship 3 target to 12', 'change flagship 3 target to 12 and divide it to Maya', 'make the sky blue', 'delete everything', 'give phones', 'do not apply anything',
  // reports
  'make a powerpoint report for last month', 'excel report for Noor', 'simple notes of my targets', 'build a spreadsheet summary for october',
  // odd input
  'zzzz qqqq', 'what is the capital of France', '12345', '???', 'a', 'x'.repeat(300)
];
const results = QUESTIONS.map(q => ({ q, ...respond(q) }));
for (const r of results) assert.ok(r.text && r.text.trim().length > 0, `"${r.q.slice(0, 60)}" got no response (${r.kind})`);
assert.equal(JSON.stringify([frozenState, records, people]), before, 'answering questions changed nothing');
const kinds = new Set(results.map(r => r.kind));
for (const kind of ['report request', 'reviewable request', 'clear reason', 'saved-data answer', 'not understood, explained']) assert.ok(kinds.has(kind), 'the battery reaches: ' + kind);
// the natural wording and the report requests land where they should
const kindOf = q => results.find(r => r.q === q).kind;
assert.equal(kindOf('change flagship 3 target to 12 and divide it to promoters'), 'reviewable request');
assert.equal(kindOf('make a powerpoint report for last month'), 'report request'); assert.equal(kindOf('excel report for Noor'), 'report request');
assert.equal(kindOf('make the sky blue'), 'not understood, explained'); assert.equal(kindOf('Check my report'), 'saved-data answer');

// ---- the chat never approves or submits ---------------------------------------------------------------------------------------------------------------
const src = async name => readFile(join(process.cwd(), 'src', name), 'utf8');
const callers = [];
for (const name of ['AssistantReview.tsx', 'RetailPlanAI.tsx', 'RoutineLearning.tsx', 'AssistantFiles.tsx', 'AssistantReportFiles.tsx', 'AssistantAnswer.tsx', 'AssistantBubble.tsx', 'AutoWorkflow.tsx', 'AutomaticAttention.tsx', 'NavSearch.tsx', 'App.tsx', 'retail/local-assistant.ts', 'retail/routines.ts', 'retail/assistant-suggestions.ts', 'retail/report-intent.ts', 'assistant-settings.ts']) {
  if (/applyAssistantRequest\(/.test(await src(name))) callers.push(name);
}
assert.deepEqual(callers, ['AssistantReview.tsx'], 'only the Home review card applies a request: ' + callers.join(', '));
const review = await src('AssistantReview.tsx');
const commits = [...review.matchAll(/commit\(/g)].length, clicks = [...review.matchAll(/(?:onClick|onConfirm)=\{\(\)=>commit\(/g)].length; // Approve / Undo buttons and the press-and-hold / typed CONFIRM control
assert.ok(commits >= 2 && commits === clicks, `commit() is only called from a button press (Approve, Undo): ${commits} calls, ${clicks} from a click`);
const forbidden = /\b(?:confirmSale|setSubmitted|reattribute|voidSale)\s*\(|submitted\s*:\s*true/;
for (const name of ['AssistantReview.tsx', 'RetailPlanAI.tsx', 'RoutineLearning.tsx', 'AssistantFiles.tsx', 'AssistantReportFiles.tsx', 'AssistantAnswer.tsx', 'AssistantBubble.tsx', 'AutoWorkflow.tsx', 'AutomaticAttention.tsx', 'NavSearch.tsx', 'retail/assistant-actions.ts', 'retail/local-assistant.ts', 'retail/routines.ts', 'retail/assistant-suggestions.ts', 'retail/report-intent.ts', 'assistant-settings.ts']) {
  assert.ok(!forbidden.test(await src(name)), `${name} must not confirm, submit, take back or re-attribute a sale`);
}
const routine = await src('RoutineLearning.tsx');
assert.ok(!/applyAssistantRequest|status:\s*'applied'/.test(routine), 'a routine only prepares requests; it never applies one');
console.log(`assistant coverage ok (${results.length} questions: ${[...kinds].join(', ')})`);
