import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import ts from 'typescript';
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022};
const layout=new URL('../verification-layout.mjs',import.meta.url),devices=new URL('../verification-device-labels.mjs',import.meta.url);
await writeFile(layout,ts.transpileModule(await readFile('src/scan-layout.ts','utf8'),{compilerOptions:options}).outputText);
await writeFile(devices,ts.transpileModule((await readFile('src/device-labels.ts','utf8')).replace('./scan-layout.ts','./verification-layout.mjs'),{compilerOptions:options}).outputText);
try{
 const {deviceAnchors,planDeviceCrops}=await import(devices.href+'?t='+Date.now());
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
 console.log('PASS: IMEI/serial device grouping, duplicate OCR suppression, serial tear-off grouping, boundary-based IMEI 2/serial/mixed crops, and neighbour exclusion. These are generated fixtures, not physical camera tests.');
}finally{await Promise.all([unlink(layout),unlink(devices)]);}
