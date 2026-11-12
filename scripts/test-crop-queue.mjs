// Background crop queue: statuses, set aside / resume, retry, duplicate prevention, the finished-photo log, recovery.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-queue-'));
for(const name of ['crop-queue','crop-draft','crop-boxes']){const src=(await readFile(`src/${name}.ts`,'utf8')).replace(/from '\.\/([\w-]+)'/g,"from './$1.mjs'");await writeFile(join(dir,name+'.mjs'),ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);}
const q=await import(pathToFileURL(join(dir,'crop-queue.mjs')).href);
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>void m.set(k,v),removeItem:k=>void m.delete(k)};};
const box={x:10,y:10,width:50,height:30};
const ids=(l)=>l.map(i=>i.recordId);

// store / read / drop missing photos / bad data
let s=store();
assert.ok(q.writeQueue(s,[q.newItem('a',[box],'a.jpg'),q.newItem('b',[],'b.jpg')]));
let back=q.readQueue(s);assert.equal(back.length,2);assert.equal(back[1].auto,true,'no boxes means auto');assert.equal(back[0].status,'pending');
assert.deepEqual(ids(q.readQueue(s,new Set(['a']))),['a'],'photos that are gone are dropped');
assert.deepEqual(q.parseQueue('not json'),[]);assert.deepEqual(q.parseQueue(JSON.stringify({version:2,items:[]})),[]);
assert.equal(q.parseQueue(JSON.stringify({version:1,items:[{recordId:'a',boxes:[{x:-5,y:0,width:10,height:10}]}]}))[0].boxes.length,0,'invalid boxes are dropped');
assert.equal(q.parseQueue(JSON.stringify({version:1,items:[{recordId:'a',status:'processing'}]}))[0].status,'pending','"processing" is never stored: an interrupted item starts again');
assert.equal(q.parseQueue(JSON.stringify({version:1,items:[{recordId:'a'},{recordId:'a'}]})).length,1,'the same photo is never in the queue twice');
q.writeQueue(s,[]);assert.equal(s.getItem(q.QUEUE_KEY),null,'an empty queue is removed');

// duplicate prevention on merge
let queue=q.mergeQueue([q.newItem('a',[box])],[q.newItem('a',[]),q.newItem('c',[box])]);
assert.deepEqual(queue.map(i=>[i.recordId,i.auto]),[['a',true],['c',false]],'queuing a waiting photo again replaces it, never duplicates');

// process later: set aside keeps boxes and progress; resume includes it; next skips it
queue=[q.newItem('a',[box]),q.newItem('b',[]),q.newItem('c',[box])];
queue=q.setLater(queue,'a');
assert.equal(q.nextPending(queue).recordId,'b','a set-aside photo is skipped');
assert.deepEqual(q.counts(queue),{pending:2,later:1,failed:0});
assert.equal(queue[0].boxes.length,1,'boxes are kept while set aside');
queue=q.promoteLater(queue);
assert.deepEqual(q.counts(queue),{pending:3,later:0,failed:0},'resuming includes the photos set aside');

// failures: marked, counted, skipped by the runner, retried back to pending, bounded attempts
queue=q.markFailed(queue,'b','no label found');
assert.equal(queue.find(i=>i.recordId==='b').status,'failed');assert.equal(queue.find(i=>i.recordId==='b').attempts,1);
assert.notEqual(q.nextPending(queue).recordId,'b','failed photos are not retried silently');
assert.equal(q.setLater(queue,'b').find(i=>i.recordId==='b').status,'failed','a failed photo cannot be set aside');
queue=q.retryItem(queue,'b');assert.equal(queue.find(i=>i.recordId==='b').status,'pending');assert.equal(queue.find(i=>i.recordId==='b').error,undefined);
queue=q.markFailed(q.markFailed(queue,'a','x'),'c','y');queue=q.retryAllFailed(queue);assert.equal(q.counts(queue).failed,0);
let bounded=q.newItem('z',[]);for(let i=0;i<20;i++)bounded=q.markFailed([bounded],'z','e')[0];
assert.equal(q.parseQueue(JSON.stringify({version:1,items:[bounded]}))[0].attempts,9,'attempt counter is bounded');
// survives a restart with its statuses
s=store();q.writeQueue(s,[q.setLater([q.newItem('a',[box])],'a')[0],q.markFailed([q.newItem('b',[])],'b','no label found')[0]]);
back=q.readQueue(s);assert.deepEqual(back.map(i=>i.status),['later','failed']);assert.equal(back[1].error,'no label found');
assert.deepEqual(q.removeItem(back,'a').map(i=>i.recordId),['b']);

// finished log: add, replace, drop vanished records, classify
let log=[];
log=q.addLog(log,{originalId:'o1',name:'one.jpg',recordIds:['r1','r2'],at:'t'});
log=q.addLog(log,{originalId:'o2',name:'two.jpg',recordIds:['r3'],at:'t'});
log=q.addLog(log,{originalId:'o1',name:'one.jpg',recordIds:['r1','r2','r4'],at:'t2'});
assert.equal(log.length,2,'a photo is logged once');
q.writeLog(s,log);assert.deepEqual(q.readLog(s,new Set(['r1','r3'])).map(e=>e.recordIds),[['r3'],['r1']],'records that no longer exist are dropped from the log');
let c=q.classifyLog(log,new Set(['r3']));
assert.deepEqual(c.review.map(e=>e.originalId),['o2']);assert.deepEqual(c.completed.map(e=>e.originalId),['o1']);
c=q.classifyLog(log.map(e=>e.originalId==='o2'?{...e,approved:true}:e),new Set(['r3']));
assert.deepEqual(c.review,[],'approving moves a photo to Completed');assert.equal(c.completed.length,2);
const big=Array.from({length:400},(_,i)=>({originalId:'o'+i,name:'n',recordIds:['r'+i],at:'t'}));
assert.equal(big.reduce((l,e)=>q.addLog(l,e),[]).length,300,'the log is bounded');
console.log('PASS: crop queue (statuses, set aside and resume, retry, duplicate prevention, restart recovery, finished log, Needs Review / Completed).');
