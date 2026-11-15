// Background crop queue in headless Edge/Chrome (not part of `npm test`; run `npm run build` and `node scripts/make-composites.mjs` first).
//   node scripts/e2e-queue.mjs
// 1. Bulk crop with 4 photos: the single Save all closes the editor at once and cuts all 4 in the background (no boxes drawn = cut automatically).
// 2. The queue runs while the page stays usable.
// 3. Queue panel: Queued / Processing / Needs review / Completed counts (Process later only shows for older queues); Needs review lists ONLY affected photos
//    (with the reason); Retry, Approve, Select for export.
// 4. Settings apply to queued jobs: the same photo with Scan speed Fast vs Standard (Fast skips the extra passes).
// 5. Interrupted processing: reload while a photo is being read; the queue is offered again with that photo waiting.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const load=async n=>'data:image/jpeg;base64,'+(await readFile(`test-photos/composite/${n}.jpg`)).toString('base64');
const photos=await Promise.all(['p01-single','p02-pair','p04-stack','d-softblur-p02'].map(load));
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const f=join('dist',p==='/'?'index.html':p);const d=await readFile(f);res.writeHead(200,{'content-type':types[extname(f)]||'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}}).listen(4197);
const profile=await mkdtemp(join(tmpdir(),'imei-queue-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9353',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9353/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.consoleAPICalled'&&['error'].includes(m.params.type)&&process.env.E2E_LOG)console.log('console.'+m.params.type,m.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,300));if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(300);}throw new Error('Timed out: '+label);};
const clickText=(sel,text)=>run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const rowsOf=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const rows=g.result.map(r=>({id:r.id,imei:r.imei,review:!!r.cropNeedsReview,name:r.name}));db.close();res(rows);};};})`);
// Save all, after the editor's automatic search for labels on a photo with no boxes has finished (it blocks the button while it runs).
const saveAllNow=async()=>{await waitFor(`!/Looking for labels/.test(document.querySelector('.studio-message')?.textContent||'')&&!document.querySelector('.studio-tools .spin')`,'auto search done',120000);return clickText('.studio-actions button','Save all');};
const banner=()=>run(`(document.querySelector('.queue-banner')?.innerText||'').replace(/\\n/g,' ')`);
const tabCounts=()=>run(`Object.fromEntries([...document.querySelectorAll('.queue-tabs button')].map(b=>[b.childNodes[0].textContent.trim(),Number(b.querySelector('b').textContent)]))`);
const ok=n=>console.log('PASS:',n);
const seed=(list,extra='')=>run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');const st=tx.objectStore('inventory');const P=${JSON.stringify(list)};P.forEach((p,i)=>st.put({id:'seed-'+i,pictureId:'PIC-SEED'+i,sourcePictureId:'PIC-SEED'+i,number:3+i,personId:'',name:'photo-'+i+'.jpg',dataUrl:p,originalDataUrl:p,model:'Unknown unit — review',imei:'',status:'Review',cropNeedsReview:true,deviceCount:2,duplicate:false,createdAt:new Date().toISOString(),raw:''},'record:seed-'+i));tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
const fresh=async(settings='')=>{await send('Page.navigate',{url:'http://localhost:4197/'});await waitFor(`document.readyState==='complete'`,'load');await run(`new Promise(r=>{const q=indexedDB.deleteDatabase('imei-lens-v2');q.onsuccess=q.onerror=q.onblocked=()=>r(true);})`);await run(`localStorage.clear();localStorage.setItem('imei-lens-simple-view','false');${settings}`);};
const open=async()=>{await send('Page.navigate',{url:'http://localhost:4197/'});await waitFor(`document.readyState==='complete'`,'reload');await sleep(1500);await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);};
try{
  await send('Page.enable');await send('Runtime.enable');
  // ONLY=crash runs just the last check (quick).
  if(process.env.ONLY!=='crash'){
  // ---------- 1. Bulk crop: one Save all queues every photo ----------
  await fresh();await seed(photos);await open();
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/^Bulk crop/.test(b.textContent.trim())&&!b.disabled)`,'Bulk crop');
  await clickText('button','Bulk crop');await waitFor(`!!document.querySelector('.studio')`,'studio');
  assert.match(await run(`document.querySelector('.studio-title').innerText`),/Photo 1 of 4/);
  // the editor opens on photo 1 and searches it by itself; wait for that so the next step is not blocked
  await waitFor(`!/Looking for labels/.test(document.querySelector('.studio-message')?.textContent||'')&&!document.querySelector('.studio-tools .spin')`,'auto search done',120000);
  assert.ok(await run(`[...document.querySelectorAll('.studio-actions button')].length===1`),'the footer has a single button');
  ok('the editor footer has one button (Save all)');
  const t0=Date.now();await saveAllNow();
  await waitFor(`!document.querySelector('.studio')`,'studio closes');
  ok(`Save all (4 photos) closes the editor at once (${Date.now()-t0} ms); banner: ${(await banner()).slice(0,120)}`);
  // the page answers while the queue runs: a timer must keep firing
  const ticks=await run(`new Promise(r=>{let n=0;const t=setInterval(()=>n++,100);setTimeout(()=>{clearInterval(t);r(n)},3000);})`);
  ok(`page stays responsive while the queue reads (${ticks} of ~30 timer ticks in 3 s)`);
  // ---------- 2. all four photos are read ----------
  await waitFor(`/finished/.test(document.querySelector('.queue-banner')?.innerText||'')`,'all photos done',900000);
  let rows=await rowsOf();
  ok('the 4 photos were read in the background: '+(await banner()).slice(0,100));
  // ---------- 3. panel ----------
  await clickText('.queue-banner button','Queue');await waitFor(`!!document.querySelector('.queue-panel')`,'panel');
  let tabs=await tabCounts();ok('queue panel tabs: '+JSON.stringify(tabs));
  assert.equal(tabs['Queued'],0);assert.ok(!('Process later' in tabs),'no Process later tab when nothing is set aside');assert.ok(tabs['Completed']+tabs['Needs review']>=3,'the finished photos are Completed or Needs review');
  await clickText('.queue-tabs button','Needs review');await sleep(300);
  const reviewRows=await run(`[...document.querySelectorAll('.queue-list .queue-row')].map(r=>r.innerText.replace(/\\n/g,' | '))`);
  assert.ok(reviewRows.every(t=>/need a look|label|could not|No separate|Found/i.test(t)),'only affected photos with a reason: '+reviewRows);
  ok(`Needs review shows only affected photos (${reviewRows.length}): `+reviewRows.map(t=>t.slice(0,80)).join(' || '));
  const failedRow=await run(`[...document.querySelectorAll('.queue-list .queue-row')].findIndex(r=>[...r.querySelectorAll('button')].some(b=>b.textContent==='Retry'))`);
  if(failedRow>=0){
    await run(`[...document.querySelectorAll('.queue-list .queue-row')][${failedRow}].querySelector('button').click()`);
    await waitFor(`/tried 2 times/.test(document.querySelector('.queue-list')?.innerText||'')`,'retried and failed again',300000);
    ok('Retry reads the photo again; still not separable, it returns to Needs review ("tried 2 times")');
  }
  const approveIdx=await run(`[...document.querySelectorAll('.queue-list .queue-row')].findIndex(r=>[...r.querySelectorAll('button')].some(b=>b.textContent==='Approve'))`);
  if(approveIdx>=0){
    const before=await tabCounts();
    await run(`[...[...document.querySelectorAll('.queue-list .queue-row')][${approveIdx}].querySelectorAll('button')].find(b=>b.textContent==='Approve').click()`);
    await waitFor(`Number([...document.querySelectorAll('.queue-tabs button')].find(b=>/Completed/.test(b.textContent)).querySelector('b').textContent)===${before['Completed']+1}`,'approved moves to completed');
    ok('Approve moves a photo from Needs review to Completed');
  }
  await clickText('.queue-tabs button','Completed');await sleep(200);
  await clickText('.queue-list button','Select');
  await waitFor(`!document.querySelector('.queue-panel')`,'panel closed after select');
  ok('Completed: "Select N records for export" selects them for Export');
  // ---------- 4. settings apply to queued jobs ----------
  const timing={};
  for(const [speed,photo] of [['fast',2],['standard',2],['fast-blurry',3],['standard-blurry',3]]){
    await fresh(`localStorage.setItem('imei-lens-scan-speed','${speed.split('-')[0]}');`);await seed([photos[photo]]);await open();
    await clickText('button','Bulk crop');await waitFor(`!!document.querySelector('.studio')`,'studio');
    const s=Date.now();await saveAllNow();
    await waitFor(`/finished/.test(document.querySelector('.queue-banner')?.innerText||'')`,'done '+speed,600000);
    await sleep(2500);rows=await rowsOf();
    timing[speed]={seconds:Math.round((Date.now()-s)/1000),records:rows.length,imeis:rows.filter(r=>r.imei).length};
  }
  ok('Scan speed applies to queued photos (clean 4-product photo, then a blurry pair): '+JSON.stringify(timing));
  // Evidence that the setting reaches queued jobs: on the blurry photo Standard's extra passes read more than Fast's single pass.
  // (Time is about the same in both: in this test it is spent mostly starting the reader and finding the labels, which both modes do.)
  assert.ok(timing['standard-blurry'].imeis>timing['fast-blurry'].imeis,'Standard (extra passes) reads more on a blurry photo than Fast (one pass)');
  // Products in each photo applies too: 5 expected on a 4-product photo -> every crop is flagged "Found 4 of 5" -> Needs review -> Approve.
  await fresh(`localStorage.setItem('imei-lens-expected-products','5');`);await seed([photos[2]]);await open();
  await clickText('button','Bulk crop');await waitFor(`!!document.querySelector('.studio')`,'studio');
  await saveAllNow();
  await waitFor(`/need review/.test(document.querySelector('.queue-banner')?.innerText||'')&&!/waiting · /.test(document.querySelector('.queue-banner')?.innerText.replace('0 waiting','')||'')`,'expected-5 run done',600000);
  await clickText('.queue-banner button','Queue');await waitFor(`!!document.querySelector('.queue-panel')`,'panel');
  await clickText('.queue-tabs button','Needs review');await sleep(300);
  const note=await run(`document.querySelector('.queue-list .queue-row')?.innerText.replace(/\\n/g,' | ')||''`);
  assert.match(note,/Found 4 of 5/,'the expected count is reported: '+note);
  ok('Products in each photo applies to queued photos: '+note.slice(0,110));
  await run(`[...document.querySelectorAll('.queue-list button')].find(b=>b.textContent==='Approve').click()`);
  await waitFor(`Number([...document.querySelectorAll('.queue-tabs button')].find(b=>/Needs review/.test(b.textContent)).querySelector('b').textContent)===0&&Number([...document.querySelectorAll('.queue-tabs button')].find(b=>/Completed/.test(b.textContent)).querySelector('b').textContent)===1`,'approved');
  rows=await rowsOf();await sleep(2000);rows=await rowsOf();
  assert.ok(rows.every(r=>!r.review),'approving clears the review flags on its records');
  ok('Approve moves the photo to Completed and clears its review flags');
  await run(`document.querySelector('.queue-panel [aria-label="Close"]').click()`);
  // ---------- 5. interrupted processing ----------
  await fresh();await seed([photos[2]]);await open();
  await clickText('button','Bulk crop');await waitFor(`!!document.querySelector('.studio')`,'studio');
  await saveAllNow();
  await waitFor(`/Cropping in the background/.test(document.querySelector('.queue-banner')?.innerText||'')`,'running');
  await sleep(1500);
  await open();
  await waitFor(`/Photos waiting from last time/.test(document.querySelector('.queue-banner')?.innerText||'')`,'resume offer after interruption');
  assert.match(await banner(),/1 waiting/);
  ok('reload while a photo was being read: the queue is offered again with that photo waiting ('+(await banner()).slice(0,70)+')');
  await clickText('.queue-banner button','Discard');
  await waitFor(`!localStorage.getItem('imei-lens-crop-queue-v1')`,'discarded');
  ok('Discard clears the saved queue');
  }
  // Killed right after a photo finished: the photo is either replaced (its crops stored) or still waiting in the saved queue,
  // never "original kept but gone from the queue".
  for(let attempt=0;attempt<3;attempt++){
    await fresh();await seed([photos[1]]);await open();
    await clickText('button','Bulk crop');await waitFor(`!!document.querySelector('.studio')`,'studio');
    await saveAllNow();
    await waitFor(`/1 of 1 done|cropping finished/.test(document.querySelector('.queue-banner')?.innerText||'')`,'photo finished',600000);
    await open(); // leave at once, like the app being killed
    await sleep(500);
    const state=await run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const ids=g.result.map(r=>r.id);db.close();res({original:ids.includes('seed-0'),records:ids.length,queued:(localStorage.getItem('imei-lens-crop-queue-v1')||'').includes('seed-0')});};};})`);
    assert.ok(!state.original||state.queued,'original kept but missing from the queue: '+JSON.stringify(state));
    ok(`left at once after the photo finished (try ${attempt+1}): ${state.original?'original still there and still queued':'crops stored, queue entry gone'} (${state.records} records)`);
  }
  console.log('\nAll queue checks passed.');
}catch(e){console.error('FAIL:',e.message);process.exitCode=1;}finally{try{ws.close();}catch{}proc.kill();server.close();}
