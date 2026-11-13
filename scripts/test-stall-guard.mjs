// Queue stall limit: a photo that never finishes is set aside, late results are ignored, healthy work is untouched.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-stall-'));
await writeFile(join(dir,'stall-guard.mjs'),ts.transpileModule(await readFile('src/stall-guard.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const g=await import(pathToFileURL(join(dir,'stall-guard.mjs')).href);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// the limit is long enough for a slow phone and is not a few seconds
assert.ok(g.QUEUE_ITEM_LIMIT_MS>=3*60*1000&&g.QUEUE_ITEM_LIMIT_MS<=10*60*1000,'conservative: between 3 and 10 minutes');

// healthy work finishes first: result passes through, nothing is stalled
let guard=g.createStallGuard(200,'too slow');
assert.equal(await guard.race(sleep(10).then(()=>'done')),'done');assert.equal(guard.stalled(),false);guard.check();guard.cancel();
await sleep(260);assert.equal(guard.stalled(),false,'a cancelled guard never fires');

// work that never answers: rejected with a StallError after the limit
guard=g.createStallGuard(40,'set aside');
const t0=Date.now();
await assert.rejects(guard.race(new Promise(()=>{})),e=>e instanceof g.StallError&&e.message==='set aside'&&e.name==='StallError');
assert.ok(Date.now()-t0>=35&&Date.now()-t0<500);assert.equal(guard.stalled(),true);

// late results are ignored: after the limit, check() stops any step that would change data
assert.throws(()=>guard.check(),g.StallError);

// work that fails on its own: its own error passes through (not a stall)
guard=g.createStallGuard(200,'x');
await assert.rejects(guard.race(Promise.reject(new Error('boom'))),/boom/);assert.equal(guard.stalled(),false);guard.cancel();

// a late failure of the abandoned work does not become an unhandled rejection
let unhandled=0;const onUnhandled=()=>{unhandled++;};process.on('unhandledRejection',onUnhandled);
guard=g.createStallGuard(20,'x');
await assert.rejects(guard.race(new Promise((_,rej)=>setTimeout(()=>rej(new Error('late')),80))),g.StallError);
await sleep(150);process.off('unhandledRejection',onUnhandled);assert.equal(unhandled,0);

// a guard that is created and cancelled without racing does not raise anything either
guard=g.createStallGuard(20,'x');guard.cancel();await sleep(60);
console.log('PASS: queue stall limit (conservative 5 min, healthy work untouched, a stuck photo is rejected with a StallError, late results are stopped by check(), own errors pass through, no unhandled rejections).');
