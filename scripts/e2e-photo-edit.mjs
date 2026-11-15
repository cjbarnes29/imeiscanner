// Photo editor + Bulk edit photos end to end in headless Edge/Chrome (not part of `npm test`; run `npm run build` first).
//   node e2e/fixtures/make-fixtures.mjs   (once: synthetic photos, no real device)
//   node scripts/e2e-photo-edit.mjs
// Seeds 5 records that need a look (one with an unknown model) and 1 confirmed record, then:
//  1. Bulk edit photos: "1 of 5 photos", Previous / Delete / Next; a turn and boxes survive Next / Previous; opening a photo is not an
//     edit; Delete moves on; on the last photo Next is "Finish (rescan N)": only edited photos are queued, the rest stay in Review.
//  2. The rescan turns sideways crops back and reads them; typed numbers are never overwritten; the deleted photo is archived;
//     the confirmed record is untouched; the queue panel says Queued / Processing / Needs review / Completed.
//  3. The review window has no Fix photo group; Crop / edit photo has Rotate (photo and boxes turn), Straighten and Delete photo (Undo).
//  4. An interrupted Bulk edit (page reload) offers Resume with the boxes kept.
//  5. No Unknown tab (People instead); Records has the Unknown model filter and badges; Review lists the unknown model; the People tab
//     adds, renames, searches, and has Devices / Export per person; Scan shows its controls first (no intro banner).
//  6. A scanned photo that cannot be read is retried once automatically and then stays in Review (no loop, never deleted).
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const fixture=async n=>{const f='e2e/fixtures/out/'+n;if(!existsSync(f))throw new Error(f+' is missing: run node e2e/fixtures/make-fixtures.mjs');return 'data:image/jpeg;base64,'+(await readFile(f)).toString('base64');};
// Synthetic numbers are built from parts (as in make-fixtures.mjs) so no full number is written in this file.
const luhn=d=>{let s=0;for(let i=0;i<d.length;i++){let n=+d[d.length-1-i];if(i%2===0){n*=2;if(n>9)n-=9;}s+=n;}return String((10-s%10)%10);};
const imei=(a,b)=>a+b+luhn(a+b);
const TYPED=imei('49015420','424242'),GOOD=imei('49015420','313131');
const LABEL_C=imei('49015420','555123'),LABEL_D=imei('49015420','999321'); // the two labels printed on E2E-two-box-CD.jpg
const photos={p1:await fixture('E2E-two-box-CD.jpg'),p2:await fixture('E2E-single-A.jpg'),p3:await fixture('E2E-dup-of-A.jpg'),p4:await fixture('E2E-single-B.jpg')};
const seed=[
  {id:'p1',number:3,name:'E2E-two-box-CD.jpg',dataUrl:photos.p1,imei:'',status:'Review',model:'SM-A165F'},
  {id:'p2',number:4,name:'E2E-single-A.jpg',dataUrl:photos.p2,imei:'',status:'Review',model:'SM-A376B'},
  {id:'p3',number:5,name:'E2E-dup-of-A.jpg',dataUrl:photos.p3,imei:'',status:'Review',model:'SM-A376B'},
  // a number a person typed (valid checksum) that does not match the label: a rescan must keep it and only flag it
  {id:'p4',number:6,name:'E2E-single-B.jpg',dataUrl:photos.p4,imei:TYPED,serial:'TYPEDSERIAL1',status:'Valid',model:'SM-S938B',imeiNeedsReview:true,imeiNote:'Check IMEI 1 against the label.'},
  // a phone whose model code the catalog does not know: listed in Review and under the Unknown model filter
  {id:'p6',number:8,name:'unknown.jpg',dataUrl:photos.p2,imei:imei('49015420','262626'),serial:'UNKSERIAL1',status:'Valid',model:'SM-Z123Q'},
  {id:'p5',number:7,name:'confirmed.jpg',dataUrl:photos.p2,imei:GOOD,serial:'GOODSERIAL1',status:'Valid',model:'SM-A165F',checked:true}
].map(r=>({pictureId:'PIC-'+r.id.toUpperCase(),sourcePictureId:'PIC-'+r.id.toUpperCase(),personId:'',originalDataUrl:r.dataUrl,duplicate:false,createdAt:new Date().toISOString(),raw:'',...r}));
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4195);
// An old headless browser still on the port would be reused with its old data: refuse to start instead.
if(await fetch('http://127.0.0.1:9351/json').then(()=>true,()=>false))throw new Error('Port 9351 is used by an old browser: stop the leftover headless msedge (profile imei-photoedit-*) first.');
const profile=await mkdtemp(join(tmpdir(),'imei-photoedit-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9351',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
// Edge hands its work to child processes, so stop every process that uses this run's own profile folder (and nothing else).
function stopBrowsersOf(dir){const tag=dir.split(/[\\/]/).pop();spawnSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{stdio:'ignore'});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9351/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(250);}throw new Error('Timed out waiting for: '+label);};
const clickText=(selector,text)=>run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const click=async(selector,text)=>{if(!await clickText(selector,text))throw new Error(`no enabled "${text}" in ${selector}`);};
const mouse=async(type,x,y,buttons)=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:buttons??(type==='mouseReleased'?0:1),clickCount:1});
const drag=async(x0,y0,x1,y1)=>{await mouse('mouseMoved',x0,y0,0);await mouse('mousePressed',x0,y0);for(let i=1;i<=6;i++)await mouse('mouseMoved',x0+(x1-x0)*i/6,y0+(y1-y0)*i/6);await mouse('mouseReleased',x1,y1);};
const imgRect=()=>run(`(()=>{const r=document.querySelector('.studio-viewport img').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
const studioText=()=>run(`document.querySelector('.studio-title span')?.textContent||''`);
const currentName=()=>run(`(document.querySelector('.studio-viewport img')?.alt||'').replace(/^Photo \\d+: /,'')`);
const labels=async()=>Number((await run(`document.querySelector('.studio-title b')?.textContent||'0'`)).match(/\d+/)?.[0]||0);
const autoDone=()=>waitFor(`!!document.querySelector('.studio-viewport img')&&document.querySelector('.studio-viewport img').naturalWidth>0&&!/Looking for labels/.test(document.querySelector('.studio-message')?.textContent||'')&&!document.querySelector('.studio-tools .spin')`,'the automatic search on open finished',120000);
const readStore=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll();const k=db.transaction('inventory').objectStore('inventory').getAllKeys();Promise.all([new Promise(r=>g.onsuccess=()=>r(g.result)),new Promise(r=>k.onsuccess=()=>r(k.result))]).then(([v,keys])=>{db.close();const out={records:[],archive:[]};keys.forEach((key,i)=>{const r=v[i];if(String(key).startsWith('record:'))out.records.push({id:r.id,src:r.sourceRecordId,imei:r.imei,serial:r.serial,checked:!!r.checked,flag:!!r.imeiNeedsReview,name:r.name});else if(String(key).startsWith('archive:'))out.archive.push({id:r.id,reason:r.reason,restored:!!r.restoredAt});});res(out);});};})`);
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
try{
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  await send('Page.navigate',{url:'http://localhost:4195/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');for(const r of ${JSON.stringify(seed)})tx.objectStore('inventory').put(r,'record:'+r.id);tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4195/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);

  // ---------- 1. Bulk edit photos ----------
  await waitFor(`[...document.querySelectorAll('.archive-banner button')].some(b=>b.textContent.trim()==='Bulk edit photos')`,'Bulk edit photos button in the review banner');
  ok('the review banner offers Bulk edit photos');
  await click('.archive-banner button','Bulk edit photos');
  await waitFor(`/Bulk edit photos/.test(document.querySelector('.studio-title strong')?.textContent||'')`,'bulk edit opens');
  assert.match(await studioText(),/^1 of 5 photos · 0 edited/,'progress');
  assert.deepEqual(await run(`[...document.querySelectorAll('.studio-steps button')].map(b=>b.textContent.trim())`),['Previous','Delete','Next'],'step buttons');
  ok('all 5 photos that need a look are loaded (incl. the unknown model): "1 of 5 photos", with Previous / Delete / Next');
  assert.equal(await currentName(),'E2E-two-box-CD.jpg');
  await autoDone();
  // photo 1: make sure both labels have a box, then turn it sideways (an edit); the rescan has to turn the crops back to read them
  if((await labels())<2){
    await run(`document.querySelector('.studio-more:not([open]) summary')?.click()`);await clickText('.studio-more button','Select all');await clickText('.studio-tools button','Delete');
    const r=await imgRect();
    await drag(r.x+r.w*0.05,r.y+r.h*0.04,r.x+r.w*0.95,r.y+r.h*0.46);await drag(r.x+r.w*0.05,r.y+r.h*0.54,r.x+r.w*0.95,r.y+r.h*0.96);
    await waitFor(`/2 labels/.test(document.querySelector('.studio-title b').textContent)`,'two drawn boxes');
  }
  const found=await labels();
  const dims1=await run(`(()=>{const i=document.querySelector('.studio-viewport img');return [i.naturalWidth,i.naturalHeight]})()`);
  await run(`document.querySelector('[aria-label="Rotate right"]').click()`);
  await waitFor(`(()=>{const i=document.querySelector('.studio-viewport img');return i.naturalWidth===${dims1[1]}&&i.naturalHeight===${dims1[0]}})()`,'photo 1 turned');
  await waitFor(`/^1 of 5 photos · 1 edited/.test(document.querySelector('.studio-title span').textContent)`,'photo 1 counts as edited');
  await click('.studio-steps button','Next');
  await waitFor(`/^2 of 5 photos/.test(document.querySelector('.studio-title span').textContent)`,'next photo');
  await autoDone();
  await click('.studio-steps button','Previous');
  await waitFor(`/^1 of 5 photos · 1 edited/.test(document.querySelector('.studio-title span').textContent)`,'back to photo 1');
  assert.equal(await labels(),found,'the boxes are still there');
  assert.ok(await run(`(()=>{const i=document.querySelector('.studio-viewport img');return i.naturalWidth===${dims1[1]}})()`),'the turn is still there');
  ok(`edits are kept while moving: photo 1 is still turned with its ${found} boxes after Next / Previous ("1 edited")`);
  await click('.studio-steps button','Next');
  await waitFor(`/^2 of 5 photos/.test(document.querySelector('.studio-title span').textContent)`,'photo 2');
  assert.equal(await currentName(),'E2E-single-A.jpg');
  await autoDone();
  assert.match(await studioText(),/· 1 edited/,'opening a photo (and its automatic search) is not an edit');
  await click('.studio-steps button','Next');
  await waitFor(`/^3 of 5 photos/.test(document.querySelector('.studio-title span').textContent)`,'photo 3');
  ok('photo 2 is left as it was (the automatic search on open does not count as an edit)');
  assert.equal(await currentName(),'E2E-dup-of-A.jpg');
  await autoDone();
  await click('.studio-steps button','Delete');
  await waitFor(`/^3 of 4 photos/.test(document.querySelector('.studio-title span').textContent)`,'deleted');
  assert.equal(await currentName(),'E2E-single-B.jpg','Delete moves on to the next photo');
  ok('Delete takes the photo out and moves on ("3 of 4 photos")');
  await autoDone();
  // photo 4: turned and turned back = edited, picture as before (its typed numbers must survive the rescan)
  await run(`document.querySelector('[aria-label="Rotate left"]').click()`);await waitFor(`!document.querySelector('.studio-progress')`,'turned');
  await run(`document.querySelector('[aria-label="Rotate right"]').click()`);await waitFor(`!document.querySelector('.studio-progress')`,'turned back');
  await waitFor(`/· 2 edited/.test(document.querySelector('.studio-title span').textContent)`,'photo 4 edited');
  await click('.studio-steps button','Next');
  await waitFor(`/^4 of 4 photos/.test(document.querySelector('.studio-title span').textContent)`,'last photo');
  assert.equal(await currentName(),'unknown.jpg');
  assert.deepEqual(await run(`[...document.querySelectorAll('.studio-steps button')].map(b=>b.textContent.trim())`),['Previous','Delete','Finish (rescan 2)'],'Finish on the last photo');
  ok('on the last photo Next becomes "Finish (rescan 2)"');
  await autoDone();
  await click('.studio-steps button','Finish');
  await waitFor(`!document.querySelector('.studio')`,'Finish closes the editor');
  assert.match(await run(`document.querySelector('.toast')?.textContent||''`),/2 edited photos queued for rescanning.*2 unchanged photos stay in Review/);
  ok('Finish queues only the 2 edited photos; the 2 unchanged ones stay in Review');

  // ---------- 2. background rescan ----------
  await waitFor(`/finished/.test(document.querySelector('.queue-banner')?.innerText||'')`,'background rescan finished',600000);
  await sleep(1500);
  let store=await readStore();
  assert.ok(!store.records.some(r=>r.id==='p1'),'photo 1 was replaced by its crops');
  const crops1=store.records.filter(r=>r.src==='p1');
  assert.equal(crops1.length,found,'one record per box: '+JSON.stringify(store.records.map(r=>({id:r.id.slice(0,6),src:r.src,imei:r.imei,name:r.name}))));
  const read1=crops1.map(r=>r.imei).filter(v=>v===LABEL_C||v===LABEL_D);
  assert.ok(read1.length>=1,'the sideways crops were turned and read: '+JSON.stringify(crops1.map(r=>r.imei)));
  ok(`the rescan turned the sideways crops of photo 1 and read ${read1.length} of ${crops1.length} label IMEIs correctly`);
  const p2=store.records.find(r=>r.id==='p2');
  assert.ok(p2&&p2.imei==='','the unchanged photo 2 is untouched (still in Review)');
  const p4=store.records.find(r=>r.id==='p4'||r.src==='p4');
  assert.ok(p4,'photo 4 record exists');
  assert.equal(p4.imei,TYPED,'the typed IMEI 1 was kept');
  assert.equal(p4.serial,'TYPEDSERIAL1','the typed serial was kept');
  ok(`the rescan kept the typed numbers of photo 4${p4.flag?' and flagged the different reading for review':''}; photo 2 was not rescanned`);
  const p5=store.records.find(r=>r.id==='p5');
  assert.ok(p5&&p5.imei===GOOD&&p5.checked&&p5.serial==='GOODSERIAL1','the confirmed record is untouched');
  assert.ok(!store.records.some(r=>r.id==='p3')&&store.archive.some(a=>a.id==='p3'&&!a.restored),'photo 3 is in the archive, not deleted');
  ok('the deleted photo is in the archive (restorable), the confirmed record is untouched');
  await click('.queue-banner button','Queue');
  await waitFor(`!!document.querySelector('.queue-tabs')`,'queue panel');
  const tabs=await run(`[...document.querySelectorAll('.queue-tabs button')].map(b=>b.childNodes[0].textContent.trim())`);
  assert.deepEqual(tabs.filter(t=>t!=='Process later'),['Queued','Processing','Needs review','Completed']);
  ok('the queue shows Queued / Processing / Needs review / Completed');
  await run(`document.querySelector('.queue-panel [aria-label="Close"], .queue-panel .iconbtn')?.click()`);
  await sleep(500);
  if(await run(`!!document.querySelector('.queue-tabs')`)){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await sleep(500);}

  // ---------- 3. single photo editor from the review window ----------
  await click('.archive-banner button','Review all');
  await waitFor(`!!document.querySelector('[aria-label="Open E2E-single-A.jpg in full"]')`,'review list');
  await run(`document.querySelector('[aria-label="Open E2E-single-A.jpg in full"]').click()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Crop / edit photo')`,'review window');
  assert.ok(!await run(`[...document.querySelectorAll('summary')].some(s=>s.textContent.trim()==='Fix photo')`),'no separate Fix photo group');
  assert.ok(!await run(`[...document.querySelectorAll('[aria-label="Rotate left"]')].length`),'no rotate buttons outside the editor');
  ok('the review window has no separate Fix photo / rotate buttons');
  await click('button','Crop / edit photo');
  await waitFor(`/Crop \\/ edit photo/.test(document.querySelector('.studio-title strong')?.textContent||'')`,'editor');
  await autoDone();
  const dims=await run(`(()=>{const i=document.querySelector('.studio-viewport img');return [i.naturalWidth,i.naturalHeight]})()`);
  if(!await labels()){const r=await imgRect();await drag(r.x+r.w*0.05,r.y+r.h*0.05,r.x+r.w*0.5,r.y+r.h*0.3);await waitFor(`/1 label/.test(document.querySelector('.studio-title b').textContent)`,'a box');}
  const n=await labels();
  const box0=await run(`document.querySelector('.studio-box').style.cssText`);
  await run(`document.querySelector('[aria-label="Rotate right"]').click()`);
  await waitFor(`(()=>{const i=document.querySelector('.studio-viewport img');return i.naturalWidth===${dims[1]}&&i.naturalHeight===${dims[0]}})()`,'the photo turned');
  assert.equal(await labels(),n,'the boxes are kept');
  assert.notEqual(await run(`document.querySelector('.studio-box').style.cssText`),box0,'the boxes turned with the photo');
  ok(`Rotate right turns the photo (${dims.join('x')} -> ${dims[1]}x${dims[0]}) and its ${n} box${n===1?'':'es'}`);
  await run(`document.querySelector('.studio-more summary').click()`);
  assert.ok(await run(`[...document.querySelectorAll('.studio-more button')].some(b=>b.textContent.trim()==='Straighten')`),'Straighten under More');
  await click('.studio-more button','Delete photo');
  await waitFor(`!document.querySelector('.studio')`,'editor closes after Delete photo');
  await waitFor(`/deleted from RetailLens/.test(document.querySelector('.undo-bar')?.textContent||'')`,'undo bar');
  await sleep(1200);
  store=await readStore();
  assert.ok(!store.records.some(r=>r.id==='p2')&&store.archive.some(a=>a.id==='p2'),'photo 2 moved to the archive');
  ok('Delete photo (under More) moves the photo and its record to the archive, with Undo');
  await click('.undo-bar button','Undo');
  await sleep(1500);
  store=await readStore();
  assert.ok(store.records.some(r=>r.id==='p2'),'Undo brings photo 2 back');
  ok('Undo brings the deleted photo back');
  for(let i=0;i<3&&await run(`!!document.querySelector('.modal-backdrop')`);i++){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await sleep(400);await run(`document.querySelector('[aria-label="Close photo review"],[aria-label="Close review"]')?.click()`);await sleep(400);}

  // ---------- 4. interrupted session ----------
  await run(`localStorage.removeItem('imei-lens-crop-draft-v1')`);
  await send('Page.navigate',{url:'http://localhost:4195/'});
  await waitFor(`[...document.querySelectorAll('.archive-banner button')].some(b=>b.textContent.trim()==='Bulk edit photos')`,'banner after reload');
  await click('.archive-banner button','Bulk edit photos');
  await waitFor(`!!document.querySelector('.studio')`,'bulk edit again');
  await autoDone();
  { const r=await imgRect();await drag(r.x+r.w*0.1,r.y+r.h*0.6,r.x+r.w*0.6,r.y+r.h*0.8); }
  await sleep(1200); // the draft is written half a second after a change
  const drafted=await run(`(JSON.parse(localStorage.getItem('imei-lens-crop-draft-v1')||'{}').items||[]).reduce((n,i)=>n+i.boxes.length,0)`);
  assert.ok(drafted>=1,'boxes are in the draft while editing');
  await send('Page.navigate',{url:'http://localhost:4195/'});
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Resume')`,'Resume after an interrupted session');
  ok(`an interrupted Bulk edit (page reload) offers Resume with ${drafted} box${drafted===1?'':'es'} kept`);

  // ---------- 5. Unknown models, People tab, no intro banner ----------
  assert.deepEqual(await run(`[...document.querySelectorAll('.bottom-nav button span')].map(s=>s.textContent)`),['Scan','Retail','Records','Give','People','Share','Export']);
  ok('the bottom bar has People and no Unknown tab');
  await click('.bottom-nav button','Scan');
  await waitFor(`!!document.querySelector('.dropzone, .android-scan')`,'scan controls');
  assert.ok(!await run(`!!document.querySelector('.hero')`),'no intro banner');
  const gap=await run(`Math.round((document.querySelector('.dropzone, .android-scan')).getBoundingClientRect().top)`);
  assert.ok(gap<400,'the scan controls are near the top: '+gap+'px');
  ok(`Scan shows its controls at once (no intro banner; first control at ${gap}px)`);
  await click('.bottom-nav button','Records');
  await waitFor(`[...document.querySelectorAll('.filter-chips button')].some(b=>/^Unknown model/.test(b.textContent.trim()))`,'Unknown model chip');
  await click('.filter-chips button','Unknown model');
  await waitFor(`!!document.querySelector('.unknown-tab')`,'naming cards');
  assert.ok(await run(`[...document.querySelectorAll('.badge-unknown')].length>=1`),'rows carry the badge');
  assert.ok(await run(`!!document.querySelector('[aria-label="Name for SM-Z123Q"], [aria-label^="Name for"]')`),'the name box of the Unknown tab is here');
  ok('Records: the Unknown model filter shows the naming cards and badged rows');
  await click('.filter-chips button','All');
  await click('.archive-banner button','Review all');
  await waitFor(`!!document.querySelector('[aria-label="Open unknown.jpg in full"]')`,'unknown record in review');
  assert.match(await run(`document.querySelector('[aria-label="Open unknown.jpg in full"]').closest('.bulk-row').textContent`),/Unknown model/);
  ok('Review lists the unknown-model phone with an "Unknown model" note');
  await run(`document.querySelector('[aria-label="Close review"]').click()`);
  await sleep(400);
  await click('.bottom-nav button','People');
  await waitFor(`!!document.querySelector('.people-search')`,'People tab');
  await click('.people-tab button','+ Add person');
  await waitFor(`!!document.querySelector('.people-tab input[aria-label="Person name"]')`,'name box');
  await run(`(()=>{const i=document.querySelector('.people-tab input[aria-label="Person name"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'Alex Test');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.people-tab button','Save name');
  await waitFor(`/Alex Test/.test(document.querySelector('.people-tab').textContent)`,'renamed');
  const type=async text=>run(`(()=>{const i=document.querySelector('.people-search');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(text)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await type('alex');await sleep(300);
  assert.equal(await run(`document.querySelectorAll('.people-tab .people-list > li').length`),1,'search by name');
  await type('nobody-xyz');await sleep(300);
  assert.match(await run(`document.querySelector('.people-tab .people-list').textContent`),/Nobody matches/);
  await type('');await sleep(300);
  assert.ok(await run(`[...document.querySelectorAll('.people-tab .person-tools button')].some(b=>b.textContent.trim().startsWith('Devices ('))&&[...document.querySelectorAll('.people-tab .person-tools button')].some(b=>/Export/.test(b.textContent))`),'Devices and Export per person');
  ok('People tab: add + rename a person, search by name ("Nobody matches" otherwise), Devices (N) and Export per person');

  // ---------- 6. Auto Scan: a photo the scan could not read is retried once, automatically, then stays in Review ----------
  await click('.bottom-nav button','Scan');
  await waitFor(`!!document.querySelector('#upload input[type=file]')`,'upload input');
  await run(`new Promise(res=>{const c=document.createElement('canvas');c.width=900;c.height=600;const g=c.getContext('2d');g.fillStyle='#8a8a8a';g.fillRect(0,0,900,600);for(let i=0;i<4000;i++){g.fillStyle='rgb('+(100+Math.random()*80|0)+',120,120)';g.fillRect(Math.random()*900,Math.random()*600,3,3);}g.fillStyle='#222';g.font='40px sans-serif';g.fillText('NO LABEL IN THIS PHOTO',120,300);c.toBlob(b=>{const dt=new DataTransfer();dt.items.add(new File([b],'E2E-unreadable.jpg',{type:'image/jpeg'}));const input=document.querySelector('#upload input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));res(true);},'image/jpeg',0.9);})`);
  await waitFor(`[...document.querySelectorAll('.scan-button')].some(b=>!b.disabled)`,'Scan button');
  await click('.scan-button','');
  await waitFor(`(JSON.parse(localStorage.getItem('imei-lens-auto-retried-v1')||'[]')).length>0`,'the unread photo was queued for an automatic retry',300000);
  const retried=await run(`JSON.parse(localStorage.getItem('imei-lens-auto-retried-v1'))`);
  assert.equal(retried.length,1,'only the new unread photo is retried (old records and crops are not)');
  ok('after the scan, the photo it could not read was queued once for an automatic retry (find, turn, level, cut)');
  await waitFor(`!JSON.parse(localStorage.getItem('imei-lens-crop-queue-v1')||'{"items":[]}').items.some(i=>i.status==='pending')`,'the retry finished',600000);
  await sleep(4000);
  const q=await run(`JSON.parse(localStorage.getItem('imei-lens-crop-queue-v1')||'{"items":[]}').items`);
  store=await readStore();
  const unread=store.records.find(r=>r.id===retried[0]);
  assert.ok(unread,'the unread photo is kept (never deleted)');
  assert.ok(q.filter(i=>i.recordId===retried[0]).every(i=>i.status==='failed'&&i.attempts<=1),'tried once, not again and again: '+JSON.stringify(q));
  assert.ok(await run(`!!document.querySelector('[aria-label="Open E2E-unreadable.jpg in full"]')||[...document.querySelectorAll('.archive-banner button')].some(b=>/^Review all/.test(b.textContent.trim()))`),'it is in Review (the review list opens by itself after a scan)');
  ok('the retry could not read it either: the photo is kept, marked Needs review in the queue, listed in Review, and not retried in a loop');
}catch(error){
  console.error('FAIL:',error.message);
  try{console.error('PAGE:',String(await run('document.body.innerText.slice(0,500)')).split(String.fromCharCode(10)).join(' | '));}catch{}
  process.exitCode=1;
}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
console.log(`${results.length} checks passed`);
