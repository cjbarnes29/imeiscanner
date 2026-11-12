import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-learn-'));
const load=async name=>{await writeFile(join(dir,name+'.mjs'),ts.transpileModule(await readFile(`src/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);return import(pathToFileURL(join(dir,name+'.mjs')).href);};
const c=await load('confidence'),l=await load('learning');

// Confidence
const good=c.scoreConfidence({imei:'351326788205072',luhnOk:true,barcodeConfirmed:true,imei2Valid:true,serial:'RFGL81NKELD',model:'SM-A165F',catalogMatched:true,duplicate:false});
assert.equal(good.level,'high');assert.ok(good.score>=95);
const plain=c.scoreConfidence({imei:'351326788205072',luhnOk:true,barcodeConfirmed:false,imei2Valid:false,serial:'',model:'Unknown unit — review',catalogMatched:false,duplicate:false});
assert.equal(plain.level,'medium','a valid IMEI alone is medium, not flagged');
const bad=c.scoreConfidence({imei:'351326788205073',luhnOk:false,barcodeConfirmed:false,imei2Valid:false,serial:'',model:'',catalogMatched:false,duplicate:true,cropNeedsReview:true});
assert.equal(bad.level,'low');assert.ok(bad.reasons.some(r=>/NOT valid/.test(r)));
const none=c.scoreConfidence({imei:'',luhnOk:false,barcodeConfirmed:false,imei2Valid:false,serial:'RFGL81NKELD',model:'SM-A165F',catalogMatched:true,duplicate:false});
assert.ok(none.score<=45&&none.level==='low','no IMEI is capped low even with serial and model');

// Learning: verified corrections
assert.equal(l.modelCodeOf('SM-A165F/DS'),'A165F');
let learned=l.learnCorrection({},'SM-A1O5F','SM-A165F');
assert.deepEqual(learned,{A1O5F:{to:'A165F',count:1}});
assert.equal(l.refineModel('SM-A1O5F',[],learned).model,'SM-A165F');assert.equal(l.refineModel('SM-A1O5F',[],learned).source,'learned');
assert.deepEqual(l.learnCorrection({},'SM-A165F','SM-S938B'),{},'unrelated model changes are not learned');
assert.equal(l.learnCorrection(learned,'SM-A1O5F','SM-A165F').A1O5F.count,2,'repeat confirmations count up');
// Named (catalog) models are never touched
assert.equal(l.refineModel('Samsung Galaxy A16 (SM-A1O5F)',[],learned).model,'Samsung Galaxy A16 (SM-A1O5F)');

// Repeated model references
const others=['SM-A165F','SM-A165F','SM-A165F','Samsung Galaxy S25'];
assert.equal(l.refineModel('SM-A1B5F',others,{}).model,'SM-A165F');assert.equal(l.refineModel('SM-A1B5F',others,{}).source,'consensus');
assert.equal(l.refineModel('SM-A165F',others,{}).model,'SM-A165F','an already agreed code is kept');
assert.equal(l.refineModel('SM-A1B5F',['SM-A165F'],{}).model,'SM-A1B5F','one reference is not enough');
assert.equal(l.refineModel('SM-A999F',others,{}).model,'SM-A999F','a different model is not forced to match');
assert.equal(l.distance('A165F','A1O5F'),1);
console.log('PASS: confidence scoring (high / medium / low, capped without IMEI), learning from verified model corrections, correcting a misread code from repeated references, catalog names left alone.');
