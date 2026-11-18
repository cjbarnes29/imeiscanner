// Voice input, pure part (src/voice-text.ts): audio helpers and transcript clean-up. SYNTHETIC text only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-voice-'));
const source = await readFile('src/voice-text.ts', 'utf8');
await writeFile(join(dir, 'voice-text.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const V = await import(pathToFileURL(join(dir, 'voice-text.mjs')).href);
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS:', name); };

check('audio: mono mix, resample to 16 kHz, cap at 45 s, silence is detected', () => {
  const left = new Float32Array(48000).fill(0.5), right = new Float32Array(48000).fill(-0.5);
  const mono = V.toMono16k([left, right], 48000);
  assert.equal(mono.length, 16000, 'one second at 48 kHz becomes 16000 samples');
  assert.ok(mono.every(v => Math.abs(v) < 1e-6), 'opposite channels cancel in the mix');
  const same = V.toMono16k([new Float32Array([0.25, 0.5])], 16000);
  assert.deepEqual([...same], [0.25, 0.5], 'already 16 kHz: unchanged');
  assert.equal(V.toMono16k([], 48000).length, 0); assert.equal(V.toMono16k([new Float32Array(0)], 48000).length, 0);
  const sine = Float32Array.from({ length: 44100 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const rs = V.toMono16k([sine], 44100);
  assert.ok(Math.abs(rs.length - 16000) <= 1 && Math.abs(V.loudness(rs) - 0.3535) < 0.02, 'a tone keeps its loudness after resampling');
  assert.equal(V.clipAudio(new Float32Array(16000 * 60)).length, 16000 * 45, 'capped at 45 seconds');
  assert.equal(V.clipAudio(new Float32Array(16000 * 5)).length, 16000 * 5);
  assert.equal(V.isSilent(new Float32Array(16000 * 3)), true, 'all zeros is silence');
  assert.equal(V.isSilent(new Float32Array(100).fill(0.5)), true, 'too short is treated as nothing said');
  assert.equal(V.isSilent(Float32Array.from({ length: 16000 }, (_, i) => 0.3 * Math.sin(i / 5))), false, 'a clear sound is not silence');
});

check('spoken numbers become digits, and words that only contain a number word are left alone', () => {
  const N = V.spokenNumbersToDigits;
  assert.equal(N('give four Fold six to Maya and ten to Noor'), 'give 4 Fold 6 to Maya and 10 to Noor');
  assert.equal(N('one hundred and twenty'), '120'); assert.equal(N('twenty five'), '25'); assert.equal(N('twenty-two'), '22');
  assert.equal(N('ninety nine'), '99'); assert.equal(N('nineteen'), '19'); assert.equal(N('two hundred and five'), '205'); assert.equal(N('five hundred and fifty'), '550'); assert.equal(N('one hundred'), '100');
  assert.equal(N('Flagship one among everyone'), 'Flagship 1 among everyone', '"everyone" is not a number');
  assert.equal(N("at nine o'clock."), "at 9 o'clock.", 'punctuation is kept');
  assert.equal(N('store nothing today'), 'store nothing today'); assert.equal(N(''), '');
  assert.equal(N('twenty one phones'), '21 phones'); assert.equal(N('thirty and five'), '30 and 5', 'a lone "and" is not part of a small number');
});

check('transcript clean-up: noise tags, spacing, final full stop, "hand over"', () => {
  const C = V.cleanTranscript;
  assert.equal(C('[BLANK_AUDIO]'), ''); assert.equal(C('(upbeat music)'), ''); assert.equal(C('*sigh*'), '');
  assert.equal(C(' Give 4 Fold 6 to Maya. '), 'Give 4 Fold 6 to Maya');
  assert.equal(C('(upbeat music) store 4 Fold 6'), 'store 4 Fold 6');
  assert.equal(C('Give me a hand over summary.'), 'Give me a handover summary');
  assert.equal(C('give 4 to Maya , then store 2 .'), 'give 4 to Maya, then store 2');
  assert.equal(C('Prepare today\'s WhatsApp report.'), 'Prepare today\'s WhatsApp report');
  assert.equal(C('Give 4-fold 6 to Maya'), 'Give 4 fold 6 to Maya', 'a hyphen between a number and a word becomes a space');
  assert.equal(C('twenty-two phones'), 'twenty-two phones', 'a hyphen between words is kept');
});

check('name correction: a mis-heard person is fixed, short names and everyday words never are', () => {
  const names = ['Maya', 'Noor', 'Lee'];
  assert.equal(V.correctNames('give 4 to Nore', names), 'give 4 to Noor');
  assert.equal(V.correctNames('give 4 to Maia', names), 'give 4 to Maya');
  assert.equal(V.correctNames('give 4 to Maya and Noor', names), 'give 4 to Maya and Noor', 'exact names are kept');
  assert.equal(V.correctNames('give 4 to nore', names), 'give 4 to nore', 'a lowercase word is not a name');
  assert.equal(V.correctNames('How many phones for Maya', ['Maya']), 'How many phones for Maya', 'ordinary words are never turned into a name');
  assert.equal(V.correctNames('Many phones for Maya', ['Maya']), 'Many phones for Maya', 'nor is the first word of a sentence');
  assert.equal(V.correctNames('Give 4 to Mayo. Noore has 2', ['Maya', 'Noor']), 'Give 4 to Maya. Noor has 2'.replace('Noor has','Noore has'), 'a sentence start after a full stop is left alone');
  assert.equal(V.correctNames('give 4 to Myot', names), 'give 4 to Myot', 'too far away: left for the person to fix');
  assert.equal(V.correctNames('I can see the report', names), 'I can see the report', 'a 3-letter name never rewrites "see"');
  assert.equal(V.correctNames('mark them unavailable', ['Thea', 'Mara']), 'mark them unavailable', 'everyday words are never changed');
  assert.equal(V.correctNames('give 4 to Nore', []), 'give 4 to Nore');
});

check('product codes: "Fold 6" becomes "Fold6", other numbers are untouched', () => {
  const J = V.joinProductCodes;
  assert.equal(J('give 4 Fold 6 to Maya', ['Fold6', 'Flip6']), 'give 4 Fold6 to Maya');
  assert.equal(J('store 2 fold 6', ['Fold6']), 'store 2 Fold6');
  assert.equal(J('set report fold 626', ['Fold6']), 'set report fold 626', 'a longer number is not a code');
  assert.equal(J('give 4 Fold 6', []), 'give 4 Fold6', 'the Samsung families are always joined');
  assert.equal(J('give 4 fold 6 and 2 flip 7 and tab 9', []), 'give 4 Fold6 and 2 Flip7 and Tab9');
  assert.equal(J('store 3 S 24', []), 'store 3 S 24', 'a one-letter series is not guessed because "a 17" is ordinary speech');
  assert.equal(J('give a Galaxy 5', []), 'give a Galaxy 5');
  assert.equal(J('give 4 folds 6 to Maya', []), 'give 4 Fold6 to Maya', 'a plural the model sometimes writes ("folds 6") is joined too');
  assert.equal(J('make 3 notes 2 times', []), 'make 3 notes 2 times', 'only Fold and Flip accept a plural, so ordinary speech is not damaged');
});

check('the real sentences measured from Whisper tiny.en on synthetic speech come out in the form the assistant understands', () => {
  const names = ['Maya', 'Noor', 'Lee'], codes = ['Fold6'], N = t => V.normalizeTranscript(t, names, codes);
  assert.equal(N('Give 4 Fold 6 to Maya and 10 to Nore.'), 'Give 4 Fold6 to Maya and 10 to Noor');
  assert.equal(N('Store 4 Fold 6'), 'Store 4 Fold6');
  assert.equal(N('Give 4-fold 6 to Maya and 10 to Noor.'), 'Give 4 Fold6 to Maya and 10 to Noor', 'as heard in the real browser test');
  assert.equal(N("Prepare today's WhatsApp report."), "Prepare today's WhatsApp report");
  assert.equal(N("Auto give every day at 9 o'clock."), "Auto give every day at 9 o'clock");
  assert.equal(N('Give me a hand over summary.'), 'Give me a handover summary');
  assert.equal(N('Split Store Target 120 for flagship one among everyone.'), 'Split Store Target 120 for flagship 1 among everyone');
  assert.equal(N('Give four Fold six to Maya and ten to Nore'), 'Give 4 Fold6 to Maya and 10 to Noor', 'also when the model wrote number words');
  assert.equal(N('[BLANK_AUDIO]'), '', 'silence gives an empty transcript');
});

console.log(count + ' voice text checks passed');
