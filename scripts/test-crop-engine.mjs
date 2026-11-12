// Tests for the crop box model, drafts, IMEI validation/repair/voting, picture treatments and the retry logic.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-crop-'));
const load=async name=>{
  let source=await readFile(`src/${name}.ts`,'utf8');
  source=source.replace(/from '\.\/([a-z-]+)'/g,(_,m)=>`from './${m}.mjs'`);
  await writeFile(join(dir,`${name}.mjs`),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
};
for(const n of ['crop-boxes','crop-draft','imei-validate','ocr-preprocess','ocr-retry'])await load(n);
const imp=n=>import(pathToFileURL(join(dir,`${n}.mjs`)).href);
const B=await imp('crop-boxes'),D=await imp('crop-draft'),V=await imp('imei-validate'),P=await imp('ocr-preprocess'),R=await imp('ocr-retry');

// ---- Box model: counting, drawing, move, resize, delete
const box=(x,y,width,height)=>({x,y,width,height});
let boxes=[];
for(const b of [box(5,5,30,30),box(50,5,30,30),box(5,50,30,30)]){const r=B.addBox(boxes,b);assert.ok(r.boxes,'box accepted');boxes=r.boxes;}
assert.equal(boxes.length,3,'the count is simply the number of boxes: no separate number to keep in step');
assert.ok(B.addBox(boxes,box(6,6,28,28)).error,'the same label drawn twice is refused');
assert.ok(B.addBox(boxes,box(60,60,1,1)).error,'a stray tap is not a label');
assert.ok(B.addBox(boxes,box(0,0,100,100)).error,'the whole photo is not a label');
assert.deepEqual(B.hitTest(boxes,{x:20,y:20}),{index:0,part:'body'});
assert.deepEqual(B.hitTest(boxes,{x:35.5,y:5.5}),{index:0,part:'ne'},'corner handles are found first');
assert.equal(B.hitTest(boxes,{x:90,y:90}),null);
// wide photo on a narrow screen: a finger is 7% across but 18% down. A second label drawn 14% to the right of box 1 must start a NEW box, not grab box 1's corner.
assert.equal(B.hitTest([box(3,17,40,64)],{x:57,y:17},{x:7,y:18}),null,'a finger-sized corner area does not swallow a point far to the side');
assert.deepEqual(B.hitTest([box(3,17,40,64)],{x:44,y:19},{x:7,y:18}),{index:0,part:'ne'},'…but the corner itself is still grabbable');
assert.deepEqual(B.hitTest([box(10,10,6,6)],{x:13,y:13},{x:20,y:20}),{index:0,part:'body'},'a tiny box can still be moved by its middle');
const moved=B.moveBox(boxes[1],40,-20);assert.equal(moved.x,70,'box stops at the right edge');assert.equal(moved.y,0,'box stops at the top');
const resized=B.resizeBox(boxes[0],'se',{x:60,y:70});assert.deepEqual(resized,box(5,5,55,65),'dragging a corner keeps the opposite corner');
const tiny=B.resizeBox(boxes[0],'nw',{x:90,y:90});assert.ok(tiny.width>=B.MIN_EDGE&&tiny.height>=B.MIN_EDGE,'a box cannot be dragged inside out');
assert.equal(B.removeBoxes(boxes,[0,2]).length,1,'delete several boxes together');
assert.deepEqual(B.removeBoxes(boxes,[0,2])[0],boxes[1]);
const group=B.moveBoxes(boxes,[0,1],5,5);assert.equal(group[0].x,10);assert.equal(group[1].y,10);assert.equal(group[2].x,5,'only the chosen boxes move');
assert.deepEqual(B.sortReadingOrder([box(50,52,20,20),box(5,50,20,20),box(50,5,20,20),box(5,6,20,20)]).map(b=>[b.x,b.y]),[[5,6],[50,5],[5,50],[50,52]],'rows top to bottom, left to right');
assert.deepEqual(B.boxToPixels(box(50,50,50,50),1000,800),{left:500,top:400,width:500,height:400});
assert.equal(B.boxesAreSound(boxes),true);assert.equal(B.boxesAreSound([boxes[0],boxes[0]]),false);
assert.ok(B.boxFromPoints({x:80,y:70},{x:20,y:10}).width===60,'dragging up and left works');

// ---- Drafts
const mem=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};};
const st=mem();
assert.equal(D.writeDraft(st,[{recordId:'a',boxes:[]}],0),false,'an empty draft is not kept');
assert.equal(D.writeDraft(st,[{recordId:'a',boxes:[box(5,5,30,30)]},{recordId:'b',boxes:[box(10,10,20,20),box(50,50,20,20)]}],1,new Date('2026-01-02T03:04:05Z')),true);
let d=D.readDraft(st,new Set(['a','b']));assert.equal(d.items.length,2);assert.equal(d.index,1);assert.deepEqual(D.draftSummary(d),{photos:2,boxes:3});
d=D.readDraft(st,new Set(['b']));assert.equal(d.items.length,1,'a photo that is gone leaves the draft');assert.equal(d.index,0,'the position is kept inside the list');
assert.equal(D.readDraft(st,new Set(['zzz'])),null,'nothing left: no draft');assert.equal(st.m.size,0,'a dead draft is removed');
st.setItem(D.DRAFT_KEY,'{bad json');assert.equal(D.readDraft(st),null);
st.setItem(D.DRAFT_KEY,JSON.stringify({version:1,index:0,items:[{recordId:'a',boxes:[{x:-5,y:0,width:10,height:10},{x:1,y:1,width:20,height:20},'x']}]}));
assert.equal(D.readDraft(st).items[0].boxes.length,1,'invalid boxes are dropped');

// ---- IMEI validation
assert.equal(V.luhnValid('352099001761481'),true);assert.equal(V.luhnValid('352099001761482'),false);assert.equal(V.luhnValid('12345'),false);
assert.equal(V.luhnCheckDigit('35209900176148'),'1');
const GOOD='352099001761481';           // valid
const withDigit=(s,i,d)=>s.slice(0,i)+d+s.slice(i+1);
assert.deepEqual(V.imeiReadings('IMEI 1: 352 099 001 761 481\nIMEI 2: 352099001761499'),[GOOD],'IMEI 2 is never taken as IMEI 1');
assert.deepEqual(V.imeiReadings('IMEI: 3520990O1761481'),[GOOD],'letter O inside the number is a zero');
assert.deepEqual(V.imeiReadings('IMEl 1 352099001761481'),[GOOD],'lowercase L in the label');
assert.deepEqual(V.imeiReadings('IMEI 1: 35209900176148'),['35209900176148'],'a 14-digit read is kept so it can be repaired');
// judging
let j=V.judgeImei({readings:[GOOD]});assert.equal(j.imei,GOOD);assert.equal(j.method,'checksum');assert.ok(!j.needsReview);
const one=j.confidence;j=V.judgeImei({readings:[GOOD,GOOD,GOOD]});assert.ok(j.confidence>one,'more agreeing reads: more confidence');
j=V.judgeImei({readings:[withDigit(GOOD,13,'9')],barcode:GOOD});assert.equal(j.method,'barcode');assert.equal(j.imei,GOOD);assert.ok(j.confidence>=96,'barcode beats a bad OCR read');
const OTHER='353879234252633';assert.equal(V.luhnValid(OTHER),true);
j=V.judgeImei({readings:[GOOD,OTHER]});assert.equal(j.imei,'');assert.ok(j.needsReview,'two different valid numbers and no winner: ask');assert.deepEqual(j.alternatives.sort(),[GOOD,OTHER].sort());
j=V.judgeImei({readings:[GOOD,GOOD,OTHER]});assert.equal(j.imei,GOOD,'the majority wins');assert.equal(j.method,'vote');
// vote digit by digit
const bad1=withDigit(GOOD,4,'0'),bad2=withDigit(GOOD,10,'3');
assert.ok(!V.luhnValid(bad1)&&!V.luhnValid(bad2));
j=V.judgeImei({readings:[bad1,bad2,GOOD.replace(/1$/,'1')===GOOD?withDigit(GOOD,2,'2'):GOOD]});
assert.equal(j.imei,GOOD,'errors in different places are voted out across three reads');
// repair
const TAC=new Set([GOOD.slice(0,8)]);
const misread=withDigit(GOOD,12,'7');            // 8 read as ... a confusable? use a true confusion pair below
let pair=null;for(let i=8;i<14;i++){const alt=(V.CONFUSIONS[GOOD[i]]||[])[0];if(alt&&!V.luhnValid(withDigit(GOOD,i,alt))){pair={i,alt};break;}}
assert.ok(pair,'found a confusable digit to damage');
const damaged=withDigit(GOOD,pair.i,pair.alt);
j=V.judgeImei({readings:[damaged],knownTacs:TAC});
assert.ok(!V.luhnValid(damaged));
const reps=V.repairCandidates(damaged,TAC);assert.ok(reps.some(r=>r.value===GOOD),'the real number is among the repairs');
if(j.imei){assert.equal(j.method,'repair');assert.ok(j.needsReview,'a repaired number is always flagged');assert.equal(j.imei,GOOD);}
else assert.ok(j.needsReview);
// A single wrong digit that is NOT a confusion pair is never "repaired"
let notPair=null;for(let i=8;i<14;i++)for(let d=0;d<=9;d++){const t=withDigit(GOOD,i,String(d));if(!V.luhnValid(t)&&!(V.CONFUSIONS[GOOD[i]]||[]).includes(String(d))&&String(d)!==GOOD[i]){notPair=t;break;}if(notPair)break;}
assert.deepEqual(V.repairCandidates(notPair,TAC).filter(r=>r.value===GOOD),[],'only look-alike digits are repaired');
// no known model codes: suggestions only, never auto-accepted
j=V.judgeImei({readings:[damaged]});assert.equal(j.imei,'','without a known model code a repair is only a suggestion');assert.ok(j.needsReview);
// model code is not repaired into another model
const tacChanged=V.repairCandidates(withDigit(GOOD,3,'0'),TAC);assert.ok(tacChanged.every(r=>r.index>=8||r.tacKnown),'a read model code is not turned into an unknown one');
// 14 digits: dropped digit filled in only with a known model
const dropped=GOOD.slice(0,9)+GOOD.slice(10);
assert.ok(V.repairCandidates(dropped,TAC).some(r=>r.value===GOOD),'a dropped digit is restored when the model code is known');
assert.equal(V.repairCandidates(dropped).length,0,'…and never guessed without one');
// nothing at all
j=V.judgeImei({readings:[]});assert.equal(j.imei,'');assert.ok(j.needsReview);assert.equal(j.confidence,0);
// same IMEI in two boxes
assert.deepEqual([...V.repeatedAcrossBoxes([GOOD,OTHER,GOOD,''])].sort(),[0,2]);assert.equal(V.repeatedAcrossBoxes(['','']).size,0);

// ---- Picture treatments
const W=60,H=40,flat=(v)=>new Uint8Array(W*H).fill(v);
const text=(bg,ink)=>{const g=flat(bg);for(let y=8;y<H-8;y+=6)for(let x=6;x<W-6;x++)if(x%5<3)g[y*W+x]=ink,g[(y+1)*W+x]=ink;return g;};
const crisp=P.pictureStats(text(230,20),W,H),dim=P.pictureStats(text(60,30),W,H);
assert.ok(crisp.spread>150,'high contrast measured');assert.ok(dim.mean<100,'dark picture measured');
const soft=P.unsharp(P.applyVariant('plain',text(230,20),W,H),W,H);
const blurred=(()=>{const g=text(230,20),o=new Uint8Array(g.length);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){let s=0;for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)s+=g[(y+a)*W+x+b];o[y*W+x]=s/9;}return o;})();
assert.ok(P.pictureStats(blurred,W,H).blur<crisp.blur,'blur lowers the sharpness score');
assert.ok(P.pictureStats(P.unsharp(blurred,W,H),W,H).blur>P.pictureStats(blurred,W,H).blur,'sharpening raises it again');
const lowContrast=text(120,100);assert.ok(P.pictureStats(P.stretchLevels(lowContrast),W,H).spread>P.pictureStats(lowContrast,W,H).spread,'level stretch widens the range');
// uneven light: left half in shadow
const shadow=text(230,20);for(let y=0;y<H;y++)for(let x=0;x<W/2;x++)shadow[y*W+x]=Math.round(shadow[y*W+x]*0.4);
const fixed=P.evenLight(shadow,W,H);const meanSide=(g,from,to)=>{let s=0,n=0;for(let y=0;y<H;y++)for(let x=from;x<to;x++){s+=g[y*W+x];n++;}return s/n;};
assert.ok(Math.abs(meanSide(fixed,0,W/2)-meanSide(fixed,W/2,W))<Math.abs(meanSide(shadow,0,W/2)-meanSide(shadow,W/2,W)),'even-light evens out the shadow');
const bin=P.adaptiveThreshold(shadow,W,H);assert.ok([...new Set(bin)].every(v=>v===0||v===255),'adaptive threshold is pure black and white');
assert.equal(P.invertGray(Uint8Array.of(0,255,100))[2],155);
// plan
const planBlur=P.planPasses({width:1200,height:900,mean:150,spread:150,blur:20});assert.equal(planBlur[0],'sharpen','blurry: sharpen first');
const planDark=P.planPasses({width:1200,height:900,mean:60,spread:150,blur:500});assert.equal(planDark[0],'invert','dark: invert first');
const planSmall=P.planPasses({width:300,height:200,mean:150,spread:150,blur:500});assert.ok(planSmall.indexOf('upscale')<planSmall.indexOf('even-light'),'tiny label: enlarge first');
assert.ok(!planBlur.includes('plain'),'plain is the first read, never repeated');assert.equal(new Set(planBlur).size,planBlur.length,'no treatment twice');

// ---- Retry: stops when sure, stops at the limit, uses only what is needed
const calls=[];
const mk=(answers)=>({prepare:v=>v,read:async v=>{calls.push(v);return answers[v]??'';}});
calls.length=0;
let r=await R.retryLowConfidence({text:'IMEI 1: '+GOOD,plan:['levels','sharpen'],...mk({})});
assert.equal(calls.length,0,'a confident first read costs no extra passes');assert.equal(r.judgement.imei,GOOD);
calls.length=0;
r=await R.retryLowConfidence({text:'IMEI 1: '+bad1,plan:['levels','sharpen','even-light','adaptive','invert'],...mk({levels:'IMEI 1: '+bad2,sharpen:'IMEI 1: '+GOOD})});
assert.deepEqual(calls,['levels','sharpen'],'stops as soon as a valid number appears');assert.equal(r.judgement.imei,GOOD);assert.deepEqual(r.passes,['levels','sharpen']);
calls.length=0;
r=await R.retryLowConfidence({text:'',plan:['levels','sharpen','even-light','adaptive','invert'],maxPasses:3,...mk({})});
assert.equal(calls.length,3,'never more than maxPasses');assert.ok(r.judgement.needsReview,'still nothing: manual review');assert.equal(r.judgement.imei,'');
r=await R.retryLowConfidence({text:'',plan:['levels'],prepare:v=>v,read:async()=>{throw new Error('boom');}});
assert.ok(r.judgement.needsReview,'a failing pass does not crash the scan');
console.log('PASS: crop boxes (auto count, draw, move, resize, delete, group move, duplicates, reading order), drafts (save, restore, drop missing photos, bad data), IMEI checksum/lookalike letters/voting/safe repair/barcode priority/mixed numbers, picture treatments and plans, low-confidence retry limits.');
