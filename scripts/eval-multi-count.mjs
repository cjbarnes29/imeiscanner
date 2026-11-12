// How many "Model : SM-…" labels does the text read see in each photo (the app's automatic product count)?
import sharp from 'sharp';
import {readdir} from 'node:fs/promises';
import {createWorker,PSM} from 'tesseract.js';
const files=(await readdir('test-photos')).filter(f=>/^multi-\d+\.jpg$/.test(f)).sort();
const worker=await createWorker('eng',1,{langPath:'.',gzip:false,cacheMethod:'none'});
await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'300'});
for(const f of files){
  let best=0,bestAngle=0;
  for(const angle of (/0[14]/.test(f)?[270]:[0])){
    const buf=await sharp('test-photos/'+f).rotate().rotate(angle).resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).grayscale().normalise().jpeg({quality:92}).toBuffer();
    const {data}=await worker.recognize(buf);
    const n=(data.text.match(/m[o0]del\s*[:;.]?\s*s\s*m/gi)||[]).length;
    if(n>=best){best=n;bestAngle=angle;}
  }
  console.log(f.padEnd(13),'model labels seen:',best);
}
await worker.terminate();
