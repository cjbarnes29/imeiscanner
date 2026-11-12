// Background crop queue: storage, merging, dropping photos that are gone.
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
const s=store();
assert.ok(q.writeQueue(s,[{recordId:'a',boxes:[box],auto:false},{recordId:'b',boxes:[],auto:true}]));
let back=q.readQueue(s);assert.equal(back.length,2);assert.equal(back[1].auto,true,'no boxes means auto');
back=q.readQueue(s,new Set(['a']));assert.deepEqual(back.map(i=>i.recordId),['a'],'photos that are gone are dropped');
assert.deepEqual(q.mergeQueue([{recordId:'a',boxes:[box],auto:false}],[{recordId:'a',boxes:[],auto:false},{recordId:'c',boxes:[box],auto:false}]).map(i=>[i.recordId,i.auto]),[['a',true],['c',false]],'a new entry replaces the waiting one; empty boxes become auto');
assert.deepEqual(q.parseQueue('not json'),[]);assert.deepEqual(q.parseQueue(JSON.stringify({version:2,items:[]})),[]);
assert.equal(q.parseQueue(JSON.stringify({version:1,items:[{recordId:'a',boxes:[{x:-5,y:0,width:10,height:10}]}]}))[0].boxes.length,0,'invalid boxes are dropped');
q.writeQueue(s,[]);assert.equal(s.getItem(q.QUEUE_KEY),null,'an empty queue is removed');
console.log('PASS: crop queue (store, drop missing photos, merge, auto when no boxes, bad data).');
