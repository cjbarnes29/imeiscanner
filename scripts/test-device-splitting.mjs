import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022};
// Transpile every module the grouping code needs into a temp dir, rewriting
// relative imports, so new imports never silently break this test again.
const dir=await mkdtemp(join(tmpdir(),'imei-split-'));
for(const name of ['serial','scan-layout','product-bands','device-labels','barcode-imei']){
 const source=(await readFile(`src/${name}.ts`,'utf8')).replace(/from '\.\/([\w-]+)(?:\.ts)?'/g,"from './$1.mjs'");
 await writeFile(join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:options}).outputText);
}
const devices=pathToFileURL(join(dir,'device-labels.mjs'));
try{
 const {deviceAnchors,planDeviceCrops}=await import(devices.href);
 const line=(text,x,y)=>({text,bbox:{x0:x,y0:y,x1:x+240,y1:y+22}});
 const one=[line('IMEI 1: 490154203237518',200,180),line('IMEI 2: 356938035643809',200,210),line('S/N: RFGYC2L1PLK',200,240)];
 assert.equal(deviceAnchors(one,800,800).length,1,'One device with three identifiers stays one device');
 assert.equal(deviceAnchors([...one,one[0]],800,800).length,1,'Duplicate OCR boxes are ignored');
 assert.equal(deviceAnchors([line('S/N: RFGYC2L1PLK',200,100),line('S/N: RFGYC2L1PLK',200,300)],800,800).length,1,'Repeated serial tear-off strips stay together');
 for(const texts of [['S/N: FIRST0001','S/N: SECOND002'],['IMEI 2: 490154203237518','IMEI 2: 356938035643809'],['IMEI 1: 490154203237518','S/N: SECOND002']]){
  const lines=[line(texts[0],200,180),line(texts[1],200,580)];
  let anchors=deviceAnchors(lines,800,800);assert.equal(anchors.length,2);
  const data=new Uint8ClampedArray(800*800*4);
  for(let y=0;y<800;y++)for(let x=0;x<800;x++){const p=(y*800+x)*4;const pale=x>=100&&x<700&&((y>=50&&y<330)||(y>=450&&y<730));data[p]=data[p+1]=data[p+2]=pale?240:25;data[p+3]=255;}
  anchors=deviceAnchors(lines,800,800,{data,width:800,height:800});assert.equal(anchors.length,2);
  const regions=planDeviceCrops(anchors,lines,800,800,{data,width:800,height:800});
  assert.equal(regions.length,2,'Detected sticker edges produce two crops');
  for(let i=0;i<2;i++){const r=regions[i],own=anchors.find(a=>a.key===r.imei),other=anchors.find(a=>a.key!==r.imei);assert.ok(r.y<=own.box.y0&&r.y+r.height>=own.box.y1);assert.ok(other.box.y0>=r.y+r.height||other.box.y1<=r.y,'Never include the other identifier');}
  assert.equal(planDeviceCrops(anchors,lines,800,800).length,0,'Missing boundary evidence stays for review');
 }
 const pale=new Uint8ClampedArray(800*800*4).fill(240);
 assert.equal(deviceAnchors([line('IMEI 1: 490154203237518',100,100),line('IMEI 2: 356938035643809',450,600)],800,800,{data:pale,width:800,height:800}).length,1,'Distant identifiers on one connected sticker stay together');
 assert.equal(deviceAnchors([line('IMEI 1:',100,100),line('IMEI 1:',100,600)],800,800).length,2,'Unreadable numbers do not hide distinct label anchors');

 const A='490154203237518',B='356938035643809',C='353879234252633',D='358240051111110';
 const wide=(text,y)=>line(text,100,y);wide;
 assert.equal(deviceAnchors([line('IMEI 1: '+A+' IMEI 2: '+B,100,100),line('IMEI 1: '+C+' IMEI 2: '+D,100,500)].map(l=>({...l,bbox:{...l.bbox,x1:l.bbox.x0+500}})),800,800).length,2,'Two devices with IMEI 1 and IMEI 2 on the same OCR line');
 assert.equal(deviceAnchors([{...line('IMEI 1: '+A+' IMEI 2: '+B+' S/N: RFGYC2L1PLK',100,100),bbox:{x0:100,y0:100,x1:700,y1:122}}],800,800).length,1,'One device with three labels on one OCR line');
 assert.equal(deviceAnchors([line('Serial No: RFGYC2L1PLK',200,100),line('Serial No: R58M20ABCDE',200,500)],800,800).length,2,'Serial No labels');
 assert.equal(deviceAnchors([line('SN: RFGYC2L1PLK',200,100),line('SN: R58M20ABCDE',200,500)],800,800).length,2,'SN labels');
 assert.equal(deviceAnchors([line('IMEI: '+A,200,100),line('IMEI: '+C,200,500)],800,800).length,2,'Un-indexed IMEI labels');
 // Scale-aware grouping: on a close-up, a barcode-sized gap between IMEI 1 and IMEI 2 is one device.
 const big=(text,y)=>({text,bbox:{x0:200,y0:y,x1:700,y1:y+60}});
 assert.equal(deviceAnchors([big('IMEI 1: '+A,100),big('IMEI 2: '+B,420)],1000,1000).length,1,'Close-up IMEI 1/IMEI 2 with barcode gap stays one device');
 assert.equal(deviceAnchors([big('IMEI 1: '+A,100),big('IMEI 1: '+C,700)],1000,1000).length,2,'Close-up distinct devices still split');
 // Camera: barcodes under IMEI labels become positioned anchors.
 const {labelledBarcodeLines,resolveImeisFromBarcodes,resolveSerialFromBarcodes,imeiReadingsDisagree,barcodeImei}=await import(pathToFileURL(join(dir,'barcode-imei.mjs')).href);
 // Serial from the S/N barcode, confirmed by misread OCR (real case: OCR read RE3L810D0).
 assert.equal(resolveSerialFromBarcodes(['351124072221537','R83L810D0MW','8806099448974'],'S/N - RE3L810D0!'),'S/N (barcode): R83L810D0MW','Serial barcode fixes 8/B and cut-off OCR');
 assert.equal(resolveSerialFromBarcodes(['R83L810D0MW'],'nothing like it'),'','Serial barcode needs OCR evidence');
 assert.equal(resolveSerialFromBarcodes(['351124072221537'],'S/N: 3511240'),'','Digit-only barcodes are not serials');
 const {extractSerial:serialOf}=await import(pathToFileURL(join(dir,'serial.mjs')).href);
 assert.equal(serialOf('S/N (barcode): R83L810D0MW\nS/N - RE3L810D0'),'R83L810D0MW','Barcode serial outranks OCR serial');
 // Misread guard (real case: OCR gave Luhn-valid 351980071560831 for 351980971560931).
 assert.equal(imeiReadingsDisagree('IMEI 1 : 351980071560831\n361980071560931 IMEI 2 356302431560999','351980071560831'),true,'Two OCR readings 2 digits apart need review');
 assert.equal(imeiReadingsDisagree('IMEI 1: 351973130210365\nIMEI 2: 351973130219432\nIMEI 1: 351973130210365','351973130210365'),false,'IMEI 2 of the same device is not a misread');
 assert.equal(imeiReadingsDisagree('IMEI 1 (barcode): 351980971560931\n351980071560831','351980971560931'),false,'Barcode-confirmed numbers are never flagged');
 assert.equal(barcodeImei('IMEI 1 (barcode): 351124072221537\nIMEI 1: 351124072221538',1),'351124072221537');
 // Real OCR from a 4-box camera photo: digits misread, barcodes exact.
 assert.equal(resolveImeisFromBarcodes(['351124072221537','351570782221532'],'IMEI 1 : 35112407222I537  IMEI 2 : 3515707822215'),'IMEI 1 (barcode): 351124072221537\nIMEI 2 (barcode): 351570782221532','Label picks the barcode sharing its digits');
 assert.equal(resolveImeisFromBarcodes(['351124072221537'],'IMEI: 351124072221537 IMEI 2 : 351570782221532'),'IMEI 1 (barcode): 351124072221537','OCR dropped the 1 in IMEI 1');
 assert.equal(resolveImeisFromBarcodes(['357126893713943'],'Gas IMENR:3! 712689: 2:35793'),'IMEI: 357126893713943','Single barcode with partial digits is un-indexed');
 assert.equal(resolveImeisFromBarcodes(['357126893713943'],'no digits here'),'','No OCR evidence, no number');
 assert.equal(resolveImeisFromBarcodes(['8806099448912'],'IMEI 1 : 8806099448912'),'','EAN product barcodes are not IMEIs');
 const labelA=line('IMEI 1',200,160),labelC=line('IMEI 1',200,560);
 const codes=[{rawValue:A,boundingBox:{x:200,y:100,width:240,height:50}},{rawValue:C,boundingBox:{x:200,y:500,width:240,height:50}}];
 const barcodeLines=labelledBarcodeLines(codes,[labelA,labelC]);
 assert.equal(barcodeLines.length,2,'Each IMEI label pairs with the barcode above it');
 assert.equal(deviceAnchors([labelA,labelC,...barcodeLines],800,800).length,2,'Camera: two devices found from barcodes when OCR misses digits');
 assert.equal(deviceAnchors([line('IMEI 1: '+A,200,160),...labelledBarcodeLines([codes[0]],[line('IMEI 1: '+A,200,160)])],800,800).length,1,'Same IMEI from OCR and barcode is one device');
 assert.equal(labelledBarcodeLines([{rawValue:'490154203237519',boundingBox:codes[0].boundingBox}],[labelA]).length,0,'Invalid barcode ignored');
 // Serial extraction
 const {extractSerial,serialReading,unindexedImeis}=await import(pathToFileURL(join(dir,'serial.mjs')).href);
 for(const label of ['S/N: ','S/N ','SN: ','Serial No: ','Serial No. ','Serial Number: ','SERIAL: '])assert.equal(extractSerial(label+'RFGYC2L1PLK'),'RFGYC2L1PLK',label);
 assert.equal(extractSerial('S/N: RFGYC2L1PLK\nS/N: R58M20ABCDE'),'','Conflicting serials stay blank for review');
 assert.equal(extractSerial('SNOW1234567 on the box'),'','SN prefix of a word is not a label');
 assert.equal(extractSerial('Serial number: MODELNAME'),'','Words without digits are not serials');
 assert.deepEqual(unindexedImeis('IMEI: '+A),[A]);assert.deepEqual(unindexedImeis('IMEI 1: '+A),[]);
 assert.equal(serialReading('SN: RFGYC2L1PLK').serial,'RFGYC2L1PLK');
 console.log('PASS: IMEI/serial device grouping, duplicate OCR suppression, serial tear-off grouping, boundary-based IMEI 2/serial/mixed crops, and neighbour exclusion. Generated fixtures, not physical camera tests.');
}finally{await rm(dir,{recursive:true,force:true});}
