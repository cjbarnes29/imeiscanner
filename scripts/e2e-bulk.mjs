// Fast review list in headless Edge/Chrome at phone size (not part of `npm test`; run `npm run build` first).
//   node scripts/e2e-bulk.mjs [screenshot-folder]
// Needs test-photos/multi-02.jpg (private, not in git) as the label photo.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
// Fast review list in headless Edge/Chrome at phone size (not part of `npm test`; run `npm run build` first).
//   node scripts/e2e-bulk.mjs [screenshot-folder]
const shots=process.argv[2];if(shots)await mkdir(shots,{recursive:true});
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const name=(await readdir('test-photos')).find(f=>/^multi-02\.jpg$/.test(f));
if(!name)throw new Error('test-photos/multi-02.jpg is missing');
const photo='data:image/jpeg;base64,'+(await readFile('test-photos/'+name)).toString('base64');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4196);
const profile=await mkdtemp(join(tmpdir(),'imei-bulk-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9352',`--user-data-dir=${profile}`,'--window-size=420,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9352/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(200);}throw new Error('Timed out waiting for: '+label);};
const clickText=(selector,text)=>run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const shot=async n=>{if(!shots)return;const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(shots,n+'.png'),Buffer.from(r.result.data,'base64'));};
const typeInto=async(selector,text)=>{await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select&&e.select();return true;})()`);await send('Input.insertText',{text});};
const rect=sel=>run(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right};})()`);
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
// Three flagged records: A has a valid IMEI (looks right), B has none, C has a wrong checksum.
const seed=(n,imei,status,extra)=>`tx.objectStore('inventory').put({id:'seed-${n}',pictureId:'PIC-SEED${n}',sourcePictureId:'PIC-SEED${n}',number:${n+2},personId:'',name:'IMG_20260821_${n}.jpg',dataUrl:${JSON.stringify(photo)},originalDataUrl:${JSON.stringify(photo)},model:'SM-A576B',imei:'${imei}',status:'${status}',duplicate:false,createdAt:new Date().toISOString(),raw:'Model : SM-A576B/DS\\nS/N: R5GL80LDKFM',${extra}},'record:seed-${n}');`;
const text=expr=>run(`(()=>{try{return ${expr}}catch(e){return null}})()`);
const rows=()=>run(`document.querySelectorAll('.bulk-row').length`);
try{
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:860,deviceScaleFactor:2,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');${seed(1,'490154203237518','Valid','modelNeedsReview:true,serialNeedsReview:true,brandNeedsReview:true')}${seed(2,'','Review','serialNeedsReview:true')}${seed(3,'356938035643808','Invalid','')}tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);

  await waitFor(`[...document.querySelectorAll('button')].some(b=>/Review all \\(3\\)/.test(b.textContent))`,'Review all (3) button');
  await clickText('button','Review all');
  await waitFor(`!!document.querySelector('.bulk-review')`,'bulk list opens');
  assert.equal(await rows(),3,'three rows');
  assert.match(await text(`document.querySelector('.bulk-review h2').textContent`),/3 left to check/);
  await shot('1-list');
  ok('"Review all (3)" opens the list with 3 rows: "3 left to check"');

  // Accept the one that looks right, then undo
  assert.ok(await run(`[...document.querySelectorAll('.bulk-accept button')].some(b=>/Accept 1 that look right/.test(b.textContent))`),'accept button counts 1');
  await clickText('.bulk-accept button','Accept 1');
  await waitFor(`document.querySelectorAll('.bulk-row').length===2`,'accepted row leaves the list');
  assert.match(await text(`document.querySelector('.bulk-accept').textContent`),/Accepted 1/);
  await clickText('.bulk-accept button','Undo');
  await waitFor(`document.querySelectorAll('.bulk-row').length===3`,'undo brings it back');
  ok('Accept 1 that looks right removes it; Undo brings it back (only the valid-IMEI one qualified)');

  // Row 2: a half-typed IMEI shows the digit count; a full one can be ticked
  await typeInto('.bulk-row:nth-child(2) input[data-field="imei"]','35095');
  await waitFor(`/5 of 15 digits/.test(document.querySelector('.bulk-row:nth-child(2)').textContent)`,'digit count');
  await run(`document.querySelector('.bulk-row:nth-child(2) .bulk-done').click()`);
  await waitFor(`/15|digits/i.test(document.querySelector('.bulk-row:nth-child(2) .bulk-error')?.textContent||'')`,'tick refuses 5 digits');
  assert.equal(await rows(),3,'row stays when the IMEI is unfinished');
  await typeInto('.bulk-row:nth-child(2) input[data-field="imei"]','356938035643809');
  await run(`document.querySelector('.bulk-row:nth-child(2) .bulk-done').click()`);
  await waitFor(`document.querySelectorAll('.bulk-row').length===2`,'ticked row leaves');
  ok('A half-typed IMEI cannot be ticked ("5 of 15 digits"); a full one ticks and leaves the list');
  await shot('2-after-tick');

  // Row with a wrong checksum (now first or second): half-type, close, nothing is lost
  await typeInto('.bulk-row:last-child input[data-field="imei"]','3569380');
  await run(`document.querySelector('[aria-label="Close review"]').click()`);
  await waitFor(`!document.querySelector('.bulk-review')`,'list closes');
  await sleep(800);
  await clickText('button','Review all');
  await waitFor(`!!document.querySelector('.bulk-review')`,'list reopens');
  await waitFor(`/Unfinished IMEI 1 "3569380"/.test(document.querySelector('.bulk-review').textContent)`,'unfinished IMEI kept in the note');
  ok('Closing keeps a half-typed IMEI in the record note and it stays in the list for review');

  // Tapping the photo opens the full review on top of the list
  await run(`document.querySelector('.bulk-photo').click()`);
  await waitFor(`!!document.querySelector('.review-modal')`,'full review opens');
  const zs=await run(`(()=>{const b=document.querySelector('.bulk-review').closest('.modal-backdrop'),r=document.querySelector('.review-modal').closest('.modal-backdrop');return Boolean(b.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING);})()`);
  assert.ok(zs,'full review is drawn above the list');
  await shot('3-full-over-list');
  ok('Tapping the photo opens the full review above the list');
  console.log(`\nAll ${results.length} bulk-review checks passed.`);
}catch(error){console.error('FAIL:',error.message);try{console.log('DB-AFTER:',await run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const g=o.result.transaction('inventory').objectStore('inventory').getAll();g.onsuccess=()=>res(JSON.stringify(g.result.map(r=>[r.id,r.imei,r.status,r.modelNeedsReview,r.serialNeedsReview,r.brandNeedsReview,r.checked])));};})`),'| banner:',await run(`document.querySelector('.archive-banner')?.textContent`));}catch{}await shot('failure');process.exitCode=1;}
finally{try{ws.close();}catch{}proc.kill();server.close();}
