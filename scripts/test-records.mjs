import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import ts from 'typescript';
import ExcelJS from 'exceljs';

// Exercise the app's actual helpers without mounting React or changing its source.
const names = ['luhnValid', 'extractImei1s', 'extractPreferredImei', 'cameraImei', 'recordSerial', 'markDuplicateRecords', 'recordPhoto', 'photoFilename', 'safeFileName', 'htmlEscape', 'personTitle', 'reviewStatus', 'csvCell', 'recordsCsv', 'makeStableGalleryHtml', 'createPhotoGalleryHtml', 'createInventoryWorkbook'];
const source = await readFile('src/App.tsx', 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let helpers = 'const digits = s => s.replace(/\\D/g, "");\n';
for (const name of names) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing app function ${name}`);
  helpers += node.getText(ast) + '\n';
}
const layout = ts.createSourceFile('scan-layout.ts', await readFile('src/scan-layout.ts','utf8'), ts.ScriptTarget.Latest, true);
helpers += layout.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'exportModel').getText(layout);
helpers += await readFile('src/serial.ts','utf8');
const catalogAst=ts.createSourceFile('SamsungCatalog.tsx',await readFile('src/SamsungCatalog.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
helpers += catalogAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='catalogModel').getText(catalogAst);
helpers += `\nexport { ${names.join(',')} };`;
const runtime = new URL('../verification-records-runtime.mjs', import.meta.url);
await writeFile(runtime, ts.transpileModule(helpers, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
try {
  const f = await import(runtime.href + '?test=' + Date.now());
  globalThis.localStorage={getItem:key=>key==='samsung-catalog'?JSON.stringify({products:[{modelCode:'SM-L320NZKAXAA',name:'Galaxy Watch9',id:'one'},{modelCode:'SM-L320NZWAXAA',name:'Galaxy Watch9',id:'two'}]}):'{}'};
  assert.equal(f.catalogModel('Model: SM-L320'),'Galaxy Watch9');
  assert.equal(f.catalogModel('IMEI: 490154203237518'),undefined);
  delete globalThis.localStorage;
  const first = '490154203237518', second = '356938035643809';
  assert.ok(f.luhnValid(first)); assert.ok(f.luhnValid(second));
  assert.equal(f.cameraImei(`IMEI 1: ${first}\nIMEI 2: ${second}`),first);
  assert.equal(f.cameraImei(`IMEI 2: ${second}`),'');
  assert.equal(f.cameraImei('IMEI 1: 490154203237519'),'');
  assert.equal(f.extractPreferredImei(`IMEI 1: unreadable\nIMEI 2: ${second}`),second);
  assert.equal(f.cameraImei(`IMEI 1: ${first}\nIMEI 1: ${second}`),'');
  assert.equal(f.recordSerial({raw:'S/N: 00012345AB'}),'00012345AB');
  assert.equal(f.recordSerial({raw:'S / N:\nR8YL6ABC012'}),'R8YL6ABC012');
  assert.equal(f.recordSerial({raw:'S/N: R8YL6ABC012\nS/N: R8YL6ABC012'}),'R8YL6ABC012');
  assert.equal(f.recordSerial({raw:'S/N: R8YL6ABC012\nS/N: OTHER12345'}),'');
  assert.equal(f.recordSerial({raw:'S/N:\nMODEL: SM-A075F'}),'');
  assert.equal(f.recordSerial({raw:'S/N: OLD12345',serial:'000012'}),'000012');
  const row = {id:'one',pictureId:'PIC-ONE',number:3,personId:'p',name:'photo.jpg',dataUrl:'data:image/jpeg;base64,ORIGINAL',cropDataUrl:'data:image/jpeg;base64,CROP',model:'Unknown unit',imei:first,status:'Valid',duplicate:false,createdAt:'2026-11-09',uploadBatchId:'latest',raw:''};
  const blank = {...row,id:'two',pictureId:'PIC-TWO',number:4,imei:'',status:'Review',cropDataUrl:'data:image/jpeg;base64,CROP2'};
  const serialOnly = {...blank,serial:'RFGYC2L1PLK'};
  assert.equal(f.reviewStatus(serialOnly),'Serial only');
  assert.equal(f.reviewStatus({...serialOnly,serialNeedsReview:true}),'Needs review');
  assert.ok(f.recordsCsv([serialOnly],new Map(),peopleForTest(),false,'simple').includes('RFGYC2L1PLK'));
  function peopleForTest(){return [{id:'p',label:'Person 1',name:''}];}
  assert.equal(f.recordPhoto(row),row.cropDataUrl);
  assert.equal(f.markDuplicateRecords([row])[0],row, 'Unchanged records retain identity for storage performance');
  assert.ok(f.markDuplicateRecords([row,{...row,id:'duplicate'}]).every(r=>r.duplicate));
  const people=[{id:'p',label:'Person 1',name:'Test'}];
  const html=f.createPhotoGalleryHtml([row,blank],people);
  assert.equal((html.match(/<article /g)||[]).length,2);
  assert.ok(html.includes(row.cropDataUrl) && html.includes(blank.cropDataUrl));
  assert.ok(!html.includes('base64,ORIGINAL'));
  assert.match(html,/data-imei=""[^>]*disabled/);
  const csv=f.recordsCsv([row,blank],new Map(),people,false,'simple');
  assert.equal(csv.split('\r\n').length,3);
  assert.ok(!csv.includes('Unknown unit') && !csv.includes('IMEI type'));
  const blob=await f.createInventoryWorkbook([row,serialOnly],new Map(),false,people,'',false,'simple');
  const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet=workbook.getWorksheet('All IMEIs');
  assert.equal(sheet.getCell('A2').value,first); assert.equal(sheet.getCell('A3').value,'');
  assert.equal(sheet.getCell('B3').value,'RFGYC2L1PLK'); assert.equal(sheet.getCell('C2').value,''); assert.equal(sheet.rowCount,3);
  console.log('PASS: camera IMEI 1 selection, upload fallback, unreadable/ambiguous review, serial leading zeros, duplicate flags, unchanged record identity, crop selection, offline HTML entries/copy guard, CSV, Excel round-trip.');
} finally { await unlink(runtime); }
