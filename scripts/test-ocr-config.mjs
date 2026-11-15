// Text-reader start-up: the Android build serves plain eng.traineddata, the website serves the .gz, and a reader that
// cannot start must reject (with a message) instead of hanging forever.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-ocr-'));
const src=await readFile('src/ocr-config.ts','utf8');
await writeFile(join(dir,'ocr-config.mjs'),ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const o=await import(pathToFileURL(join(dir,'ocr-config.mjs')).href);
const BASE='https://appassets.androidplatform.net/assets/ocr';

// options
assert.equal(o.ocrWorkerOptions(BASE,true).gzip,false,'Android serves eng.traineddata without .gz');
assert.equal(o.ocrWorkerOptions(BASE,false).gzip,true,'the website keeps the .gz it ships');
assert.equal(o.ocrWorkerOptions(BASE,true).langPath,BASE);assert.equal(o.ocrWorkerOptions(BASE,true).workerPath,BASE+'/worker.min.js');assert.equal(o.ocrWorkerOptions(BASE,true).corePath,BASE);

// a reader that starts normally
let seen;
const ok={terminated:0,terminate(){this.terminated++;return Promise.resolve();}};
const w=await o.startOcrWorker(async(lang,oem,opts)=>{seen={lang,oem,opts};return ok;},BASE,true,500);
assert.equal(w,ok);assert.equal(seen.lang,'eng');assert.equal(seen.oem,1);assert.equal(seen.opts.gzip,false);assert.equal(typeof seen.opts.errorHandler,'function','an errorHandler is always passed (without one tesseract.js throws instead of rejecting)');

// language data fails to load: tesseract.js never settles createWorker but calls the errorHandler -> we reject at once
const t0=Date.now();
await assert.rejects(o.startOcrWorker((lang,oem,opts)=>{setTimeout(()=>opts.errorHandler('Network error while fetching eng.traineddata. Response code: 404'),5);return new Promise(()=>{});},BASE,true,5000),/Response code: 404/);
assert.ok(Date.now()-t0<1000,'the failure is reported immediately, not after the time limit');

// nothing happens at all: the time limit rejects
await assert.rejects(o.startOcrWorker(()=>new Promise(()=>{}),BASE,false,60),/did not start within/);

// a plain rejection passes through as an Error
await assert.rejects(o.startOcrWorker(()=>Promise.reject(new Error('boom')),BASE,false,500),/boom/);
await assert.rejects(o.startOcrWorker(()=>Promise.reject('text only'),BASE,false,500),/text only/);

// a reader that arrives after the time limit is shut down, not leaked
const late={terminated:0,terminate(){this.terminated++;return Promise.resolve();}};
await assert.rejects(o.startOcrWorker(()=>new Promise(r=>setTimeout(()=>r(late),80)),BASE,false,30),/did not start/);
await new Promise(r=>setTimeout(r,150));
assert.equal(late.terminated,1,'a late reader is terminated');

// errors after a successful start (individual jobs) are ignored by the start-up handler and do not throw
let handler;const fine={terminate:()=>Promise.resolve()};
await o.startOcrWorker(async(l,m,opts)=>{handler=opts.errorHandler;return fine;},BASE,true,500);
assert.doesNotThrow(()=>handler('a later job failed'));

console.log('PASS: text reader options (Android plain eng.traineddata vs website .gz), start-up failure and timeout become rejections, a late reader is terminated, later job errors do not throw.');
