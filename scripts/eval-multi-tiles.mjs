// Compares reading strategies on the multi-product photos: whole photo vs enlarged overlapping tiles.
import sharp from 'sharp';
import {readdir} from 'node:fs/promises';
import {createWorker,PSM} from 'tesseract.js';
const luhn=s=>{let t=0;for(let i=0;i<15;i++){let d=+s[14-i];if(i%2){d*=2;if(d>9)d-=9;}t+=d;}return t%10===0;};
const imeisIn=text=>{const out=new Set();for(const m of text.replace(/[Oo]/g,'0').matchAll(/(?<!\d)(?:\d[ -]?){14}\d(?!\d)/g)){const d=m[0].replace(/\D/g,'');if(d.length===15&&luhn(d))out.add(d);}return out;};
const only=process.argv[2];
const files=(await readdir('test-photos')).filter(f=>/^multi-\d+\.jpg$/.test(f)).sort().filter(f=>!only||only.split(',').some(o=>f.includes(o)));
const worker=await createWorker('eng',1,{langPath:'.',gzip:false,cacheMethod:'none'});
await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'300'});
const read=async(img,w,h,rect,scale,rot)=>{
  let p=img.clone().rotate().rotate(rot);
  const {data,info}=await p.toBuffer({resolveWithObject:true});
  let q=sharp(data).extract({left:Math.round(rect.x*info.width),top:Math.round(rect.y*info.height),width:Math.max(1,Math.round(rect.w*info.width)),height:Math.max(1,Math.round(rect.h*info.height))}).resize({width:Math.round(rect.w*info.width*scale)}).grayscale().normalise().sharpen().jpeg({quality:92});
  return imeisIn((await worker.recognize(await q.toBuffer())).data.text);
};
const plans={
  whole:[{x:0,y:0,w:1,h:1}],
  halves:[{x:0,y:0,w:1,h:.56},{x:0,y:.44,w:1,h:.56}],
  quads:[{x:0,y:0,w:.56,h:.56},{x:.44,y:0,w:.56,h:.56},{x:0,y:.44,w:.56,h:.56},{x:.44,y:.44,w:.56,h:.56}]
};
for(const f of files){
  const img=sharp('test-photos/'+f);
  const meta=await sharp('test-photos/'+f).rotate().metadata();
  const rot=process.argv[3]&&f.match(/0[14]/)?270:0;
  const line=[];
  for(const [name,rects] of Object.entries(plans)){
    const all=new Set();
    for(const r of rects){
      const longest=Math.max(meta.width,meta.height);
      const scale=name==='whole'?Math.min(1,1800/longest):2;
      for(const v of await read(img,meta.width,meta.height,r,scale,rot))all.add(v);
    }
    line.push(`${name}=${all.size}`);
  }
  console.log(f.padEnd(13),line.join('  '));
}
await worker.terminate();
