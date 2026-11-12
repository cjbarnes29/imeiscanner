// Prints sharpness / glare numbers for the photos in test-photos (originals and deliberately blurred / darkened copies).
// Used to choose the thresholds in src/frame-quality.ts. Not part of `npm test` (needs sharp and local photos).
import sharp from 'sharp';
import {readdir} from 'node:fs/promises';
const lapVar=(g,w,h)=>{let s=0,s2=0,n=0;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;const l=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];s+=l;s2+=l*l;n++;}const m=s/n;return s2/n-m*m;};
const stats=async img=>{const {data,info}=await img.clone().resize({width:480,height:480,fit:'inside'}).grayscale().raw().toBuffer({resolveWithObject:true});let bright=0,dark=0;for(const v of data){if(v>=250)bright++;if(v<40)dark++;}return {sharp:Math.round(lapVar(data,info.width,info.height)),glare:+(bright/data.length*100).toFixed(2),dark:+(dark/data.length*100).toFixed(1)};};
for(const f of (await readdir('test-photos')).filter(f=>/^multi-\d+\.jpg$/.test(f)).sort()){
  const img=sharp('test-photos/'+f).rotate();
  const a=await stats(img),b=await stats(img.clone().blur(2.5)),c=await stats(img.clone().blur(5)),d=await stats(img.clone().linear(0.35,0));
  console.log(f.padEnd(13),'sharp',String(a.sharp).padStart(5),'| blur2.5',String(b.sharp).padStart(5),'| blur5',String(c.sharp).padStart(5),'| glare%',a.glare,'| dark%',a.dark,'| dimmed dark%',d.dark);
}
