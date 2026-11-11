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
for(const name of ['serial','scan-layout','product-bands','device-labels']){
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
