// Phase 7: the history screen's pure helpers: filters, plain lines, masked export, totals. Synthetic data only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({ stdin: { contents: "export * from './src/agent/log-view';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const dir = await mkdtemp(join(tmpdir(), 'imei-log-view-'));
const file = join(dir, 'v.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const { filterLog, logLine, exportLog, logTotals, FILTER_LABEL } = await import(pathToFileURL(file).href);

const e = (id, over) => ({ id: String(id), at: `2026-11-19T10:0${id}:00.000Z`, actor: 'you', mode: 'assistant', tool: 'people.create', op: 'create', risk: 'low', summary: 'add person Zed', outcome: 'applied', verify: 'verified', checks: 2, ...over });
const log = [e(1), e(2, { outcome: 'undone', tool: 'people.delete' }), e(3, { outcome: 'blocked', actor: 'agent', verify: 'n/a', checks: 0 }), e(4, { verify: 'unverified', failed: ['owner of 490154203237518 missing'], summary: 'give 2 fold6 to 490154203237518' }), e(5, { outcome: 'held', actor: 'routine', verify: 'n/a', checks: 0 })];

assert.deepEqual(filterLog(log, 'all').map(x => x.id), ['5', '4', '3', '2', '1'], 'newest first');
assert.deepEqual(filterLog(log, 'changes').map(x => x.id), ['4', '2', '1']);
assert.deepEqual(filterLog(log, 'problems').map(x => x.id), ['5', '3']);
assert.deepEqual(filterLog(log, 'unconfirmed').map(x => x.id), ['4']);
assert.equal(log[0].id, '1', 'the saved log is never reordered');
assert.match(logLine(log[0]), /^2026-11-19 10:01 UTC · You · Applied · people\.create · add person Zed · saved data checked \(2\)$/);
assert.match(logLine(log[2]), /Autopilot · Blocked .* no save to check$/);
assert.match(logLine(log[3]), /NOT confirmed saved: owner of /);
assert.ok(!/490154203237518/.test(logLine(log[3])) && /49015420\*\*\*7518/.test(logLine(log[3])), 'IMEIs are masked in every line');
const text = exportLog(log, 'unconfirmed'); assert.match(text.split('\n')[0], /Not confirmed saved · 1 of 5 entries .* IMEIs masked/); assert.equal(text.split('\n').length, 2);
assert.deepEqual(logTotals(log), { total: 5, applied: 2, undone: 1, problems: 2, unconfirmed: 1 });
assert.ok(Object.keys(FILTER_LABEL).length === 4);
console.log('agent log view: filters, plain lines, IMEI masking, export and totals checked');
process.exit(0);
