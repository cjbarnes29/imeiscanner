import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-fq-'));
await writeFile(join(dir,'fq.mjs'),ts.transpileModule(await readFile('src/frame-quality.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const q=await import(pathToFileURL(join(dir,'fq.mjs')).href);

// A label-like picture: dark text bars on light paper (deterministic).
const W=320,H=240;
const label=()=>{const g=new Uint8Array(W*H).fill(215);for(let y=20;y<H-20;y+=14)for(let x=16;x<W-16;x++)if((x*7+y*3)%11<6)for(let k=0;k<5;k++)g[(y+k)*W+x]=35;return g;};
const boxBlur=(g,r)=>{const o=new Uint8Array(g.length);for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0,n=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const yy=y+dy,xx=x+dx;if(yy>=0&&yy<H&&xx>=0&&xx<W){s+=g[yy*W+xx];n++;}}o[y*W+x]=s/n;}return o;};

const sharp=q.analyzeGray(label(),W,H);
assert.ok(sharp.sharpness>q.SOFT_BELOW&&sharp.level==='good','a crisp label is good: '+JSON.stringify(sharp));
const blurred=q.analyzeGray(boxBlur(boxBlur(label(),4),4),W,H);
assert.ok(blurred.sharpness<sharp.sharpness/5,'blurring lowers sharpness a lot');
assert.equal(blurred.level,'blurry','a blurred label is flagged blurry: '+JSON.stringify(blurred));
const soft=q.analyzeGray(boxBlur(label(),1),W,H);
assert.ok(soft.sharpness<sharp.sharpness&&soft.sharpness>blurred.sharpness,'a light blur is between sharp and blurry');

// Glare: a large blown-out patch on an otherwise sharp label
const glare=label();for(let y=40;y<150;y++)for(let x=40;x<200;x++)glare[y*W+x]=255;
const g=q.analyzeGray(glare,W,H);
assert.ok(g.glarePercent>=q.GLARE_ABOVE,'glare percent measured: '+g.glarePercent);
assert.ok(g.level==='glare'||g.level==='blurry','a blown-out patch is not "good": '+g.level);
// Dark
const darkFrame=new Uint8Array(W*H).fill(12);
assert.equal(q.analyzeGray(darkFrame,W,H).level,'dark','an almost black frame is dark');
// Flat grey frame is not sharp
assert.equal(q.analyzeGray(new Uint8Array(W*H).fill(128),W,H).level,'blurry','a flat frame has no detail');
assert.equal(q.laplacianVariance(new Uint8Array(4),2,2),0,'tiny images do not crash');
for(const f of [sharp,blurred,g])assert.ok(f.message.length>5,'every level has a message');
console.log('PASS: frame quality (sharp / soft / blurry, glare, dark, flat) with advice messages.');
