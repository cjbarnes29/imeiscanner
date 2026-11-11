import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import ts from 'typescript';
import ExcelJS from 'exceljs';

// Exercise the app's actual helpers without mounting React or changing its source.
const names = ['hasMultipleDeviceText','luhnValid', 'extractImei1s', 'extractPreferredImei', 'cameraImei', 'recordSerial', 'markDuplicateRecords', 'recordPhoto', 'photoFilename', 'safeFileName', 'htmlEscape', 'personTitle', 'reviewStatus', 'csvCell', 'recordsCsv', 'makeStableGalleryHtml', 'createPhotoGalleryHtml', 'createInventoryWorkbook', 'createImeiPhotoFiles', 'dataUrlBlob', 'recordImeiPair', 'pictureWebLink'];
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
helpers += await readFile('src/share-package.ts','utf8');
helpers += await readFile('src/barcode-imei.ts','utf8');
// Browser-only image decoding is stubbed; the package logic under test is unchanged.
helpers += '\nasync function workbookImage(r){return {dataUrl:recordPhoto(r),width:120,height:90};}\nconst androidBridge=undefined;\n';
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
  const positioned=[{rawValue:first,boundingBox:{x:20,y:100,width:220,height:50}},{rawValue:second,boundingBox:{x:20,y:400,width:220,height:50}}];
  const barcodeLines=[{text:'IMEI 1:',bbox:{x0:20,y0:160,x1:220,y1:182}},{text:'IMEI 2:',bbox:{x0:20,y0:460,x1:220,y1:482}}];
  const barcodeText=f.labelledBarcodeImeis(positioned,barcodeLines);
  assert.equal(f.cameraImei(barcodeText),first);
  assert.equal(f.cameraImei(f.labelledBarcodeImeis([positioned[1]],[barcodeLines[1]])),second);
  assert.equal(f.labelledBarcodeImeis(positioned,[{...barcodeLines[0],text:'IMEI 1 IMEI 2'}]),'');
  assert.equal(f.labelledBarcodeImeis([{rawValue:first}],barcodeLines),'');
  assert.equal(f.hasMultipleDeviceText(`IMEI 1: ${first}\nIMEI 2: ${second}\nS/N: R8YL6`),false);
  assert.equal(f.hasMultipleDeviceText('S/N: FIRST0001\nS/N: SECOND002'),true);
  assert.equal(f.hasMultipleDeviceText('S/N: RFGYC2L1PLK'),false);
  assert.ok(f.luhnValid(first)); assert.ok(f.luhnValid(second));
  assert.equal(f.cameraImei(`IMEI 1: ${first}\nIMEI 2: ${second}`),first);
  assert.equal(f.cameraImei(`IMEI 2: ${second}`),second);
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
  const share=f.buildSharePackage([{number:3,pictureId:'PIC-ONE',model:'Watch',imei:'490154203237518',serial:'',photo:'data:image/jpeg;base64,Q1JPUE9ORQ=='},{number:4,pictureId:'PIC-TWO',model:'',imei:'',serial:'000ABC123',photo:'data:image/png;base64,Q1JPUDJUV08='}]);
  assert.equal(share.entries.length,2);
  assert.equal(await share.entries[0].file.text(),'CROPONE');
  assert.equal(await share.entries[1].file.text(),'CROP2TWO');
  assert.equal(share.entries[0].text,'490154203237518');
  assert.equal(share.entries[1].text,'000ABC123','IMEI mode falls back to serial when there is no IMEI');
  assert.equal(f.shareNumberText({imei:'490154203237518',serial:'RFGYC2L1PLK'},'imei'),'490154203237518','IMEI mode sends only the IMEI');
  assert.equal(f.shareNumberText({imei:'490154203237518',serial:'RFGYC2L1PLK'},'imei_serial'),'490154203237518\nRFGYC2L1PLK');
  assert.equal(Object.keys(share.entries[0]).sort().join(),'file,text','Picture and text are separate share payloads');
  const withSerial=f.buildSharePackage([{number:4,pictureId:'PIC-TWO',model:'',imei:'',serial:'000ABC123',photo:'data:image/png;base64,Q1JPUDJUV08='}],'imei_serial');
  assert.equal(withSerial.entries[0].text,'000ABC123');
  assert.throws(()=>f.buildSharePackage([]),/Select at least one/);
  assert.throws(()=>f.buildSharePackage(Array(51).fill({})),/up to 50 records/);
  assert.throws(()=>f.buildSharePackage([{photo:'blob:temporary',pictureId:'bad'}]),/unavailable/);
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
  assert.deepEqual([1,2,3].map(c=>sheet.getRow(1).getCell(c).value),['IMEI 1','IMEI 2','Serial']);
  assert.equal(sheet.getCell('A2').value,first); assert.equal(sheet.getCell('A3').value,'');
  assert.equal(sheet.getCell('C3').value,'RFGYC2L1PLK'); assert.equal(sheet.getCell('C2').value,''); assert.equal(sheet.rowCount,3);
  {
    const pair={...row,serial:'R58M20ABCDE',raw:`IMEI 1: ${first}\nIMEI 2: ${second}`};
    const minimalCsv=f.recordsCsv([pair,serialOnly],new Map(),people,false,'imei_photo').replace('\uFEFF','').split('\r\n');
    assert.deepEqual(minimalCsv,['"IMEI 1","IMEI 2","Serial"',`"${first}","${second}","R58M20ABCDE"`,'"","","RFGYC2L1PLK"'],'CSV: IMEI 1, IMEI 2, Serial only');
    const minimalBook=new ExcelJS.Workbook();await minimalBook.xlsx.load(await (await f.createInventoryWorkbook([pair],new Map(),false,people,'',false,'imei_photo')).arrayBuffer());
    assert.equal(minimalBook.worksheets.length,1,'Sheets export: one tab');
    assert.deepEqual([1,2,3,4].map(c=>minimalBook.worksheets[0].getRow(2).getCell(c).value??null),[first,second,'R58M20ABCDE',null]);
  }
  assert.equal(f.extractPreferredImei('IMEI: 490154203237518'),'490154203237518','Un-indexed IMEI label');
  assert.equal(f.extractPreferredImei('IMEI: 490154203237519'),'','Un-indexed IMEI must pass Luhn');
  assert.equal(f.extractPreferredImei('IMEI 1: 490154203237518\nIMEI: 356938035643809'),'490154203237518','Indexed IMEI wins over un-indexed');
  assert.equal(f.recordSerial({raw:'SN: RFGYC2L1PLK'}),'RFGYC2L1PLK');
  {
    assert.deepEqual(f.recordImeiPair({imei:second,raw:`IMEI 2: ${second}`}),{imei1:'',imei2:second},'Stored IMEI 2 is not shown as IMEI 1');
    assert.deepEqual(f.recordImeiPair({imei:first,raw:`IMEI 2: 356938035643808`}),{imei1:first,imei2:''},'Invalid IMEI 2 is left blank');
    const files=await f.createImeiPhotoFiles([{...row,serial:'R58M20ABCDE',raw:`IMEI 1: ${first}\nIMEI 2: ${second}`,cropDataUrl:'data:image/jpeg;base64,Q1JPUE9ORQ=='},{...serialOnly,cropDataUrl:'data:image/jpeg;base64,Q1JPUDJUV08='}]);
    assert.equal(files[0].name,'imei-pictures.xlsx');assert.equal(files.length,3,'Workbook plus one picture per row, no ZIP');
    assert.ok(files.every(file=>!file.name.includes('/')),'All files sit in one folder');
    assert.deepEqual(files.slice(1).map(file=>file.name),['1.jpg','2.jpg'],'Pictures are named by number only');
    assert.equal(f.photoFilename({number:7,imei:first,name:'x.jpg',cropDataUrl:'data:image/jpeg;base64,AA=='}),'7.jpg','Single downloads are named by record number only');
    const named=name=>files.find(file=>file.name===name);
    const book=new ExcelJS.Workbook();await book.xlsx.load(await files[0].blob.arrayBuffer());
    assert.equal(book.worksheets.length,1,'One sheet only');
    const ws=book.getWorksheet('IMEIs');
    assert.deepEqual([1,2,3,4,5,6].map(c=>ws.getRow(1).getCell(c).value),['IMEI 1','IMEI 2','Serial','Picture','Download',null],'IMEI 1, IMEI 2, serial, picture and download only');
    assert.deepEqual(['A2','B2','C2'].map(c=>ws.getCell(c).value),[first,second,'R58M20ABCDE'],'Both IMEIs and the serial');
    assert.deepEqual(['A3','B3','C3'].map(c=>ws.getCell(c).value??''),['','','RFGYC2L1PLK'],'Serial-only unit: blank IMEIs, serial filled');
    // Off a website (Android app / local file) the link is the picture file beside the workbook.
    const link=ws.getCell('E2').value;assert.equal(link.text,'Download picture');assert.ok(!link.hyperlink.includes('#'),'No # in file links');
    assert.equal(await named(link.hyperlink).blob.text(),'CROPONE','Link points at that row\'s picture file next to the workbook');
    assert.ok(named(ws.getCell('E3').value.hyperlink),'Serial-only row has its picture too');
    // On the website, Excel phone apps need a web link: it opens the app at that picture.
    globalThis.location=new URL('https://cjbarnes29.github.io/imeiscanner/');
    const webFiles=await f.createImeiPhotoFiles([{...row,cropDataUrl:'data:image/jpeg;base64,Q1JPUE9ORQ=='}]);
    const webBook=new ExcelJS.Workbook();await webBook.xlsx.load(await webFiles[0].blob.arrayBuffer());
    assert.equal(webBook.getWorksheet('IMEIs').getCell('E2').value.hyperlink,'https://cjbarnes29.github.io/imeiscanner/#picture=PIC-ONE','Web link to the picture viewer');
    delete globalThis.location;
    assert.equal(ws.getImages().length,2,'Each row shows its picture');
  }
  console.log('PASS: camera/upload IMEI 1 then IMEI 2 priority, positioned barcode matching, unreadable/ambiguous review, serial leading zeros, duplicate flags, unchanged record identity, crop selection, offline HTML entries/copy guard, CSV, Excel round-trip, shared photo/number pairing and batch limits.');
} finally { await unlink(runtime); }
