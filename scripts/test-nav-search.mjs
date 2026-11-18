// The navigation search (src/retail/nav-search.ts): the right screen is found by its name, by related words and with a small typo; unrelated text finds nothing;
// the empty search shows recent and popular places; nothing here changes data. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/retail/nav-search.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const dir = await mkdtemp(join(tmpdir(), 'imei-nav-'));
const file = join(dir, 'nav.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const N = await import(pathToFileURL(file).href);
const first = q => N.searchNav(q)[0]?.id;
const ids = q => N.searchNav(q).map(i => i.id);

// by name
assert.equal(first('backup'), 'backup'); assert.equal(first('targets'), 'targets'); assert.equal(first('settings'), 'settings'); assert.equal(first('phones'), 'phones'); assert.equal(first('home'), 'home');
assert.equal(first('edit all'), 'edit-all'); assert.equal(first('make a report'), 'make-report'); assert.equal(first('daily plan'), 'plan');
// by related words
assert.equal(first('powerpoint'), 'make-report'); assert.equal(first('excel'), 'make-report'); assert.equal(first('restore'), 'backup'); assert.equal(first('auto give'), 'gives');
assert.equal(first('limits'), 'gives'); assert.equal(first('theme'), 'settings'); assert.equal(first('screenshot'), 'import-targets'); assert.equal(first('imei'), 'phones');
assert.ok(ids('report').includes('report') && ids('report').includes('make-report'), 'report finds both the Report screen and Make a report');
assert.equal(first('report'), 'report', 'the screen named Report comes first');
// small typos
assert.equal(first('targts'), 'targets'); assert.equal(first('backp'), 'backup'); assert.equal(first('setings'), 'settings'); assert.equal(first('powerpont'), 'make-report');
// every typed word must match
assert.equal(first('edit targets'), 'edit-all'); assert.deepEqual(N.searchNav('backup zebra'), []);
// nothing found, empty, symbols, long
assert.deepEqual(N.searchNav('xyzzy'), []); assert.deepEqual(N.searchNav(''), []); assert.deepEqual(N.searchNav('   '), []); assert.deepEqual(N.searchNav('!!!'), []);
assert.ok(N.searchNav('a'.repeat(500)).length === 0);
assert.ok(N.searchNav('s').length <= 8, 'limited');
// no repeats, every entry reachable by its own title
for (const item of N.NAV_ITEMS) assert.ok(ids(item.title).includes(item.id), `"${item.title}" finds itself`);
assert.equal(new Set(N.NAV_ITEMS.map(i => i.id)).size, N.NAV_ITEMS.length, 'ids are unique');
// before typing: recent first, then popular, no repeats, limited
assert.deepEqual(N.startItems([]).map(i => i.id), ['targets', 'make-report', 'backup', 'edit-all', 'gives', 'settings']);
assert.deepEqual(N.startItems(['plan', 'targets']).map(i => i.id).slice(0, 3), ['plan', 'targets', 'make-report']);
assert.equal(N.startItems(['nope', 'plan']).map(i => i.id)[0], 'plan', 'an unknown id is ignored');
// saved questions
const q = N.questionItems(['Check my report', 'ok', 'add stock IMEI 490154209100009', 'Plan to reach 70 percent today']);
assert.deepEqual(q.map(i => i.title), ['Check my report', 'Plan to reach 70 percent today']); assert.deepEqual(q[0].target, { kind: 'assistant', prompt: 'Check my report' });
assert.equal(N.searchNav('plan reach', q).length, 1);
console.log('nav search ok');
