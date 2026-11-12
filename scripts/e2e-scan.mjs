// Runs the real in-browser scan (Tesseract + barcodes + product splitting) on photos in test-photos and reports what was found.
// Not part of `npm test` (needs a browser, `npm run build` first, and takes a while).
//   node scripts/e2e-scan.mjs 02 04 09        (photo numbers from test-photos/multi-NN.jpg; default: 02 04 09)
import {readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname,resolve} from 'node:path';

const picks=process.argv.slice(2).length?process.argv.slice(2):['02','04','09'];
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4192);
const profile=await mkdtemp(join(tmpdir(),'imei-scan-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9335',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9335/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
// OFFLINE=1: every request that is not to the local test server fails, as with no internet; the blocked requests are listed at the end.
const blocked=new Set();
if(process.env.OFFLINE)ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method!=='Fetch.requestPaused')return;const u=new URL(m.params.request.url);const local=u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:';if(local)send('Fetch.continueRequest',{requestId:m.params.requestId});else{blocked.add(u.origin+u.pathname.slice(0,60));send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'InternetDisconnected'});}});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(500);}throw new Error('Timed out waiting for: '+label);};
const luhn=s=>{if(!/^\d{15}$/.test(s))return false;let t=0;for(let i=0;i<15;i++){let d=+s[14-i];if(i%2){d*=2;if(d>9)d-=9;}t+=d;}return t%10===0;};
const rowsOf=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const rows=g.result.map(r=>({imei:r.imei,imei2:r.imei2||'',serial:r.serial||'',model:r.model,review:!!r.cropNeedsReview,status:r.status,crop:!!r.cropDataUrl,raw:r.raw||'',deviceCount:r.deviceCount}));db.close();res(rows);};};o.onerror=()=>res([]);})`);

const summary=[];
try{
  await send('Page.enable');await send('DOM.enable');
  if(process.env.OFFLINE){await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});console.log('OFFLINE mode: requests outside localhost are blocked');}
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  for(const n of picks){
    const file=resolve('test-photos',`multi-${n}.jpg`);
    if(!existsSync(file)){console.log('skip (missing):',file);continue;}
    await send('Page.navigate',{url:'http://localhost:4192/'});
    await waitFor(`document.readyState==='complete'`,'load');
    await run(`new Promise(r=>{const q=indexedDB.deleteDatabase('imei-lens-v2');q.onsuccess=q.onerror=q.onblocked=()=>r(true);})`);
    await send('Page.navigate',{url:'http://localhost:4192/'});
    await waitFor(`document.readyState==='complete'`,'reload');
    await sleep(1500);
    await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
    await waitFor(`!!document.querySelector('input[type=file][accept="image/*"]')`,'file input');
    const doc=await send('DOM.getDocument');
    const node=await send('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'input[type=file][accept="image/*"]'});
    await send('DOM.setFileInputFiles',{nodeId:node.result.nodeId,files:[file]});
    await waitFor(`/photo\\(s\\) ready/.test(document.body.innerText)`,'queued');
    const started=Date.now();
    await run(`[...document.querySelectorAll('button')].find(b=>/Extract IMEI from|Scan 1 photo/.test(b.textContent)).click()`);
    await waitFor(`/Finished scanning|Scanning failed|could not be read/.test(document.body.innerText)`,'scan finished',420000);
    const seconds=Math.round((Date.now()-started)/1000);
    await sleep(1500);
    const rows=await rowsOf();
    const imeis=rows.map(r=>r.imei).filter(Boolean);
    const valid=imeis.filter(luhn);
    console.log(`multi-${n}: ${seconds}s · ${rows.length} record(s) · IMEI 1 read: ${imeis.length} (valid ${valid.length}) · with IMEI 2: ${rows.filter(r=>r.imei2).length} · serial: ${rows.filter(r=>r.serial).length} · needs review: ${rows.filter(r=>r.review||r.status!=='Valid').length}`);
    for(const r of rows){console.log('   ',r.imei||'(no IMEI)',r.imei2||'-',r.serial||'-',r.model,r.review?'[review]':'',r.deviceCount?'[deviceCount '+r.deviceCount+']':'');if(process.env.E2E_RAW)console.log('      RAW:',String(r.raw).split(String.fromCharCode(10)).join(' / ').slice(0,900));}
    const pairs=rows.filter(r=>r.imei&&r.imei2&&r.imei!==r.imei2);
    const agree=pairs.filter(r=>r.imei.slice(-6)===r.imei2.slice(-6)).length;
    summary.push({n,seconds,rows:rows.length,valid:valid.length,pairs:pairs.length,agree,review:rows.filter(r=>r.review||r.status!=='Valid').length});
  }
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
finally{ws.close();proc.kill();server.close();}
const sum=k=>summary.reduce((t,x)=>t+(x[k]||0),0);
if(summary.length)console.log(`TOTAL over ${summary.length} photos: ${sum('rows')} records · ${sum('valid')} with a valid IMEI 1 · IMEI 1/IMEI 2 pairs read: ${sum('pairs')}, of which ${sum('agree')} agree on the last 6 digits (the Samsung label pattern) · flagged for review: ${sum('review')} · scan time ${summary.map(x=>x.seconds).join('s, ')}s (desktop browser, headless)`);
if(process.env.OFFLINE)console.log(blocked.size?'Blocked external requests ('+blocked.size+'): '+[...blocked].join(', '):'No external requests were attempted.');
console.log('done',JSON.stringify(summary));
