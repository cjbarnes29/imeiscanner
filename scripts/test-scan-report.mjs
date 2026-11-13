// Scan report: reading what the app sends, wording it honestly, and the accounting rules (nothing selected can vanish).
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-report-'));
await writeFile(join(dir,'scan-report.mjs'),ts.transpileModule(await readFile('src/scan-report.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const r=await import(pathToFileURL(join(dir,'scan-report.mjs')).href);

// summary: missing or bad values count as 0 (an older app sends no report)
assert.deepEqual(r.readSummary(undefined),r.EMPTY_SUMMARY);
assert.deepEqual(r.readSummary({photos:'x',products:NaN,saved:3}).saved,3);
assert.equal(r.readSummary({photos:'x'}).photos,0);
assert.equal(r.summaryLine(r.EMPTY_SUMMARY),'','no photos, no line');

// the example scan: 4 photos = 2 scanned + 1 failed + 1 repeated picture; 3 products = 2 saved + 1 duplicate IMEI; 2 IMEIs read + 1 without
const s={photos:4,scanned:2,failed:1,duplicatePhotos:1,products:3,saved:2,imeisDetected:2,missingImei:1,duplicateImeis:1,emptyRepeats:0,review:1,needRescanInJob:2,needRescan:3};
assert.ok(r.isBalanced(s));
assert.equal(r.summaryLine(s),'3 products found · 2 IMEIs read · 1 without an IMEI · 1 duplicate IMEI not saved again · 1 repeated picture · 1 photo could not be read · 1 to review');
assert.ok(!r.isBalanced({...s,saved:3}),'products that are neither saved nor a linked duplicate are caught');
assert.ok(!r.isBalanced({...s,failed:0}),'a photo without an outcome is caught');
assert.ok(!r.isBalanced({...s,missingImei:0}),'products must be either read or without an IMEI');
// only what applies is worded; singular and plural
assert.equal(r.summaryLine({...r.EMPTY_SUMMARY,photos:1,scanned:1,products:1,saved:1,imeisDetected:1}),'1 product found · 1 IMEI read');
assert.equal(r.summaryLine({...r.EMPTY_SUMMARY,photos:2,scanned:2,products:4,saved:4,imeisDetected:4}),'4 products found · 4 IMEIs read');
assert.match(r.summaryLine({...r.EMPTY_SUMMARY,photos:3,failed:3}),/3 photos could not be read/);

// the report from the app
const ok={uri:'u1',name:'a.jpg',jobId:'J',outcome:'scanned',products:2,saved:1,imeis:['351973130000001','351973130000002'],missingImei:0,duplicates:[{imei:'351973130000002',of:'rec'}],review:0,reason:'',needsRescan:false,scans:1};
const bad={uri:'u2',name:'b.jpg',jobId:'J',outcome:'failed',products:0,saved:0,imeis:[],missingImei:0,duplicates:[],review:0,reason:'IllegalArgumentException: Cannot decode image',needsRescan:true};
const blank={uri:'u3',name:'c.jpg',jobId:'J',outcome:'scanned',products:1,saved:1,imeis:[],missingImei:1,duplicates:[],review:1,reason:'',needsRescan:true,scans:3};
const copy={uri:'u4',name:'d.jpg',jobId:'J',outcome:'duplicate-photo',duplicateOfUri:'u1',products:0,saved:0,imeis:[],missingImei:0,duplicates:[],review:0,reason:'',needsRescan:false};
const old={uri:'u9',name:'e.jpg',jobId:'OLD',outcome:'failed',products:0,saved:0,imeis:[],missingImei:0,duplicates:[],review:0,reason:'earlier',needsRescan:true};
const old2={uri:'u8',name:'f.jpg',jobId:'OLD',outcome:'scanned',products:1,saved:1,imeis:['351973130000003'],missingImei:0,duplicates:[],review:0,reason:'',needsRescan:false};
const data=r.parseReport(JSON.stringify({jobId:'J',report:s,photos:[ok,bad,blank,copy,old,old2]}));
assert.equal(data.photos.length,6);assert.equal(data.report.photos,4);
assert.equal(r.parseReport('not json'),null);assert.equal(r.parseReport('{"photos":5}'),null);
assert.equal(r.parseReport(JSON.stringify({photos:[null,5,ok]})).photos.length,1,'garbage entries are skipped, not trusted');

// a repeat scan of photos that already have an empty record: the empty products are linked, not added again, and the numbers still add up
const rep={photos:3,scanned:3,failed:0,duplicatePhotos:0,products:3,saved:0,imeisDetected:0,missingImei:3,duplicateImeis:0,emptyRepeats:3,review:0,needRescanInJob:3,needRescan:3};
assert.ok(r.isBalanced(rep),'products = saved + duplicate IMEIs + empty repeats');
assert.ok(!r.isBalanced({...rep,emptyRepeats:2}),'an empty product that is neither saved nor linked is caught');
assert.equal(r.summaryLine(rep),'3 products found · 0 IMEIs read · 3 without an IMEI · 3 unreadable records already listed, not added again');
assert.equal(r.readSummary({emptyRepeats:2}).emptyRepeats,2);assert.equal(r.readSummary({}).emptyRepeats,0,'an older app sends no emptyRepeats');
const repeatPhoto={uri:'u5',name:'g.jpg',jobId:'J',outcome:'scanned',products:1,saved:0,imeis:[],missingImei:1,duplicates:[],emptyRepeats:[{of:'rec-old'}],supersedes:[],review:0,reason:'',needsRescan:true};
const parsed=r.parseReport(JSON.stringify({jobId:'J',report:rep,photos:[repeatPhoto]})).photos[0];
assert.deepEqual(parsed.emptyRepeats,[{of:'rec-old'}]);assert.deepEqual(parsed.supersedes,[]);
assert.match(r.photoStatus(parsed).label,/1 unreadable already listed, not added again/);assert.equal(r.photoStatus(parsed).tone,'warn','still without an IMEI, so it stays flagged (and eligible for a new scan)');
const later=r.parseReport(JSON.stringify({jobId:'J',photos:[{...repeatPhoto,emptyRepeats:[],supersedes:['rec-old'],imeis:['351973130000001'],missingImei:0,products:1,saved:1,needsRescan:false}]})).photos[0];
assert.deepEqual(later.supersedes,['rec-old'],'a rescan that read an IMEI names the earlier empty record it leaves in place');

// per-photo wording
assert.deepEqual(r.photoStatus(data.photos[0]),{label:'2 products · 2 IMEIs read · 1 duplicate not saved again',tone:'ok'});
assert.equal(r.photoStatus(data.photos[1]).tone,'bad');assert.match(r.photoStatus(data.photos[1]).label,/Could not be read: IllegalArgumentException/);
assert.equal(r.photoStatus(data.photos[2]).tone,'warn');assert.match(r.photoStatus(data.photos[2]).label,/1 without an IMEI · 1 to review/);
assert.equal(r.photoStatus(data.photos[3]).tone,'info');assert.match(r.photoStatus(data.photos[3]).label,/Same picture/);

// current scan first; older photos only when they still need a new scan
const grouped=r.orderPhotos(data);
assert.deepEqual(grouped.current.map(p=>p.name),['a.jpg','b.jpg','c.jpg','d.jpg']);
assert.deepEqual(grouped.older.map(p=>p.name),['e.jpg'],'a finished older photo is not listed again');
console.log('PASS: scan report (reading the app\'s numbers, honest wording, accounting rules: photos = scanned + failed + repeated, products = saved + duplicates, read + without IMEI = products; garbage input; current vs older photos).');
