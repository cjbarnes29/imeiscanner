// The assistant's people commands (src/retail/people-commands.ts): add / rename / delete / list, reviewed and undoable. Synthetic names only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: "export { previewAssistant, applyAssistantRequest, undoAssistantRequest } from './src/retail/assistant-actions'; export { emptyState, cleanState } from './src/retail/data';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const dir = await mkdtemp(join(tmpdir(), 'imei-assistant-people-'));
const file = join(dir, 'people.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { previewAssistant, applyAssistantRequest, undoAssistantRequest, emptyState, cleanState } = await import(pathToFileURL(file).href);

const today = '2026-11-19';
const people = [{ id: 'p1', name: 'Asha Test' }, { id: 'p2', name: 'Bilal Test' }];
const phone = (id, personId) => ({ id, imei: '49015420' + id.padStart(7, '0'), model: 'SM-F956B', personId, name: id });
const preview = (text, list = people, records = []) => previewAssistant(emptyState(), records, list, today, text);
const names = p => p.people?.ops.map(o => o.name);

// 1. the exact sentence that failed on the phone: "add 3 person khuram raseen and carlou" is three people
{
  const p = preview('add 3 person khuram raseen and carlou');
  assert.ok(p.handled); assert.deepEqual(p.blockers, []);
  assert.deepEqual(names(p), ['Khuram', 'Raseen', 'Carlou'], 'three separate people, names tidied');
  assert.ok(new Set(p.people.ops.map(o => o.id)).size === 3, 'distinct ids');
}
// 2. other ways to say it
assert.deepEqual(names(preview('add person Maya Ng, Omar and Lee')), ['Maya Ng', 'Omar', 'Lee'], 'commas and "and" keep full names together');
assert.deepEqual(names(preview('add 2 people Maya Omar')), ['Maya', 'Omar']);
assert.deepEqual(names(preview('please create a new promoter called Zed')), ['Zed']);
assert.deepEqual(names(preview('add Zed as a person')), ['Zed']);
// 3. unclear or unsafe adds change nothing and say why
{
  const wrongCount = preview('add 3 people Maya and Omar');
  assert.ok(wrongCount.blockers[0].includes('You said 3'), wrongCount.blockers[0]); assert.equal(wrongCount.people, undefined);
  assert.match(preview('add 2 people asha test and Omar').blockers[0], /already a person called Asha Test/);
  assert.match(preview('add person').blockers[0], /Say the name/);
  assert.match(preview('add person <script>').blockers[0], /not a usable name/);
  assert.match(preview('add 11 people a b c d e f g h i j k').blockers[0], /at most 10|You said 11/);
}
// 4. rename: only when it clearly names a person
{
  const p = preview('rename Asha to Asha K');
  assert.deepEqual(p.people.ops, [{ kind: 'rename', id: 'p1', from: 'Asha Test', to: 'Asha K' }]);
  assert.equal(preview("change Bilal's name to Bilal R").people.ops[0].to, 'Bilal R');
  assert.match(preview('rename Nobody Here to Zed person').blockers[0], /Choose one saved person/);
  assert.match(preview('rename Asha to Bilal Test').blockers[0], /already a person called/);
  assert.equal(preview('rename Flagship 1 to Premium').people, undefined, 'not a person: left alone');
  const target = preview('change Flagship 3 target to 12');
  assert.equal(target.people, undefined, 'a target change is never read as a rename');
}
// 5. delete: the phones are kept (moved to Unassigned), never deleted; the last person cannot be deleted
{
  const records = [phone('1', 'p2'), phone('2', 'p2'), phone('3', 'p1')];
  const p = preview('delete Bilal', people, records);
  assert.deepEqual(p.people.ops, [{ kind: 'delete', id: 'p2', name: 'Bilal Test', moved: ['1', '2'] }]);
  assert.deepEqual(p.people.moves, [{ id: '1', personId: '' }, { id: '2', personId: '' }]);
  assert.match(p.lines.join(' '), /2 phones move to Unassigned/);
  assert.equal(preview('remove person Asha from the team').people.ops[0].id, 'p1');
  assert.match(preview('delete Asha and Bilal').blockers[0], /At least one person must remain/);
  assert.equal(preview('delete Nobody').people, undefined, 'a bare delete that matches nobody is not a people command');
  assert.equal(preview('remove 2 Fold6 from stock', people, records).people, undefined, 'stock removal is not a person');
  assert.match(preview('delete person Nobody').blockers[0], /Choose one saved person/);
}
// 6. list
{
  const p = preview('list people', people, [phone('1', 'p1')]);
  assert.ok(p.handled); assert.equal(p.people, undefined); assert.match(p.lines.join('\n'), /Asha Test: 1 phones/);
  assert.match(preview('how many people do I have').lines[0], /2 people/);
}
// 7. approve then undo: add, rename and delete all come back exactly; newer changes block the undo
{
  const request = (state, text) => ({ ...state, assistantRequests: [...(state.assistantRequests || []), { id: 'r' + (state.assistantRequests?.length || 0), at: '2026-11-19T00:00:00Z', text, output: '', status: 'pending' }] });
  let state = request(emptyState(), 'add 2 people Maya and Omar');
  const added = applyAssistantRequest(state, [], people, today, 'r0');
  assert.equal(added.people.length, 2); assert.equal(added.next.assistantRequests[0].status, 'applied');
  assert.equal(added.next.assistantRequests[0].peopleOps.length, 2, 'the receipt keeps the changes for Undo');
  const now = [...people, ...added.people.map(o => ({ id: o.id, name: o.name }))];
  const kept = cleanState(added.next);
  assert.equal(kept.assistantRequests[0].peopleOps.length, 2, 'the receipt survives saving and loading');
  const undone = undoAssistantRequest(added.next, [], 'r0', now);
  assert.deepEqual(undone.people.map(o => o.kind), ['delete', 'delete']);
  assert.throws(() => undoAssistantRequest(added.next, [phone('9', now[2].id)], 'r0', now), /has phones now|blocked/, 'a person who got phones cannot be undone away');
  assert.throws(() => undoAssistantRequest(added.next, [], 'r0', now.map(p => p.name === 'Maya' ? { ...p, name: 'Maya Renamed' } : p)), /renamed|blocked/);

  // delete with phones, then undo gives the phones back to the same person id
  const records = [phone('1', 'p2'), phone('2', 'p2')];
  const del = request(emptyState(), 'delete Bilal');
  const applied = applyAssistantRequest(del, records, people, today, 'r0');
  assert.deepEqual(applied.changes, [{ id: '1', personId: '' }, { id: '2', personId: '' }]);
  const after = [people[0]], movedRecords = records.map(r => ({ ...r, personId: '' }));
  const back = undoAssistantRequest(applied.next, movedRecords, 'r0', after);
  assert.deepEqual(back.people, [{ kind: 'add', id: 'p2', name: 'Bilal Test' }]);
  assert.deepEqual(back.changes, [{ id: '1', personId: 'p2' }, { id: '2', personId: 'p2' }]);
  assert.throws(() => undoAssistantRequest(applied.next, [{ ...movedRecords[0], personId: 'p1' }, movedRecords[1]], 'r0', after), /given to someone/);
  assert.throws(() => undoAssistantRequest(applied.next, movedRecords, 'r0', [people[0], { id: 'x', name: 'bilal test' }]), /Another person is called/);

  const ren = request(emptyState(), 'rename Asha to Asha K');
  const renamed = applyAssistantRequest(ren, [], people, today, 'r0');
  const backName = undoAssistantRequest(renamed.next, [], 'r0', [{ id: 'p1', name: 'Asha K' }, people[1]]);
  assert.deepEqual(backName.people, [{ kind: 'rename', id: 'p1', from: 'Asha K', to: 'Asha Test' }]);
  assert.throws(() => undoAssistantRequest(renamed.next, [], 'r0', people), /changed after this action/);
}
// 8. with nobody saved yet, any target command says so plainly (it used to explain "dividing a store target", and looked like it worked)
for (const text of ['split store target 120 for Flagship 1 among everyone', "set everyone's Flagship 1 target to 8", 'set my Flagship 1 target to 10', 'set Flagship 1 target to 12']) {
  const p = preview(text, []);
  assert.ok(p.handled, text); assert.equal(p.business, undefined, text);
  assert.match(p.blockers.join(' '), /Add your people first/, text);
}
console.log('people commands: add, rename, delete, list, approve and undo all checked');
