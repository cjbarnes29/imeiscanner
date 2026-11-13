// Crop Studio end to end in headless Edge/Chrome (not part of `npm test`; run `npm run build` first).
//   node scripts/e2e-studio.mjs
// Seeds one record with a two-product photo, then: draw 2 boxes (count is automatic), Save for later, reload,
// Resume, exit prompt, Save all, read the crops, replace the original, and check the stored records.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const name=(await readdir('test-photos')).find(f=>/^multi-02\.jpg$/.test(f));
if(!name)throw new Error('test-photos/multi-02.jpg is missing');
const photo='data:image/jpeg;base64,'+(await readFile('test-photos/'+name)).toString('base64');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4194);
const profile=await mkdtemp(join(tmpdir(),'imei-studio-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9350',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9350/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(250);}throw new Error('Timed out waiting for: '+label);};
const clickText=(selector,text)=>run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const mouse=async(type,x,y,buttons)=>send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:buttons??(type==='mouseReleased'?0:1),clickCount:1});
const drag=async(x0,y0,x1,y1)=>{await mouse('mouseMoved',x0,y0,0);await mouse('mousePressed',x0,y0);for(let i=1;i<=6;i++)await mouse('mouseMoved',x0+(x1-x0)*i/6,y0+(y1-y0)*i/6);await mouse('mouseReleased',x1,y1);};
const imgRect=()=>run(`(()=>{const r=document.querySelector('.studio-viewport img').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
const readDb=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const rows=g.result.map(r=>({id:r.id,hasData:String(r.dataUrl).startsWith('data:image'),dataLen:String(r.dataUrl).length,hasOriginal:!!r.originalDataUrl,sourceId:r.sourcePictureId,crop:!!r.cropDataUrl,imei:r.imei,model:r.model,person:r.personId}));db.close();res(rows);};};})`);
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
try{
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  await send('Page.navigate',{url:'http://localhost:4194/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');tx.objectStore('inventory').put({id:'seed-1',pictureId:'PIC-SEED1',sourcePictureId:'PIC-SEED1',number:3,personId:'',name:'two-products.jpg',dataUrl:${JSON.stringify(photo)},originalDataUrl:${JSON.stringify(photo)},model:'SM-A165F',imei:'',status:'Review',duplicate:false,createdAt:new Date().toISOString(),raw:''},'record:seed-1');tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4194/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/^Bulk crop/.test(b.textContent.trim())&&!b.disabled)`,'Bulk crop button');
  await clickText('button','Bulk crop');
  await waitFor(`!!document.querySelector('.studio-viewport img')&&document.querySelector('.studio-viewport img').getBoundingClientRect().width>50`,'studio photo');
  assert.ok(!/How many/i.test(await run(`document.querySelector('.studio').textContent`)),'no "how many labels" question');
  ok('Crop Studio opens with no label-count question');

  const r=await imgRect();
  await drag(r.x+r.w*0.08,r.y+r.h*0.06,r.x+r.w*0.92,r.y+r.h*0.46);
  await waitFor(`/1 label/.test(document.querySelector('.studio-title').textContent)`,'1 label');
  await drag(r.x+r.w*0.08,r.y+r.h*0.54,r.x+r.w*0.92,r.y+r.h*0.94);
  await waitFor(`/2 labels/.test(document.querySelector('.studio-title').textContent)`,'2 labels');
  ok('count is automatic: drawing 2 boxes shows "2 labels"');

  await clickText('button','Save for later');
  await waitFor(`!document.querySelector('.studio')`,'studio closed');
  assert.ok(await run(`JSON.parse(localStorage.getItem('imei-lens-crop-draft-v1')||'{}').items?.[0]?.boxes?.length===2`),'draft with 2 boxes stored');
  ok('Save for later stores the 2 boxes on the device');
  await send('Page.navigate',{url:'http://localhost:4194/'});
  await waitFor(`document.readyState==='complete'`,'reload 2');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Resume')`,'Resume banner');
  ok('after a reload the app offers Resume');
  await clickText('button','Resume');
  await waitFor(`!!document.querySelector('.studio')&&/2 labels/.test(document.querySelector('.studio-title').textContent)`,'draft restored');
  ok('Resume restores the 2 boxes');

  // an unsaved change (a third box) makes the exit prompt appear
  const r2=await imgRect();
  await drag(r2.x+r2.w*0.25,r2.y+r2.h*0.47,r2.x+r2.w*0.75,r2.y+r2.h*0.53);
  await waitFor(`/3 labels/.test(document.querySelector('.studio-title').textContent)`,'3 labels');
  ok('a third box counts as 3 labels');
  await run(`document.querySelector('.studio [aria-label="Close"]').click()`);
  await waitFor(`!!document.querySelector('.studio-confirm')`,'exit prompt');
  const exitButtons=await run(`[...document.querySelectorAll('.studio-confirm button')].map(b=>b.textContent.trim())`);
  assert.ok(exitButtons.includes('Save for later')&&exitButtons.includes('Discard')&&exitButtons.includes('Continue editing'),'exit prompt: '+exitButtons);
  ok('closing with boxes asks Save for later / Discard / Continue editing');
  await clickText('.studio-confirm button','Continue editing');
  await waitFor(`!document.querySelector('.studio-confirm')&&!!document.querySelector('.studio')`,'continue editing');
  await clickText('button','Undo');
  await waitFor(`/2 labels/.test(document.querySelector('.studio-title').textContent)`,'undo to 2');
  ok('Undo removes the third box (back to 2 labels)');
  await clickText('button','Redo');
  await waitFor(`/3 labels/.test(document.querySelector('.studio-title').textContent)`,'redo to 3');
  await clickText('button','Undo');
  await waitFor(`/2 labels/.test(document.querySelector('.studio-title').textContent)`,'undo again to 2');
  ok('Redo brings the third box back; Undo removes it again');

  await clickText('.studio-actions button','Save all');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/^Save \\d+ pictures? and archive/.test(b.textContent.trim()))`,'check screen',180000);
  ok('Save all reads both boxes and shows a check screen');
  await clickText('button','and archive');
  await waitFor(`!document.querySelector('.studio-backdrop')`,'applied',60000);
  await sleep(1500);
  const rows=await readDb();
  assert.equal(rows.length,2,'two records: '+JSON.stringify(rows));
  assert.ok(!rows.some(x=>x.id==='seed-1'),'original record is gone');
  assert.ok(rows.every(x=>x.hasData&&x.crop&&!x.hasOriginal),'each crop keeps only its own picture');
  assert.ok(rows.every(x=>x.dataLen<photo.length*0.8),'the full photo is not copied into the crops');
  assert.ok(rows.every(x=>x.person===''),'the person is kept');
  assert.equal(await run(`!localStorage.getItem('imei-lens-crop-draft-v1')`),true,'draft cleared after saving');
  ok('Save and archive original: 2 records, each with its own crop only, person kept, draft cleared');
  console.log('   IMEIs read from the 2 crops:',rows.map(x=>x.imei).filter(Boolean).join(', ')||'(none)','| models:',rows.map(x=>x.model).join(', '));
}catch(error){
  console.error('FAIL:',error.message);
  try{console.error('PAGE:',String(await run('document.body.innerText.slice(0,400)')).split(String.fromCharCode(10)).join(' | '));}catch{}
  process.exitCode=1;
}finally{ws.close();proc.kill();server.close();}
console.log(`${results.length} checks passed`);
