// Failure reasons (words only), the report's new counts, and the plan for what a retry replaces: no duplicates, nothing a person wrote is overwritten.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-reason-'));
const compile=async name=>writeFile(join(dir,name+'.mjs'),ts.transpileModule((await readFile('src/'+name+'.ts','utf8')).replace(/from '\.\/([a-z-]+)'/g,(_,m)=>"from './"+m+".mjs'"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
for(const name of ['fail-reason','scan-report','rescan-pair'])await compile(name);
const load=name=>import(pathToFileURL(join(dir,name+'.mjs')).href);
const F=await load('fail-reason'),R=await load('scan-report'),P=await load('rescan-pair');

// ---- reason wording: every kind has words, none contains a digit-run that could be a number, unknown kinds are ignored
for(const kind of F.FAIL_KINDS){
  assert.ok(F.failReasonShort(kind).length>3,kind+' has a short phrase');
  assert.ok(F.failReasonText(kind).endsWith('.'),kind+' has a sentence');
  assert.ok(!/\d{4,}/.test(F.failReasonShort(kind)+F.failReasonText(kind)),kind+': no number can appear');
}
assert.equal(F.failReasonShort('from-a-newer-app'),'');assert.equal(F.failReasonText(''),'');
assert.ok(F.isFailKind('no-text'));assert.ok(!F.isFailKind('x'));assert.ok(!F.isFailKind(5));
assert.deepEqual(F.readReasons({'partial-number':2,'no-text':1,'weird':4,'cut-edge':0,'imei2-only':-3,'checksum-failed':'x'}),{'partial-number':2,'no-text':1},'only known kinds with positive counts survive');
assert.deepEqual(F.readReasons(null),{});assert.deepEqual(F.readReasons('x'),{});assert.deepEqual(F.readReasons({'no-text':2.9}),{'no-text':2});
assert.equal(F.reasonsLine({'no-text':1,'partial-number':2}),'2 IMEI 1 only partly read · 1 no label text found','fixed order, not insertion order');
assert.equal(F.reasonsLine({}),'');assert.equal(F.reasonsLine(undefined),'');

// ---- the report: counts per reason and the retry
const s=R.readSummary({photos:3,scanned:3,products:4,saved:3,imeisDetected:2,missingImei:2,reasons:{'partial-number':1,'no-text':1},retried:2,recovered:1,unresolved:1,retryPending:0});
assert.deepEqual(s.reasons,{'partial-number':1,'no-text':1});assert.equal(s.retried,2);assert.equal(s.recovered,1);assert.equal(s.unresolved,1);
assert.deepEqual(R.readSummary(undefined).reasons,{});assert.equal(R.readSummary({}).retried,0,'an older app sends none of it');
assert.match(R.summaryLine(s),/2 without an IMEI \(1 IMEI 1 only partly read · 1 no label text found\)/);
assert.match(R.summaryLine(s),/retried 2 photos: 1 recovered, 1 still unresolved/);
assert.match(R.summaryLine({...s,recovered:0,unresolved:2}),/retried 2 photos: nothing more could be read/);
assert.match(R.summaryLine({...s,retried:0,retryPending:3}),/3 photos waiting to be tried again/);
assert.doesNotMatch(R.summaryLine({...s,missingImei:0,reasons:{}}),/without an IMEI/,'only what applies is worded');
const rp=R.parseReport(JSON.stringify({jobId:'j',report:s,photos:[
  {uri:'a',name:'a.jpg',jobId:'j',outcome:'scanned',products:2,imeis:['x'],missingImei:1,reasons:{'partial-number':1},autoRetry:'done',recovered:1},
  {uri:'b',name:'b.jpg',jobId:'j',outcome:'scanned',products:1,imeis:[],missingImei:1,reasons:{'no-text':1},autoRetry:'pending'},
  {uri:'c',name:'c.jpg',jobId:'j',outcome:'scanned',products:1,imeis:['y'],missingImei:0,reasons:{'imei2-only':1}}]}));
assert.deepEqual(rp.photos[0].reasons,{'partial-number':1});assert.equal(rp.photos[0].autoRetry,'done');assert.equal(rp.photos[0].recovered,1);
assert.match(R.photoStatus(rp.photos[0]).label,/1 without an IMEI \(1 IMEI 1 only partly read\) · tried again: 1 recovered/);
assert.match(R.photoStatus(rp.photos[1]).label,/1 without an IMEI \(1 no label text found\) · waiting to be tried again/);
assert.match(R.photoStatus(rp.photos[2]).label,/only IMEI 2 read/,'IMEI 2 only is said even though a number was read');
assert.equal(rp.photos[2].autoRetry,'');

// ---- what a retry replaces
const old=(id,imei,extra={})=>({id,imei,personId:'person-1',number:5,serial:'',checked:false,...extra});
const added=(id,imei,replaces)=>({id,imei,replaces});
const A='A'.repeat(15),B='B'.repeat(15);
let plan=P.planReplacements([old('e1','',{personId:'person-7',number:12,serial:'TYPED123'})],[added('n1',A,'e1')]);
assert.deepEqual(plan.replace,[{oldId:'e1',newId:'n1',inherit:{personId:'person-7',number:12,serial:'TYPED123'}}],'the new record takes the person, the number and the serial of the unreadable one');
assert.deepEqual(plan.drop,[]);assert.deepEqual(plan.flag,[]);
plan=P.planReplacements([old('e1','')],[added('n1',A,'e1')]);
assert.equal(plan.replace[0].inherit.serial,undefined,'no serial typed: nothing to inherit');
// a person typed the number meanwhile: it wins, the new row is not added
plan=P.planReplacements([old('e1',A)],[added('n1',A,'e1')]);
assert.deepEqual(plan.replace,[]);assert.deepEqual(plan.drop,['n1'],'same number: no second record of the label');assert.deepEqual(plan.flag,[]);
plan=P.planReplacements([old('e1',B,{checked:true})],[added('n1',A,'e1')]);
assert.deepEqual(plan.drop,['n1'],'a different reading never overwrites what a person typed or confirmed');
assert.deepEqual(plan.flag,[{id:'e1',note:P.DIFFERENT_READING_NOTE}],'…it only asks for a look');
assert.ok(!/\d{6}/.test(P.DIFFERENT_READING_NOTE),'the note holds no number');
// an IMEI 2 stand-in nobody confirmed is replaced by the recovered IMEI 1; once a person confirmed it, it is kept
plan=P.planReplacements([old('e1',B,{fallback:true})],[added('n1',A,'e1')]);assert.equal(plan.replace.length,1);assert.deepEqual(plan.drop,[]);
plan=P.planReplacements([old('e1',B,{fallback:true,checked:true})],[added('n1',A,'e1')]);assert.equal(plan.replace.length,0);assert.deepEqual(plan.drop,['n1']);
// an unfinished typed number counts as typed
plan=P.planReplacements([old('e1','4901')],[added('n1',A,'e1')]);assert.deepEqual(plan.drop,['n1']);assert.equal(plan.replace.length,0);
// the earlier record is gone (deleted, or archived already): the new row is added as usual
plan=P.planReplacements([old('other','')],[added('n1',A,'e1')]);
assert.deepEqual(plan,{replace:[],drop:[],flag:[]});
// rows that replace nothing are untouched
plan=P.planReplacements([old('e1','')],[added('n1',A,undefined),added('n2',B,'')]);assert.deepEqual(plan,{replace:[],drop:[],flag:[]});
// two new rows naming the same earlier record: only the first replaces it (never two records for one label)
plan=P.planReplacements([old('e1','')],[added('n1',A,'e1'),added('n2',B,'e1')]);
assert.equal(plan.replace.length,1);assert.equal(plan.replace[0].newId,'n1');assert.deepEqual(plan.drop,[],'the second is simply added');
// a whole photo: two unreadable labels both recovered
plan=P.planReplacements([old('e1','',{number:3}),old('e2','',{number:4}),old('keep','1'.repeat(15))],[added('n1',A,'e1'),added('n2',B,'e2')]);
assert.deepEqual(plan.replace.map(r=>[r.oldId,r.newId,r.inherit.number]),[['e1','n1',3],['e2','n2',4]]);
console.log('PASS: failure reasons (words only), report counts and wording, and the replacement plan (inherit person/number/serial, never overwrite a typed number, no pairs left behind).');
