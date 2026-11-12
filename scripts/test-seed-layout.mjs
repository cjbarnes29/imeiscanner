// Product separation from label lines (stacked, side by side, grid), tile grids for big photos, and the IMEI 2 pairing rule.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-seed-'));
const compile=async name=>{const src=(await readFile(`src/${name}.ts`,'utf8')).replace(/from '\.\/([\w-]+)'/g,"from './$1.mjs'");await writeFile(join(dir,name+'.mjs'),ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);};
await compile('imei-validate');await compile('seed-layout');await compile('multi-detect');await compile('scan-layout');
const seed=await import(pathToFileURL(join(dir,'seed-layout.mjs')).href);
const md=await import(pathToFileURL(join(dir,'multi-detect.mjs')).href);
const L=(text,x0,y0,w=300,h=24)=>({text,bbox:{x0,y0,x1:x0+w,y1:y0+h}});
// One printed label: Model line at the top, storage, S/N, then the IMEI strips at the bottom.
const label=(x,y)=>[L('Model : SM-A077F/DS',x,y),L('4GB | 64GB',x,y+60),L('S/N : R83L80ZJYCP',x,y+110),L('IMEI 1 : 351124071926755',x,y+210,500),L('IMEI 1 : 351124071926755  IMEI 2 : 351570781926750',x,y+250,700)];

// 1. Five boxes stacked.
let lines=[0,1,2,3,4].flatMap(i=>label(100,100+i*420));
let seeds=seed.labelSeeds(lines,1200);
assert.equal(seeds.length,5,'five labels = five seeds');
let regions=seed.seedCrops(lines,seeds,1200,2300);
assert.equal(regions.length,5,'five crops');
for(let i=0;i<5;i++){const r=regions[i];assert.ok(r.y<=100+i*420&&r.y+r.height>=100+i*420+274,`crop ${i} holds its whole label`);if(i)assert.ok(regions[i-1].y+regions[i-1].height<=r.y+1,'crops do not overlap');}
// no crop contains another product's text
for(let i=0;i<5;i++)for(let j=0;j<5;j++)if(i!==j){const r=regions[i];const top=100+j*420;assert.ok(!(r.y<top+250&&r.y+r.height>top+20),`crop ${i} must not reach label ${j}`);}

// 2. Repeats of the same line (whole photo + overlapping tile) count once.
const twice=[...lines,...lines.map(l=>({...l,bbox:{x0:l.bbox.x0+7,x1:l.bbox.x1+7,y0:l.bbox.y0+3,y1:l.bbox.y1+3}}))];
assert.equal(seed.labelSeeds(twice,1200).length,5,'a line read twice is one seed');

// 3. A grid: two columns of stacked boxes (text of the two columns is joined into wide lines by the OCR).
const col=(x)=>[0,1,2].flatMap(i=>label(x,100+i*420));
lines=[...col(60),...col(1160)];
lines.push(L('IMEI 1 : 351124071926755          Model : SM-A077F/DS',60,520,1400));   // a line that spans the gap
const white=(w,h)=>{const data=new Uint8ClampedArray(w*h*4).fill(230);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;const inGap=x>1000&&x<1100;if(!inGap&&(x%11<4)&&(y%7<3)){data[i]=data[i+1]=data[i+2]=30;}}return {data,width:w,height:h};};
seeds=seed.labelSeeds(lines,2200);
const plan=seed.seedPlan(lines,seeds,2200,1500,white(2200,1500));
assert.equal(plan.regions.length,seeds.length,'grid: '+plan.why);
assert.ok(plan.regions.length>=6,'six products in a 2x3 grid');
const left=plan.regions.filter(r=>r.x<1000),right=plan.regions.filter(r=>r.x>=1000);
assert.ok(left.length>=3&&right.length>=3,'three per column');
for(const r of plan.regions)assert.ok(r.needsReview,'text-based crops are marked for review');
// Without the picture, joined lines make the columns overlap: no plan (never cut blindly).
assert.equal(seed.seedCrops(lines,seeds,2200,1500).length,0,'columns that cannot be told apart give no crops');

// 4. Products side by side.
lines=[0,1,2].flatMap(i=>label(80+i*800,200));
seeds=seed.labelSeeds(lines,2400);regions=seed.seedCrops(lines,seeds,2400,800);
assert.equal(regions.length,3,'three side by side');assert.ok(regions[0].x+regions[0].width<=regions[1].x+1);

// 5. One product, or no seed lines: nothing to separate.
assert.equal(seed.seedCrops(label(100,100),seed.labelSeeds(label(100,100),1200),1200,800).length,0);

// 6. Tile grid for big photos does not depend on any count and stays inside the picture.
const grid=md.gridTileRects(2160,5000);
assert.ok(grid.length>=8&&grid.length<=12,'tile count from photo size: '+grid.length);
for(const t of grid)assert.ok(t.x>=0&&t.y>=0&&t.x+t.width<=2160&&t.y+t.height<=5000&&Math.max(t.width,t.height)<=1800,'tile inside and of reading size');
assert.equal(md.gridTileRects(1000,800).length,1,'a small photo is one tile');
assert.ok(md.gridTileRects(9000,9000).length<=12,'tile count is capped');
assert.ok(md.medianLineHeight([L('a',0,0,10,10),L('b',0,20,10,12),L('c',0,40,10,40)])===12);

// 7. IMEI 2 pairing: checksum and the shared serial digits (Samsung labels).
const iv=await import(pathToFileURL(join(dir,'imei-validate.mjs')).href);
assert.equal(iv.pairedImei2('351973130856613','353749140856613','SM-A376B'),'353749140856613','a real pair is kept');
assert.equal(iv.pairedImei2('351973130856613','357937313713945','SM-A376B'),'','IMEI 2 of another box is dropped');
assert.equal(iv.pairedImei2('351973130869491','355749140869498','SM-A376B'),'','IMEI 2 that fails the checksum is dropped');
assert.equal(iv.pairedImei2('490154203237518','356938035643809','iPhone 15'),'356938035643809','other brands keep a valid IMEI 2');
assert.equal(iv.pairedImei2('351973130856613','','SM-A376B'),'');

console.log('PASS: product separation from label lines (5 stacked, repeated lines counted once, 2x3 grid with joined lines, side by side, no blind cuts), tile grids for big photos, IMEI 2 pairing.');
