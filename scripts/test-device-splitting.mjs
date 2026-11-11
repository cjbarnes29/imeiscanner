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
for(const name of ['serial','scan-layout','product-bands','device-labels','barcode-imei','phone-names']){
 const source=(await readFile(`src/${name}.ts`,'utf8')).replace(/from '\.\/([\w-]+)(?:\.ts)?'/g,"from './$1.mjs'");
 await writeFile(join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:options}).outputText);
}
const devices=pathToFileURL(join(dir,'device-labels.mjs'));
try{
 const {deviceAnchors,planDeviceCrops}=await import(devices.href);
 const line=(text,x,y)=>({text,bbox:{x0:x,y0:y,x1:x+240,y1:y+22}});
 const one=[line('IMEI 1: 490154203237518',200,180),line('IMEI 2: 356938035643809',200,210),line('S/N: RTEST2L1PLK',200,240)];
 assert.equal(deviceAnchors(one,800,800).length,1,'One device with three identifiers stays one device');
 assert.equal(deviceAnchors([...one,one[0]],800,800).length,1,'Duplicate OCR boxes are ignored');
 assert.equal(deviceAnchors([line('S/N: RTEST2L1PLK',200,100),line('S/N: RTEST2L1PLK',200,300)],800,800).length,1,'Repeated serial tear-off strips stay together');
 for(const texts of [['S/N: FIRST0001','S/N: SECOND002'],['IMEI 2: 490154203237518','IMEI 2: 356938035643809'],['IMEI 1: 490154203237518','S/N: SECOND002']]){
  const lines=[line(texts[0],200,180),line(texts[1],200,580)];
  let anchors=deviceAnchors(lines,800,800);assert.equal(anchors.length,2);
  const data=new Uint8ClampedArray(800*800*4);
  for(let y=0;y<800;y++)for(let x=0;x<800;x++){const p=(y*800+x)*4;const pale=x>=100&&x<700&&((y>=50&&y<330)||(y>=450&&y<730));data[p]=data[p+1]=data[p+2]=pale?240:25;data[p+3]=255;}
  anchors=deviceAnchors(lines,800,800,{data,width:800,height:800});assert.equal(anchors.length,2);
  const regions=planDeviceCrops(anchors,lines,800,800,{data,width:800,height:800});
  assert.equal(regions.length,2,'Detected sticker edges produce two crops');
  for(let i=0;i<2;i++){const r=regions[i],own=anchors.find(a=>a.key===r.imei),other=anchors.find(a=>a.key!==r.imei);assert.ok(r.y<=own.box.y0&&r.y+r.height>=own.box.y1);assert.ok(other.box.y0>=r.y+r.height||other.box.y1<=r.y,'Never include the other identifier');}
  // No visible sticker edge (e.g. stacked white boxes): cut between the label groups.
  const byLabels=planDeviceCrops(deviceAnchors(lines,800,800),lines,800,800);
  assert.equal(byLabels.length,2,'Two label groups split even without a visible edge');
  for(const r of byLabels){const inside=lines.filter(l=>l.bbox.y0>=r.y&&l.bbox.y1<=r.y+r.height);assert.equal(inside.length,1,'Each label-group crop holds exactly its own label');}
 }
 const pale=new Uint8ClampedArray(800*800*4).fill(240);
 assert.equal(deviceAnchors([line('IMEI 1: 490154203237518',100,100),line('IMEI 2: 356938035643809',450,600)],800,800,{data:pale,width:800,height:800}).length,1,'Distant identifiers on one connected sticker stay together');
 assert.equal(deviceAnchors([line('IMEI 1:',100,100),line('IMEI 1:',100,600)],800,800).length,2,'Unreadable numbers do not hide distinct label anchors');

 const A='490154203237518',B='356938035643809',C='353879234252633',D='358240051111110';
 const wide=(text,y)=>line(text,100,y);wide;
 assert.equal(deviceAnchors([line('IMEI 1: '+A+' IMEI 2: '+B,100,100),line('IMEI 1: '+C+' IMEI 2: '+D,100,500)].map(l=>({...l,bbox:{...l.bbox,x1:l.bbox.x0+500}})),800,800).length,2,'Two devices with IMEI 1 and IMEI 2 on the same OCR line');
 assert.equal(deviceAnchors([{...line('IMEI 1: '+A+' IMEI 2: '+B+' S/N: RTEST2L1PLK',100,100),bbox:{x0:100,y0:100,x1:700,y1:122}}],800,800).length,1,'One device with three labels on one OCR line');
 assert.equal(deviceAnchors([line('Serial No: RTEST2L1PLK',200,100),line('Serial No: R58M20ABCDE',200,500)],800,800).length,2,'Serial No labels');
 assert.equal(deviceAnchors([line('SN: RTEST2L1PLK',200,100),line('SN: R58M20ABCDE',200,500)],800,800).length,2,'SN labels');
 assert.equal(deviceAnchors([line('IMEI: '+A,200,100),line('IMEI: '+C,200,500)],800,800).length,2,'Un-indexed IMEI labels');
 // Scale-aware grouping: on a close-up, a barcode-sized gap between IMEI 1 and IMEI 2 is one device.
 const big=(text,y)=>({text,bbox:{x0:200,y0:y,x1:700,y1:y+60}});
 assert.equal(deviceAnchors([big('IMEI 1: '+A,100),big('IMEI 2: '+B,420)],1000,1000).length,1,'Close-up IMEI 1/IMEI 2 with barcode gap stays one device');
 assert.equal(deviceAnchors([big('IMEI 1: '+A,100),big('IMEI 1: '+C,700)],1000,1000).length,2,'Close-up distinct devices still split');
 // Camera: barcodes under IMEI labels become positioned anchors.
 const {labelledBarcodeLines,resolveImeisFromBarcodes,resolveSerialFromBarcodes,imeiReadingsDisagree,barcodeImei}=await import(pathToFileURL(join(dir,'barcode-imei.mjs')).href);
 // Real camera photo: zxing reports a 37px-tall scan box for a wide 1-D barcode, and the
 // IMEI 2 label beside IMEI 1 also sits under it. The left-aligned IMEI 1 label owns it.
 {
   const wide=[{rawValue:'350000114573690',boundingBox:{x:231,y:701,width:521,height:37}}];
   const paired=labelledBarcodeLines(wide,[{text:'IMEI1:35000011',bbox:{x0:232.5,y0:757.3,x1:412.3,y1:784}},{text:'4573690 IMEI2:350000124573698',bbox:{x0:414.9,y0:742.9,x1:822.4,y1:777}}]);
   assert.deepEqual(paired.map(l=>l.text),['IMEI 1: 350000114573690'],'Left-aligned label owns a shared wide barcode');
   const flat=[{rawValue:'350000114573690',boundingBox:{x:231,y:701,width:521,height:1}}];
   assert.equal(labelledBarcodeLines(flat,[{text:'IMEI1:35000011',bbox:{x0:232.5,y0:757.3,x1:412.3,y1:784}}]).length,1,'1px scan-line box still pairs with the label below');
   assert.equal(deviceAnchors([{text:'IMEI1:357',bbox:{x0:854,y0:632,x1:960,y1:655}},{text:'IMEI1:35000011',bbox:{x0:232.5,y0:757.3,x1:412.3,y1:784}},...paired],960,1280,{data:new Uint8ClampedArray(960*1280*4).fill(240),width:960,height:1280}).length,1,'Unreadable tear-off IMEI 1 label on the same sticker joins the read one');
 }
 // Real 2-box A37 photo: stacked white boxes, no visible seam. Box 2's S/N line is physically
 // closer to box 1's tear-off strip than to its own IMEI line, and must still go to box 2.
 {
   const B=(text,x0,y0,x1)=>({text,bbox:{x0,y0,x1,y1:y0+32}});
   const real=[B('IMEI 1: 350000130856616',1290,954,1606),B('IMEI 1: 350000130856616',390,1230,719),B('IMEI 2 : 350000140856413',838,1240,1167),B('IMEI : 350000130856617',1288,1251,1609),B('IMEI 2',1721,1263,1794),B('S/N: RFGL00086HL',412,1672,719),B('IMEI 1: 350000130869494',1338,1656,1670),B('IMEI 2 : 3535749140569491',861,1964,1204),B('IMEI 1: 35000013086 9494',1336,1981,1672)];
   const pale={data:new Uint8ClampedArray(1800*2400*4).fill(240),width:1800,height:2400};
   const found=deviceAnchors(real,1800,2400,pale);
   assert.deepEqual(found.map(a=>a.value),['350000130856616','350000130869494'],'Two devices: misread IMEI copies and tear-off strips do not add devices');
   const crops=planDeviceCrops(found,real,1800,2400,pale);
   assert.equal(crops.length,2,'Stacked white boxes split between their label groups');
   const second=crops.find(c=>c.y>1000);
   assert.ok(second&&second.y<1656&&second.y>1290,'Cut lands between box 1 strip and box 2 labels, S/N stays with box 2');
   // Dark label: an unreadable "IMEI 2" label is never a third device.
   const dark=[B('IMEI: . 350000159060744',430,782,727),B('S/N: R3GL00BR3',477,1188,722),B('IMEI 2: pe',1670,1337,1949)];
   assert.equal(deviceAnchors(dark,2400,1800).length,2,'Unreadable IMEI 2 label joins a device');
 }
 // IMEI 2 from IMEI 1's serial block (Samsung prints the same digits 9-14 in both).
 {
   const {samsungImei2,pickImei2}=await import(pathToFileURL(join(dir,'barcode-imei.mjs')).href);
   assert.equal(samsungImei2('350000130869494','IMEI 2 : 350000140569491'),'350000140869492','Serial block misread is corrected');
   assert.equal(samsungImei2('350000130219435','IMEI 2 : 350000160219432'),'','A misread in the first 8 digits is never "fixed"');
   assert.equal(samsungImei2('350000130219435','IMEI 2 : 350000160219432\nIMEI 2 : 350000140219433'),'350000140219433','An exact reading wins');
   assert.equal(samsungImei2('350000159060744','IME| 2: 35000 0179060740'),'350000179060740','OCR label variants and spaced digits');
   assert.equal(pickImei2('350000130856616','Model : SM-A376B/DS\nIMEI 2: 350000181926755'),'','Samsung IMEI 2 with a different serial block is dropped');
   assert.equal(pickImei2('490154203237518','IMEI 2: 356938035643809'),'356938035643809','Non-Samsung labels keep a single valid IMEI 2');
 }
 // Orientation check: upright label text scores, upside-down or unreadable text does not.
 {
   const {labelTextScore,ORIENTATIONS}=await import(pathToFileURL(join(dir,'barcode-imei.mjs')).href);
   assert.ok(labelTextScore('Model : SM-A376B/DS\nS/N : R58M20ABCDE\nIMEI 1: 490154203237518\nIMEI 2: 356938035643809')>=6,'Upright label text scores high');
   assert.equal(labelTextScore('qwoqx 0 vnnm ; unrelated words 12345'),0,'Garbage scores zero');
   assert.equal(labelTextScore('9 SIA lWI ;N/S :1 lWI'),0,'Upside-down text scores zero');
   assert.equal(ORIENTATIONS.length,4,'Upside down, both sideways turns and mirrored');
 }
 // A stray unreadable label between two readable devices must not become a third blank crop.
 {
   const B=(text,y)=>({text,bbox:{x0:200,y0:y,x1:520,y1:y+30}});
   const stray=[B('IMEI 1: 490154203237518',200),B('IMEI: ape iB 35708 3',1000),B('IMEI 1: 356938035643809',1800)];
   const pale={data:new Uint8ClampedArray(1000*2200*4).fill(240),width:1000,height:2200};
   const found=deviceAnchors(stray,1000,2200,pale);
   assert.ok(found.length>=2,'Readable devices are found');
   assert.equal(planDeviceCrops(found,stray,1000,2200,pale).length,2,'Unreadable stray label adds no third crop');
 }
 // Phone names for the simple list: name + series instead of a model code.
 {
   const {phoneInfo}=await import(pathToFileURL(join(dir,'phone-names.mjs')).href);
   const catalog=[{name:'Galaxy Z Fold8 256GB (Unlocked)',modelCode:'SM-F971UZGAXAA'},{name:'Galaxy S26 Ultra 512GB (Unlocked)',modelCode:'SM-S948UZVEXAA'},{name:'Galaxy S26 FE 128 GB | 8 GB Pistachio',modelCode:'SM-S741BLGDEUB'}];
   const eq=(model,name,series)=>assert.deepEqual(phoneInfo(model,catalog),{name,series},model);
   eq('SM-S938B','Galaxy S25 Ultra','S25 series');
   eq('SM-S931B','Galaxy S25','S25 series');
   eq('SM-S936B','Galaxy S25+','S25 series');
   eq('SM-S948B/DS','Galaxy S26 Ultra','S26 series');
   eq('SM-S942B','Galaxy S26','S26 series');
   eq('SM-S741B','Galaxy S26 FE','S26 series');
   eq('SM-F971B','Galaxy Z Fold8','Fold series');
   eq('SM-F956B','Galaxy Z Fold6','Fold series');
   eq('SM-F766B','Galaxy Z Flip7','Flip series');
   eq('SM-A077F/DS','Galaxy A07','A07 series');
   eq('SM-A376B','Galaxy A37','A37 series');
   eq('SM-A165F','Galaxy A16','A16 series');
   eq('Samsung Galaxy S25 Ultra','Galaxy S25 Ultra','S25 series');
   eq('Apple iPhone 17 Pro','Apple iPhone 17 Pro','iPhone 17 series');
   eq('Unknown unit — review','Unknown phone','Unknown phones');
   eq('','Unknown phone','Unknown phones');
 }
 // Serial from the S/N barcode, confirmed by misread OCR (real case: OCR read RE3L555D0).
 assert.equal(resolveSerialFromBarcodes(['350000192221535','R83L555D0QQ','8806099448974'],'S/N - RE3L555D0!'),'S/N (barcode): R83L555D0QQ','Serial barcode fixes 8/B and cut-off OCR');
 assert.equal(resolveSerialFromBarcodes(['R83L555D0QQ'],'nothing like it'),'','Serial barcode needs OCR evidence');
 assert.equal(resolveSerialFromBarcodes(['350000192221535'],'S/N: 3500001'),'','Digit-only barcodes are not serials');
 const {extractSerial:serialOf}=await import(pathToFileURL(join(dir,'serial.mjs')).href);
 assert.equal(serialOf('S/N (barcode): R83L555D0QQ\nS/N - RE3L555D0'),'R83L555D0QQ','Barcode serial outranks OCR serial');
 // Misread guard (real case: OCR gave Luhn-valid 350000201560832 for 350000211560939).
 assert.equal(imeiReadingsDisagree('IMEI 1 : 350000201560832\n350000201560931 IMEI 2 350000991560999','350000201560832'),true,'Two OCR readings 2 digits apart need review');
 assert.equal(imeiReadingsDisagree('IMEI 1: 350000130210368\nIMEI 2: 350000130219435\nIMEI 1: 350000130210368','350000130210368'),false,'IMEI 2 of the same device is not a misread');
 assert.equal(imeiReadingsDisagree('IMEI 1 (barcode): 350000211560939\n350000201560832','350000211560939'),false,'Barcode-confirmed numbers are never flagged');
 assert.equal(barcodeImei('IMEI 1 (barcode): 350000192221535\nIMEI 1: 350000192221538',1),'350000192221535');
 // Real OCR from a 4-box camera photo: digits misread, barcodes exact.
 assert.equal(resolveImeisFromBarcodes(['350000192221535','350000182221537'],'IMEI 1 : 35000019222I537  IMEI 2 : 3500001822215'),'IMEI 1 (barcode): 350000192221535\nIMEI 2 (barcode): 350000182221537','Label picks the barcode sharing its digits');
 assert.equal(resolveImeisFromBarcodes(['350000192221535'],'IMEI: 350000192221535 IMEI 2 : 350000182221537'),'IMEI 1 (barcode): 350000192221535','OCR dropped the 1 in IMEI 1');
 assert.equal(resolveImeisFromBarcodes(['350000113713941'],'Gas IMENR:3! 000011: 2:35793'),'IMEI: 350000113713941','Single barcode with partial digits is un-indexed');
 assert.equal(resolveImeisFromBarcodes(['350000113713941'],'no digits here'),'','No OCR evidence, no number');
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
 for(const label of ['S/N: ','S/N ','SN: ','Serial No: ','Serial No. ','Serial Number: ','SERIAL: '])assert.equal(extractSerial(label+'RTEST2L1PLK'),'RTEST2L1PLK',label);
 assert.equal(extractSerial('S/N: RTEST2L1PLK\nS/N: R58M20ABCDE'),'','Conflicting serials stay blank for review');
 assert.equal(extractSerial('SNOW1234567 on the box'),'','SN prefix of a word is not a label');
 assert.equal(extractSerial('Serial number: MODELNAME'),'','Words without digits are not serials');
 assert.deepEqual(unindexedImeis('IMEI: '+A),[A]);assert.deepEqual(unindexedImeis('IMEI 1: '+A),[]);
 assert.equal(serialReading('SN: RTEST2L1PLK').serial,'RTEST2L1PLK');
 console.log('PASS: IMEI/serial device grouping, duplicate OCR suppression, serial tear-off grouping, boundary-based IMEI 2/serial/mixed crops, and neighbour exclusion. Generated fixtures, not physical camera tests.');
}finally{await rm(dir,{recursive:true,force:true});}
