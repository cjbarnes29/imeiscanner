// Archive of split originals: nothing is deleted, crops stay linked, restore brings the original back and keeps the crops.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-archive-'));
const tr=async(from,to)=>writeFile(join(dir,to),ts.transpileModule(await readFile(from,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
await tr('src/archive-store.ts','archive-store.mjs');
const a=await import(pathToFileURL(join(dir,'archive-store.mjs')).href);

const original={id:'o1',sourcePictureId:'S1',imei:''};
const crops=[{id:'c1',sourceRecordId:'o1'},{id:'c2',sourceRecordId:'o1'}];
const entry=a.makeEntry(original,['c1','c2'],'queue','2026-01-01T00:00:00Z');
assert.deepEqual(entry.record,original,'the original is stored whole');
assert.equal(entry.reason,'queue');

// queueing protects the stored photo from the orphan clean-up until restored
a.queueArchive(entry);assert.equal(a.isProtectedSource('S1'),true);
a.setProtectedSources([{...entry,restoredAt:'x'}]);assert.equal(a.isProtectedSource('S1'),false,'restored: no longer protected');

// restore: original back at the crops' place, crops out of the list but kept in the entry, other rows untouched
const visible=[{id:'x'},...crops,{id:'y'}];
const plan=a.planRestore(entry,visible,'2026-02-02T00:00:00Z');
assert.deepEqual(plan.records.map(r=>r.id),['x','o1','y']);
assert.deepEqual(plan.entry.removedCrops.map(r=>r.id),['c1','c2']);
assert.equal(plan.entry.restoredAt,'2026-02-02T00:00:00Z');
assert.equal(visible.length,4,'input list is not modified');

// crops already deleted by the user: the original still comes back (at the end)
const none=a.planRestore(entry,[{id:'x'}]);assert.deepEqual(none.records.map(r=>r.id),['x','o1']);

// a second split + restore keeps what was recovered before
const again=a.planRestore({...plan.entry,restoredAt:undefined},[{id:'c3',sourceRecordId:'o1'}]);
assert.deepEqual(again.entry.removedCrops.map(r=>r.id),['c1','c2','c3']);
// archived duplicate: no crops; the record comes back whole, the link to the kept record stays in the entry
const dup={id:'d1',sourcePictureId:'S9',imei:'490154203237518'};
const dupEntry={...a.makeEntry(dup,[],'duplicate-removal','2026-03-03T00:00:00Z'),duplicateOf:'k1'};
const kept=[{id:'k1'},{id:'z'}];
const back=a.planRestore(dupEntry,kept,'2026-03-04T00:00:00Z');
assert.deepEqual(back.records.map(r=>r.id),['k1','z','d1'],'restored duplicate returns, nothing else changes');
assert.equal(back.entry.duplicateOf,'k1');assert.equal(back.entry.removedCrops.length,0);assert.equal(back.entry.restoredAt,'2026-03-04T00:00:00Z');
console.log('archive tests passed');
