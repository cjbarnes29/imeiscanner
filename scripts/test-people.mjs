// Rules for moving and deleting IMEI records between people (made-up IMEIs only).
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-people-'));
try {
  await writeFile(join(dir, 'people.mjs'), ts.transpileModule(await readFile('src/people.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const { formatPersonShare, formatModelReview, planAllocation, planDeletePerson, nextPersonNumber, planMove, planUnassign, recordsForFilter, isPersonView, UNASSIGNED, UNASSIGNED_FILTER } = await import(pathToFileURL(join(dir, 'people.mjs')).href);
  const rec = (id, personId, imei) => ({ id, personId, imei });
  const base = () => [rec('a', 'p1', '490154203237518'), rec('b', 'p1', '356938035643809'), rec('c', 'p2', '353879234252633'), rec('d', 'p2', '358240051111110')];

  // Move: the previous person loses the record, the destination gains it, Everyone still lists each record once.
  let plan = planMove(base(), ['a'], 'p2');
  assert.deepEqual(plan.moved, ['a']);
  assert.equal(recordsForFilter(plan.records, 'p1').length, 1, 'p1 lost it automatically');
  assert.equal(recordsForFilter(plan.records, 'p2').length, 3, 'p2 gained it');
  assert.equal(recordsForFilter(plan.records, 'All').length, 4, 'Everyone is unchanged: no duplicates, nothing lost');
  assert.equal(new Set(recordsForFilter(plan.records, 'All').map(r => r.id)).size, 4);
  assert.deepEqual(plan.emptiedSources, [], 'p1 still has b');

  // All moved: the source ends up empty and is reported.
  plan = planMove(base(), ['a', 'b'], 'p2');
  assert.deepEqual(plan.moved.sort(), ['a', 'b']);
  assert.deepEqual(plan.emptiedSources, ['p1'], 'All IMEIs moved from p1');
  assert.equal(recordsForFilter(plan.records, 'p1').length, 0);

  // No duplicates: the destination already holds this IMEI, so the record stays where it is.
  const withDup = [...base(), rec('e', 'p2', '490154203237518')];
  plan = planMove(withDup, ['a'], 'p2');
  assert.deepEqual(plan.blocked, ['a']);
  assert.deepEqual(plan.moved, []);
  assert.equal(plan.records.find(r => r.id === 'a').personId, 'p1', 'blocked record is untouched');
  assert.deepEqual(plan.emptiedSources, [], 'a blocked move never empties the source');

  // Two selected records with the same IMEI cannot both land on one person.
  plan = planMove([rec('x', 'p1', '490154203237518'), rec('y', 'p3', '490154203237518')], ['x', 'y'], 'p2');
  assert.equal(plan.moved.length, 1);
  assert.equal(plan.blocked.length, 1);

  // Records without a readable IMEI are never blocked by each other.
  plan = planMove([rec('s1', 'p1', ''), rec('s2', 'p1', ''), rec('s3', 'p2', '')], ['s1', 's2'], 'p2');
  assert.equal(plan.moved.length, 2);

  // Moving to the person who already owns it changes nothing.
  plan = planMove(base(), ['c'], 'p2');
  assert.deepEqual(plan.alreadyThere, ['c']);
  assert.deepEqual(plan.moved, []);

  // Delete under a person: unassigned, still listed under Everyone.
  let un = planUnassign(base(), ['a', 'c'], 'p1');
  assert.deepEqual(un.moved, ['a'], 'only records of that person are unassigned');
  assert.equal(un.records.find(r => r.id === 'a').personId, UNASSIGNED);
  assert.equal(recordsForFilter(un.records, 'All').length, 4, 'still under Everyone');
  assert.equal(recordsForFilter(un.records, UNASSIGNED_FILTER).length, 1);
  assert.equal(recordsForFilter(un.records, 'p1').length, 1);
  assert.deepEqual(planUnassign(base(), ['a'], UNASSIGNED).moved, [], 'nothing to unassign when already unassigned');

  // Unassigned records can be given to a person again.
  plan = planMove(un.records, ['a'], 'p2');
  assert.deepEqual(plan.moved, ['a']);
  assert.equal(recordsForFilter(plan.records, UNASSIGNED_FILTER).length, 0);
  assert.deepEqual(plan.emptiedSources, [], 'unassigned is not a person, so it is never "all moved"');

  // Views: only a real person view turns Delete into "unassign".
  assert.equal(isPersonView('p1'), true);
  assert.equal(isPersonView('All'), false);
  assert.equal(isPersonView(UNASSIGNED_FILTER), false);
  // Everyone never lists a record twice even if the input did.
  assert.equal(recordsForFilter([...base(), rec('a', 'p1', '490154203237518')], 'All').length, 4);
  // Delete a person: keep phones (they become unassigned) or delete them with the person.
  let gone = planDeletePerson(base(), 'p1', false);
  assert.deepEqual(gone.affected.sort(), ['a', 'b']);
  assert.equal(gone.records.length, 4, 'keeping phones loses nothing');
  assert.equal(recordsForFilter(gone.records, UNASSIGNED_FILTER).length, 2);
  assert.equal(recordsForFilter(gone.records, 'p2').length, 2, 'other people are untouched');
  gone = planDeletePerson(base(), 'p1', true);
  assert.deepEqual(gone.records.map(r => r.id).sort(), ['c', 'd']);
  assert.equal(planDeletePerson(base(), 'p9', true).records.length, 4, 'unknown person changes nothing');
  assert.equal(nextPersonNumber(['Person 1', 'Person 3']), 4, 'label of a deleted person is not reused');
  assert.equal(nextPersonNumber([]), 1);

  // Give a model out in amounts: 3 to c, 4 to r, 2 to k, the rest unassigned.
  const model = (people) => people.map((personId, i) => ({ id: 'm' + i, personId, imei: String(100000000000000 + i) }));
  const alloc = (records, parts) => planAllocation(records, records.map(r => r.id), parts);
  let set = model(['', '', '', '', '', '', '', '', '', '']);
  let r = alloc(set, [{ personId: 'c', count: 3 }, { personId: 'r', count: 4 }, { personId: 'k', count: 2 }]);
  const countOf = (plan, person) => plan.records.filter(x => x.personId === person).length;
  assert.deepEqual([countOf(r, 'c'), countOf(r, 'r'), countOf(r, 'k'), countOf(r, '')], [3, 4, 2, 1], 'amounts given, rest unassigned');
  assert.equal(r.records.length, 10, 'nothing lost');
  assert.equal(new Set(r.records.map(x => x.id)).size, 10, 'nothing duplicated');
  assert.deepEqual([r.given.c, r.given.r, r.given.k, r.given['']], [3, 4, 2, 1]);
  // Unchanged amounts change nothing; people keep the phones they already have.
  const again = alloc(r.records, [{ personId: 'c', count: 3 }, { personId: 'r', count: 4 }, { personId: 'k', count: 2 }]);
  assert.equal(again.moved.length, 0, 'same amounts move nothing');
  assert.deepEqual(again.records.map(x => x.personId), r.records.map(x => x.personId));
  // Lowering one person's amount sends the extra phones to unassigned; raising another takes from the rest.
  r = alloc(r.records, [{ personId: 'c', count: 1 }, { personId: 'r', count: 4 }, { personId: 'k', count: 3 }]);
  assert.deepEqual([countOf(r, 'c'), countOf(r, 'r'), countOf(r, 'k'), countOf(r, '')], [1, 4, 3, 2]);
  // Giving to nobody empties everyone and reports who lost all their phones.
  r = alloc(r.records, []);
  assert.equal(countOf(r, ''), 10);
  assert.deepEqual(r.emptiedSources.sort(), ['c', 'k', 'r']);
  // Phones of other models are never touched.
  const mixed = [...model(['c', 'c', '']), { id: 'x', personId: 'c', imei: '999999999999999' }];
  r = planAllocation(mixed, ['m0', 'm1', 'm2'], [{ personId: 'r', count: 2 }]);
  assert.equal(r.records.find(x => x.id === 'x').personId, 'c', 'a phone outside the set stays put');
  assert.deepEqual(['m0', 'm1', 'm2'].map(id => r.records.find(x => x.id === id).personId), ['r', 'r', '']);
  // The same IMEI is never put on someone who already holds it.
  const dup = [{ id: 'a', personId: '', imei: '490154203237518' }, { id: 'b', personId: 'r', imei: '490154203237518' }];
  r = planAllocation(dup, ['a'], [{ personId: 'r', count: 1 }]);
  assert.deepEqual(r.blocked, ['a'], 'duplicate stays unassigned');
  assert.equal(r.records.find(x => x.id === 'a').personId, '');

  // Final review: model by model, who gets how many (the text that is shared).
  const models = [
    { label: 'Galaxy A37 5G', holders: [{ name: 'Carlou', count: 2, numbers: ['351973130210365', '351973130219432'] }, { name: 'Raseen', count: 1, numbers: ['351973130856613'] }] },
    { label: 'Nothing held', holders: [] },
    { label: 'Galaxy Buds3 FE', holders: [{ name: 'Unassigned', count: 1, numbers: ['S/N R5ABC'] }] },
  ];
  assert.equal(formatModelReview(models, false), 'Galaxy A37 5G (3)\nCarlou × 2\nRaseen × 1\n\nGalaxy Buds3 FE (1)\nUnassigned × 1', 'one block per model, one line per person; empty models left out');
  assert.equal(formatModelReview(models, true).split('\n').slice(0, 5).join('|'), 'Galaxy A37 5G (3)|Carlou × 2|  351973130210365|  351973130219432|Raseen × 1', 'numbers sit under their person, without numbering');
  assert.equal(formatModelReview([], true), '');

  // The text sent to one person on WhatsApp: name, then each model with its numbers, no numbering.
  const person = [
    { name: 'Carlou', items: [{ label: 'Galaxy A37 5G', count: 2, numbers: ['351973130210365', '351973130219432'] }, { label: 'Galaxy S25 Ultra', count: 1, numbers: ['356049669060748'] }] },
    { name: 'Nobody', items: [] },
    { name: 'Raseen', items: [{ label: 'Galaxy Buds3 FE', count: 1, numbers: ['S/N R5ABC'] }] },
  ];
  assert.equal(formatPersonShare([person[0]]), 'Carlou (3)\nGalaxy A37 5G (2)\n351973130210365\n351973130219432\nGalaxy S25 Ultra (1)\n356049669060748');
  assert.equal(formatPersonShare(person), 'Carlou (3)\nGalaxy A37 5G (2)\n351973130210365\n351973130219432\nGalaxy S25 Ultra (1)\n356049669060748\n\nRaseen (1)\nGalaxy Buds3 FE (1)\nS/N R5ABC', 'everyone: blocks separated by a blank line, people with nothing left out');
  assert.equal(formatPersonShare([]), '');

  console.log('PASS: moving IMEIs between people (previous owner loses them, no duplicates, All IMEIs moved), delete-under-a-person becomes unassigned under Everyone, unassigned filter.');
} finally { await rm(dir, { recursive: true, force: true }); }
