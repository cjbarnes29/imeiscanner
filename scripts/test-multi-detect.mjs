import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-multi-'));
const source=await readFile('src/multi-detect.ts','utf8');
await writeFile(join(dir,'multi-detect.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const m=await import(pathToFileURL(join(dir,'multi-detect.mjs')).href);

// Synthetic label: text-like bars whose lines run downward to the right by `deg` degrees.
const bars=(deg,w=400,h=300)=>{const g=new Uint8Array(w*h).fill(235),t=Math.tan(deg*Math.PI/180);
  for(let y0=-80;y0<h+80;y0+=14)for(let x=20;x<w-20;x++){if((x%9)<6){const y=Math.round(y0+(x-w/2)*t+h/2*0);for(let k=0;k<4;k++){const yy=y+k;if(yy>=0&&yy<h)g[yy*w+x]=30;}}}
  return g;};
for(const deg of [0,6,-9,12]){
  const r=m.estimateSkewFromGray(bars(deg),400,300);
  assert.ok(Math.abs(r.angle-deg)<=1.25,`skew ${deg} measured as ${r.angle}`);
}
assert.ok(m.estimateSkewFromGray(new Uint8Array(400*300).fill(200),400,300).angle===0,'blank picture: no tilt');

// Tiles
const t4=m.tileRects(4000,3000,4);assert.equal(t4.length,4,'4 products: 2x2 tiles');
const t2=m.tileRects(4000,3000,2);assert.equal(t2.length,2);assert.ok(t2[0].width>2000&&t2[1].x<2000,'two halves overlap');
assert.equal(m.tileRects(3000,4000,3).length,3);assert.equal(m.tileRects(4000,3000,6).length,6);
for(const t of [...t4,...t2])assert.ok(t.x>=0&&t.y>=0&&t.x+t.width<=4000&&t.y+t.height<=3000,'tiles stay inside the photo');

// Merge repeated lines from overlapping tiles
const L=(text,x0,y0)=>({text,bbox:{x0,y0,x1:x0+300,y1:y0+30}});
const merged=m.mergeOcrLines([L('IMEI 1: 351555818871475',100,100)],[L('IMEI 1: 351555818871475',102,101),L('IMEI 1: 352099001761002',100,700)]);
assert.equal(merged.length,2,'repeat dropped, new line kept');
// Orientation decisions and product counting
assert.equal(m.shouldTurn(0,4),true,'a sideways photo reads nothing: turn it');
assert.equal(m.shouldTurn(2,3),false,'a small difference does not justify turning');
assert.equal(m.shouldTurn(2,2),false);
assert.equal(m.needsOrientationCheck(2),true,'weak read of junk is still checked');
assert.equal(m.needsOrientationCheck(8),false,'a clear read is not turned');
const M=(t,x,y)=>({text:t,bbox:{x0:x,y0:y,x1:x+300,y1:y+40}});
assert.equal(m.countModelLabels([M('Model : SM-A165F/DS',50,50),M('Model : SM-A165F/DS',52,52),M('Model : SM-A165F/DS',50,900),M('SM-A165FZADMEA',50,130)]),2,'two labels (repeat of the same line counts once)');
console.log('PASS: tilt estimation (0, 6, -9, 12 degrees), blank picture, overlapping tile plans for 2-6 products, merging repeated lines from tiles.');
