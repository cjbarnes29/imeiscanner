// The assistant's activity states (src/assistant-activity.ts): only real sources set a state, the most important one wins, and listeners hear only about real
// changes. No timers, no invented progress. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/assistant-activity.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const dir = await mkdtemp(join(tmpdir(), 'imei-activity-'));
const file = join(dir, 'activity.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const A = await import(pathToFileURL(file).href);

// priority: error > thinking > reading > checking > waiting > ready > idle
assert.deepEqual(A.ACTIVITY_PRIORITY, ['error', 'thinking', 'reading', 'checking', 'waiting', 'ready', 'idle']);
assert.equal(A.resolveActivity({}), 'idle', 'nothing running: idle');
assert.equal(A.resolveActivity({ a: null, b: undefined }), 'idle', 'sources that say nothing do not count');
assert.equal(A.resolveActivity({ review: 'ready' }), 'ready');
assert.equal(A.resolveActivity({ review: 'ready', forecast: 'waiting' }), 'waiting', 'waiting for the person beats a result that is ready');
assert.equal(A.resolveActivity({ review: 'ready', forecast: 'checking' }), 'checking');
assert.equal(A.resolveActivity({ forecast: 'checking', files: 'reading' }), 'reading');
assert.equal(A.resolveActivity({ files: 'reading', model: 'thinking', forecast: 'checking', review: 'ready' }), 'thinking');
assert.equal(A.resolveActivity({ model: 'thinking', forecast: 'error' }), 'error', 'a failure is never hidden by other work');
// every state has plain words
for (const kind of A.ACTIVITY_PRIORITY) assert.ok(A.ACTIVITY_LABEL[kind] && A.ACTIVITY_LABEL[kind].length > 8, kind + ' has a label');
assert.equal(new Set(Object.values(A.ACTIVITY_LABEL)).size, 7, 'and the labels are all different');

// the store: starts idle and follows the real sources
assert.equal(A.getActivity(), 'idle');
A.setActivity('forecast', 'checking'); assert.equal(A.getActivity(), 'checking');
A.setActivity('files', 'reading'); assert.equal(A.getActivity(), 'reading');
A.setActivity('forecast', null); assert.equal(A.getActivity(), 'reading', 'one source stopping does not stop the other');
A.setActivity('files', null); assert.equal(A.getActivity(), 'idle', 'all done: idle again');
A.setActivity('forecast', 'error'); assert.equal(A.getActivity(), 'error');
A.setActivity('forecast', 'checking'); assert.equal(A.getActivity(), 'checking', 'the next run replaces an old error');
A.setActivity('forecast', null); assert.equal(A.getActivity(), 'idle');
A.setActivity('never-set', null); assert.equal(A.getActivity(), 'idle', 'clearing something that was never set is harmless');
console.log('assistant activity ok');
