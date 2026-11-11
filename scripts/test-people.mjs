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
  const { planMove, planUnassign, recordsForFilter, isPersonView, UNASSIGNED, UNASSIGNED_FILTER } = await import(pathToFileURL(join(dir, 'people.mjs')).href);
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
  console.log('PASS: moving IMEIs between people (previous owner loses them, no duplicates, All IMEIs moved), delete-under-a-person becomes unassigned under Everyone, unassigned filter.');
} finally { await rm(dir, { recursive: true, force: true }); }
