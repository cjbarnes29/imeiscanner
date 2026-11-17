// Real IndexedDB transactions and app storage failures, using a fresh browser profile and synthetic records only.
// Run after npm run build: node scripts/e2e-storage.mjs
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { build } from 'esbuild';

const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(browser, 'Edge or Chrome is installed');
const bundle = await build({ stdin: { contents: "export * from './src/retail/retail-store'; export * from './src/retail/data'; export * from './src/record-store';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', write: false });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/storage-api.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].contents); return; }
    const file = join('dist', req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file));
  } catch { res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'imei-storage-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, nextId = 0;
const waiting = new Map(), errors = [], results = [];
const ok = name => { results.push(name); console.log('PASS:', name); };
try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await sleep(100); } }
  assert.ok(port, 'browser started');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(pages.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); });
  const send = (method, params = {}) => new Promise((r, reject) => { const id = ++nextId; const t = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); waiting.set(id, m => { clearTimeout(t); m.error ? reject(new Error(JSON.stringify(m.error))) : r(m.result); }); ws.send(JSON.stringify({ id, method, params })); });
  const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; };
  const shot = async name => { if (!process.env.SHOTS) return; await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(join(process.env.SHOTS, `${name}.png`), Buffer.from(r.data, 'base64')); };
  const wait = async (expression, label) => { for (let n = 0; n < 120; n++) { if (await run(expression)) return; await sleep(100); } throw new Error(`Timed out: ${label}`); };
  const click = text => run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}));if(!b)throw new Error('missing button');b.click();return true;})()`);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:411,height:900,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate', { url: base }); await wait("document.readyState==='complete' && !!document.querySelector('.bottom-nav')", 'app');
  await sleep(700); // allow the app's initial save and ledger setup to finish before isolated storage tests
  await run("(async()=>{window.api=await import('/storage-api.js');return true;})()");
  const dbTests = await run(`(async()=>{
    const {saveRetail,loadRetail,listSnapshots,emptyState,saveInventory,loadInventory,saveOriginalSource}=api;
    const read=()=>new Promise((resolve,reject)=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const q=db.transaction('inventory').objectStore('inventory').getAllKeys();q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=()=>reject(q.error)};o.onerror=()=>reject(o.error)});
    const rows=[{id:'audit-record',sourcePictureId:'audit-source',model:'SM-A176B',personId:'audit-person',imei:''}];
    await loadInventory();await saveOriginalSource('audit-source',new Blob(['synthetic original']));await saveInventory(rows);
    let previous=emptyState();
    for(let i=0;i<12;i++){const next={...previous,settings:{...previous.settings,reportAuthor:'audit-'+i,lowStock:0}};await saveRetail(next,previous,'step-'+i);previous=next;}
    const snaps=await listSnapshots(), state=await loadRetail(), records=await loadInventory();
    const oldTx=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){const tx=oldTx.apply(this,args);if(args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
    let rejected=false;try{await saveRetail({...previous,settings:{...previous.settings,reportAuthor:'must-not-save'}},previous,'must-not-snapshot');}catch{rejected=true;}finally{IDBDatabase.prototype.transaction=oldTx;}
    const afterAbort=await loadRetail(), afterSnaps=await listSnapshots();
    const originalOpen=indexedDB.open.bind(indexedDB);indexedDB.open=function(){const request={error:new DOMException('audit denied','UnknownError')};queueMicrotask(()=>request.onerror?.());return request;};
    let loadRejected=false;try{await loadRetail();}catch{loadRejected=true;}finally{indexedDB.open=originalOpen;}
    let recordRejected=false;try{await saveInventory([{...rows[0],model:'must-not-save'},{id:'uncloneable',bad:()=>{}}]);}catch{recordRejected=true;}
    const afterBadRecord=await loadInventory();
    return {snapCount:snaps.length,numbers:snaps.map(s=>s.n),author:state.settings.reportAuthor,lowStock:state.settings.lowStock,records,rejected,afterAbort:afterAbort.settings.reportAuthor,afterSnapCount:afterSnaps.length,loadRejected,recordRejected,afterBadRecord,keys:await read()};
  })()`);
  assert.equal(dbTests.snapCount, 8); assert.deepEqual(dbTests.numbers, [12,11,10,9,8,7,6,5]);
  assert.equal(dbTests.author, 'audit-11'); assert.equal(dbTests.lowStock, 0);
  assert.equal(dbTests.records.length, 1); assert.equal(dbTests.records[0].id, 'audit-record'); assert.ok(dbTests.keys.includes('source:audit-source'));
  assert.equal(dbTests.rejected, true); assert.equal(dbTests.afterAbort, 'audit-11'); assert.equal(dbTests.afterSnapCount, 8); assert.equal(dbTests.loadRejected, true);
  assert.equal(dbTests.recordRejected,true);assert.equal(dbTests.afterBadRecord.length,1);assert.equal(dbTests.afterBadRecord[0].model,'SM-A176B','failed record saves cannot partially commit');
  ok('actual IndexedDB: round trip, eight newest snapshots, rollback on abort, load failure rejects, records and originals remain separate');
  await run('api.saveInventory([]).then(()=>true)');

  // Simulate the retail read alone failing; scan-record loading continues normally.
  const injection = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('imei-lens-simple-view','false');window.auditGet=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){if(key==='retail:state'){const r={error:new DOMException('audit read failure','UnknownError')};queueMicrotask(()=>r.onerror?.());return r;}return window.auditGet.call(this,key);};` });
  await send('Page.navigate', { url: base }); await wait("document.body.innerText.includes('Retail data could not be opened')", 'visible read failure');
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Got it'))?.click()");
  await shot('database-read-warning');
  assert.equal(await run("!!document.querySelector('.retail-hub')"), false, 'retail edits are unavailable while data cannot load');
  await run('IDBObjectStore.prototype.get=window.auditGet'); await click('Try retail storage again');
  await wait("!document.body.innerText.includes('Retail data could not be opened')", 'retail retry completed');
  await run("document.querySelector('.bottom-nav button').click()");
  await wait("!!document.querySelector('.retail-hub')", 'retail retry loads');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  ok('app read failure shows a persistent warning, prevents retail edits and recovers using Retry');

  // Fail only retail writes so the record saver cannot clear the retail warning.
  await run(`window.auditPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='retail:state')throw new DOMException('audit quota failure','QuotaExceededError');return window.auditPut.call(this,value,key);};document.querySelector('button[aria-label="More"]').click();`);
  await wait("!!document.querySelector('.more-list')",'More menu');await click('Settings & backup');
  await wait("!!document.querySelector('.settings-modal')",'Settings');await click('Backup, restore & history');
  await wait("!!document.querySelector('.retail-data')",'Backup');await click('Download a backup');
  await wait("document.body.innerText.includes('Retail changes could not be saved')", 'visible write failure');
  await shot('database-save-warning');
  await sleep(600);
  assert.equal(await run("document.body.innerText.includes('Retail changes could not be saved')"), true);
  await run('IDBObjectStore.prototype.put=window.auditPut'); await click('Try retail storage again');
  await wait("!document.body.innerText.includes('Retail changes could not be saved')", 'save retry');
  ok('app write failure stays visible independently of record saves, and Retry persists the latest state');
  await run(`new Promise((resolve,reject)=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');tx.objectStore('inventory').put({id:'audit-corrupt'},'record:audit-corrupt');tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)};})`);
  await send('Page.navigate',{url:base});
  await wait("document.body.innerText.includes('Saved scan records could not be read')",'corrupt record warning');
  await shot('database-recovery-warning');
  await sleep(700);
  assert.equal(await run(`new Promise(resolve=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const q=db.transaction('inventory').objectStore('inventory').get('record:audit-corrupt');q.onsuccess=()=>{db.close();resolve(q.result?.id==='audit-corrupt')};};})`),true,'bad stored records are retained for recovery');
  ok('damaged scan data shows a warning without crashing or overwriting stored records');
  assert.deepEqual(errors, [], 'no unhandled JavaScript errors');
} catch (error) {
  if (ws?.readyState === 1) {
    const id = ++nextId;
    const page = new Promise(r => waiting.set(id,r));
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:'document.body.innerText.slice(0,1800)',returnByValue:true}}));
    console.error('PAGE:',(await page).result?.result?.value);
  }
  throw error;
} finally {
  ws?.close(); proc.kill();
  const tag = profile.split(/[\\/]/).pop();
  spawnSync('powershell', ['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio:'ignore' });
  server.close();
}
console.log(`${results.length} storage audit groups passed`);
