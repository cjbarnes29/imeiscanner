// Background crop queue in headless Edge/Chrome (not part of `npm test`; run `npm run build` and `node scripts/make-composites.mjs` first).
//   node scripts/e2e-queue.mjs
// Seeds 3 photos (1, 2 and 4 products), opens Bulk crop, Queue all in background: the editor closes, a banner shows progress,
// originals are replaced by one record per product, flagged ones can be reviewed. Then: a saved queue is offered for resume after a reload.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const files=['p01-single','p02-pair','p04-stack'];
const photos=await Promise.all(files.map(async n=>'data:image/jpeg;base64,'+(await readFile(`test-photos/composite/${n}.jpg`)).toString('base64')));
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const f=join('dist',p==='/'?'index.html':p);const d=await readFile(f);res.writeHead(200,{'content-type':types[extname(f)]||'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}}).listen(4197);
const profile=await mkdtemp(join(tmpdir(),'imei-queue-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9353',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9353/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.consoleAPICalled'&&['warning','error'].includes(m.params.type)&&process.env.E2E_LOG)console.log('console.'+m.params.type,m.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,300));if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(300);}throw new Error('Timed out: '+label);};
const clickText=(sel,text)=>run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const rowsOf=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const rows=g.result.map(r=>({id:r.id,imei:r.imei,review:!!r.cropNeedsReview,name:r.name}));db.close();res(rows);};};})`);
const ok=n=>console.log('PASS:',n);
const seedRecords=()=>run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');const st=tx.objectStore('inventory');const P=${JSON.stringify(photos)};P.forEach((p,i)=>st.put({id:'seed-'+i,pictureId:'PIC-SEED'+i,sourcePictureId:'PIC-SEED'+i,number:3+i,personId:'',name:'photo-'+i+'.jpg',dataUrl:p,originalDataUrl:p,model:'Unknown unit — review',imei:'',status:'Review',cropNeedsReview:true,deviceCount:2,duplicate:false,createdAt:new Date().toISOString(),raw:''},'record:seed-'+i));tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
try{
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  await send('Page.navigate',{url:'http://localhost:4197/'});await waitFor(`document.readyState==='complete'`,'load');
  await seedRecords();
  await send('Page.navigate',{url:'http://localhost:4197/'});await waitFor(`document.readyState==='complete'`,'reload');await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/^Bulk crop/.test(b.textContent.trim())&&!b.disabled)`,'Bulk crop');
  await clickText('button','Bulk crop');
  await waitFor(`!!document.querySelector('.studio')`,'studio');
  assert.ok(await run(`[...document.querySelectorAll('.studio-actions button')].some(b=>/Queue all in background \\(3\\)/.test(b.textContent))`),'queue-all button names the 3 photos');
  ok('Bulk crop offers "Queue all in background (3)"');
  const t0=Date.now();
  await clickText('.studio-actions button','Queue all in background');
  await waitFor(`!document.querySelector('.studio')`,'studio closes');
  await waitFor(`!!document.querySelector('.queue-banner')`,'banner');
  ok(`editor closed at once (${Date.now()-t0} ms); banner: ${(await run(`document.querySelector('.queue-banner').innerText`)).replace(/\n/g,' ').slice(0,110)}`);
  // the page stays usable while the queue runs
  assert.ok(await run(`document.querySelector('.queue-banner button')!==null`),'pause/cancel buttons');
  await waitFor(`/Background cropping finished/.test(document.querySelector('.queue-banner')?.innerText||'')`,'queue finished',900000);
  await sleep(3500);
  const rows=await rowsOf();
  assert.ok(!rows.some(r=>r.id==='seed-1'||r.id==='seed-2'),'the pair and the 4-box photo were replaced');
  assert.ok(rows.some(r=>r.id==='seed-0'),'the single-product photo is left as it is');
  assert.ok(rows.length>=6,'one record per product (got '+rows.length+')');
  ok(`finished: ${rows.length} records from 3 photos, single photo kept, ${rows.filter(r=>r.imei).length} with an IMEI 1, ${rows.filter(r=>r.review).length} flagged`);
  const bannerText=await run(`document.querySelector('.queue-banner').innerText.replace(/\\n/g,' ')`);
  if(/Review \d+/.test(bannerText)){await clickText('.queue-banner button','Review');await waitFor(`!!document.querySelector('.review-modal')`,'review opens');ok('Review opens the flagged results: '+bannerText.slice(0,90));await run(`document.querySelector('.review-modal [aria-label="Close photo review"]').click()`);}
  // resume after a restart: a saved queue is offered, not started silently
  const ids=(await rowsOf()).slice(0,1).map(r=>r.id);
  await run(`localStorage.setItem('imei-lens-crop-queue-v1',JSON.stringify({version:1,items:${JSON.stringify(ids.map(i=>({recordId:i,boxes:[],auto:true})))}}))`);
  await send('Page.navigate',{url:'http://localhost:4197/'});await waitFor(`document.readyState==='complete'`,'reload 2');
  await waitFor(`/Photos waiting from last time/.test(document.querySelector('.queue-banner')?.innerText||'')`,'resume banner');
  ok('after a restart the waiting queue is offered (paused) with Resume / Discard');
  await clickText('.queue-banner button','Discard');
  await waitFor(`!document.querySelector('.queue-banner')&&!localStorage.getItem('imei-lens-crop-queue-v1')`,'discarded');
  ok('Discard clears the saved queue');
  console.log('\nAll queue checks passed.');
}catch(e){console.error('FAIL:',e.message);process.exitCode=1;}finally{try{ws.close();}catch{}proc.kill();server.close();}
