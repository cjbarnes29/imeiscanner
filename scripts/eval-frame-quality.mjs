// Runs the frame-quality module on the real photos in test-photos: originals, blurred copies and darkened copies.
// Not part of `npm test` (needs sharp and the local, git-ignored photos).
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile,readdir,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-fq-'));
await writeFile(join(dir,'fq.mjs'),ts.transpileModule(await readFile('src/frame-quality.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const q=await import(pathToFileURL(join(dir,'fq.mjs')).href);
const grade=async img=>{const {data,info}=await img.clone().resize({width:480,height:480,fit:'inside'}).grayscale().raw().toBuffer({resolveWithObject:true});return q.analyzeGray(data,info.width,info.height);};
const files=(await readdir('test-photos')).filter(f=>/^multi-\d+\.jpg$/.test(f)).sort();
const count={orig:{},blur:{},dim:{}};let n=0;
for(const f of files){
  const img=sharp('test-photos/'+f).rotate();
  const a=await grade(img),b=await grade(img.clone().blur(2.5)),d=await grade(img.clone().linear(0.18,0));
  count.orig[a.level]=(count.orig[a.level]||0)+1;count.blur[b.level]=(count.blur[b.level]||0)+1;count.dim[d.level]=(count.dim[d.level]||0)+1;n++;
  console.log(f.padEnd(13),'original:',a.level.padEnd(6),String(a.sharpness).padStart(4),'| blurred:',b.level.padEnd(6),'| darkened:',d.level);
}
console.log('originals',JSON.stringify(count.orig),'blurred',JSON.stringify(count.blur),'darkened',JSON.stringify(count.dim));
assert.equal(count.blur.blurry,n,'every blurred copy is flagged blurry');
assert.ok((count.orig.blurry||0)===0&&(count.orig.dark||0)===0,'no original, readable photo is flagged blurry or dark');
console.log(`PASS on ${n} real photos: ${n}/${n} blurred copies flagged, 0 of ${n} readable originals wrongly flagged blurry/dark; darkened copies flagged dark: ${count.dim.dark||0}/${n}.`);
