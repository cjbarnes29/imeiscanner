// The assistant's everyday leave wording (src/retail/calendar-commands.ts): who is away and on exactly which dates. Today in this test is Thursday 2026-11-19.
// Synthetic names only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: "export { leaveMatch, findDates, addDays } from './src/retail/calendar-commands';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent'
});
const dir = await mkdtemp(join(tmpdir(), 'imei-assistant-calendar-'));
const file = join(dir, 'calendar.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { leaveMatch, findDates, addDays } = await import(pathToFileURL(file).href);

const today = '2026-11-19'; // a Thursday
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const leave = text => { const m = leaveMatch(text, today, people); return m && [m[1], m[2], m[3]]; };

// the same dates in many ways
assert.deepEqual(leave('Asha is on leave from 2026-11-20 to 2026-11-24'), ['Asha', '2026-11-20', '2026-11-24']);
assert.deepEqual(leave('bilal is sick tomorrow'), ['Bilal', '2026-11-20', '2026-11-20']);
assert.deepEqual(leave('bilal sick today'), ['Bilal', today, today]);
assert.deepEqual(leave('asha has a day off on friday'), ['Asha', '2026-11-20', '2026-11-20'], 'a bare weekday is the next one');
assert.deepEqual(leave('asha off monday'), ['Asha', '2026-11-23', '2026-11-23']);
assert.deepEqual(leave('asha off thursday'), ['Asha', today, today], 'today counts for a bare weekday');
assert.deepEqual(leave('Bilal will be sick next thursday'), ['Bilal', '2026-11-26', '2026-11-26'], '"next" means after today');
assert.deepEqual(leave('put asha on holiday next week'), ['Asha', '2026-11-23', '2026-11-29'], 'next week is Monday to Sunday');
assert.deepEqual(leave('Bilal is on holiday from 24 nov to 28 nov'), ['Bilal', '2026-11-24', '2026-11-28']);
assert.deepEqual(leave('asha is off on 25/11'), ['Asha', '2026-11-25', '2026-11-25']);
assert.deepEqual(leave('Bilal is not coming in on the 22nd of november'), ['Bilal', '2026-11-22', '2026-11-22']);
assert.deepEqual(leave('Bilal is away on the 28th'), ['Bilal', '2026-11-28', '2026-11-28'], 'a day of this month');
assert.deepEqual(leave('Bilal is away on the 5th'), ['Bilal', '2026-12-05', '2026-12-05'], 'already passed: next month');
assert.deepEqual(leave('mark Bilal on leave for 3 days from monday'), ['Bilal', '2026-11-23', '2026-11-25']);
assert.deepEqual(leave('Asha is out of office until friday'), ['Asha', today, '2026-11-20'], '"until" alone starts today');
assert.deepEqual(leave('Asha is taking leave from 2 dec to 5 dec'), ['Asha', '2026-12-02', '2026-12-05']);
assert.deepEqual(leave('Asha is on sick leave from monday until wednesday'), ['Asha', '2026-11-23', '2026-11-25']);
assert.deepEqual(leave("Asha can't make it tomorrow"), ['Asha', '2026-11-20', '2026-11-20']);
assert.deepEqual(leave('can you please put asha on leave tomorrow'), ['Asha', '2026-11-20', '2026-11-20'], 'polite beginnings');
assert.deepEqual(leave('Asha is away 20 dec to 2 jan'), ['Asha', '2026-12-20', '2027-01-02'], 'a range over the new year');
assert.deepEqual(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(findDates('on 31 feb', today).hits.length, 0, 'a date that does not exist is not a date');

// never guess: no person, several people, no date, or a question
assert.equal(leave('somebody is on leave tomorrow'), null, 'nobody saved by that name');
assert.equal(leave('asha and bilal are off tomorrow'), null, 'two people are not guessed');
assert.equal(leave('asha is sick'), null, 'no date');
for (const q of ['is asha on leave tomorrow', 'who is off tomorrow', 'will bilal be sick next monday', 'what if asha is away on friday', 'did bilal take leave yesterday?', 'when is asha off']) assert.equal(leave(q), null, q);
assert.equal(leave('turn off auto detection tomorrow'), null, 'a setting is not leave');
console.log('calendar wording: dates, ranges, polite endings and refusals all checked');
