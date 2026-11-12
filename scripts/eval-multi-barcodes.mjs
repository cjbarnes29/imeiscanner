// Measures what the barcode reader finds in the multi-product photos in test-photos (not part of npm test).
import sharp from 'sharp';
import {readFile,readdir} from 'node:fs/promises';
import {readBarcodes,prepareZXingModule} from 'zxing-wasm/reader';
const wasm=await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
await prepareZXingModule({overrides:{wasmBinary:wasm},fireImmediately:true});
const luhn=s=>{let t=0;for(let i=0;i<15;i++){let d=+s[14-i];if(i%2){d*=2;if(d>9)d-=9;}t+=d;}return t%10===0;};
const files=(await readdir('test-photos')).filter(f=>/^multi-\d+\.jpg$/.test(f)).sort();
for(const f of files){
  const sizes=[0,1600,2600];const found=new Map();
  for(const longest of sizes){
    let img=sharp('test-photos/'+f).rotate();const meta=await img.metadata();
    if(longest&&Math.max(meta.width,meta.height)>longest)img=img.resize({width:meta.width>=meta.height?longest:undefined,height:meta.height>meta.width?longest:undefined});
    const {data,info}=await img.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const res=await readBarcodes({data:new Uint8ClampedArray(data),width:info.width,height:info.height},{formats:['Code128','EAN13'],maxNumberOfSymbols:40,tryHarder:true,tryRotate:true});
    for(const r of res)if(r.isValid&&!found.has(r.text))found.set(r.text,r.orientation);
  }
  const imeis=[...found.keys()].filter(t=>/^\d{15}$/.test(t));
  const ok=imeis.filter(luhn);
  const oris=[...new Set([...found.values()].map(o=>Math.round(o/45)*45))];
  console.log(f.padEnd(13),`codes=${found.size}`.padEnd(9),`imei15=${imeis.length}`.padEnd(9),`luhnOK=${ok.length}`.padEnd(10),'orient',JSON.stringify(oris));
}
