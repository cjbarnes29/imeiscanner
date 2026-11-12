// For each multi-product photo: read the text at 0/90/180/270 degrees and report label-like text and Luhn-valid IMEIs.
import sharp from 'sharp';
import {readdir} from 'node:fs/promises';
import {createWorker,PSM} from 'tesseract.js';
const luhn=s=>{let t=0;for(let i=0;i<15;i++){let d=+s[14-i];if(i%2){d*=2;if(d>9)d-=9;}t+=d;}return t%10===0;};
const imeisIn=text=>{const out=new Set();for(const m of text.replace(/[Oo]/g,'0').matchAll(/(?<!\d)(?:\d[ -]?){14}\d(?!\d)/g)){const d=m[0].replace(/\D/g,'');if(d.length===15&&luhn(d))out.add(d);}return [...out];};
const labelScore=t=>{t=t.toUpperCase();const c=p=>(t.match(p)||[]).length;return c(/\bIM[E3][I1!|L]/g)+c(/\bS\s*[\/|I]\s*N\b/g)+c(/\bMODEL\b|\bSM\s*-\s*[A-Z]\d{3}/g);};
const only=process.argv[2];
const files=(await readdir('test-photos')).filter(f=>/^multi-\d+\.jpg$/.test(f)).sort().filter(f=>!only||f.includes(only));
const worker=await createWorker('eng',1,{langPath:'.',gzip:false,cacheMethod:'none'});
await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'300'});
for(const f of files){
  const row=[];
  for(const angle of [0,90,180,270]){
    const buf=await sharp('test-photos/'+f).rotate().rotate(angle).resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).grayscale().normalise().jpeg({quality:92}).toBuffer();
    const {data}=await worker.recognize(buf);
    row.push({angle,score:labelScore(data.text),imeis:imeisIn(data.text).length});
  }
  const best=[...row].sort((a,b)=>b.score-a.score||b.imeis-a.imeis)[0];
  console.log(f.padEnd(13),row.map(r=>`${r.angle}°:s${r.score}/i${r.imeis}`).join('  '),' → best',best.angle+'°');
}
await worker.terminate();
