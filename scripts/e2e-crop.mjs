// End-to-end check of the crop flow in headless Edge/Chrome (not part of `npm test`: it needs a browser and `npm run build` first).
//   node scripts/e2e-crop.mjs [path-to-browser]
// Seeds one record with a two-product photo, then drives the real UI through the DevTools protocol:
// draw boxes (count is automatic), move/edit/delete a box, process, save, original removed, Save for later, recovery.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';

const browser=process.argv[2]||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found; pass the path as an argument.');
const photoName=(await readdir('test-photos')).find(f=>/^multi-0[2-3]\.jpg$/.test(f))||(await readdir('test-photos')).find(f=>/\.jpe?g$/.test(f));
const photo='data:image/jpeg;base64,'+(await readFile('test-photos/'+photoName)).toString('base64');

// static server for dist/
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4191);

const profile=await mkdtemp(join(tmpdir(),'imei-e2e-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9334',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9334/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
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
const editorRect=()=>run(`(()=>{const r=document.querySelector('.crop-editor img').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
const readDb=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const rows=g.result.map(r=>({id:r.id,hasData:String(r.dataUrl).startsWith('data:image'),dataLen:String(r.dataUrl).length,hasOriginal:!!r.originalDataUrl,sourceId:r.sourcePictureId,crop:!!r.cropDataUrl,imei:r.imei}));db.close();res(rows);};};})`);

const results=[];const ok=(name)=>{results.push(name);console.log('PASS:',name);};
try{
  await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  await send('Page.navigate',{url:'http://localhost:4191/'});
  await waitFor(`document.readyState==='complete'`,'page load');
  // seed one record, then reload so the app loads it
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');tx.objectStore('inventory').put({id:'seed-1',pictureId:'PIC-SEED1',sourcePictureId:'PIC-SEED1',number:3,personId:'',name:'two-products.jpg',dataUrl:${JSON.stringify(photo)},originalDataUrl:${JSON.stringify(photo)},model:'SM-A165F',imei:'',status:'Review',duplicate:false,createdAt:new Date().toISOString(),raw:''},'record:seed-1');tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4191/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/Got it/.test(b.textContent))`,'welcome dialog');
  await clickText('button','Got it');
  ok('welcome dialog shows on first launch and closes');

  await waitFor(`!!document.querySelector('.photo-cell')`,'record row');
  await run(`document.querySelector('.photo-cell').click()`);
  await waitFor(`!!document.querySelector('#crop-editor-panel')`,'review window');
  await run(`document.querySelector('#crop-editor-panel summary').click()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Start cropping')`,'Start cropping');
  assert.equal(await run(`!document.querySelector('#review-crop-count')`),true,'no manual count input');
  ok('crop starts without asking how many labels');
  await clickText('button','Start cropping');
  await waitFor(`document.querySelector('.crop-editor img')&&document.querySelector('.crop-editor img').getBoundingClientRect().width>50`,'crop image');

  // draw box 1 (upper half), add; box 2 (lower half), add
  let r=await editorRect();
  await drag(r.x+r.w*0.08,r.y+r.h*0.06,r.x+r.w*0.92,r.y+r.h*0.46);
  assert.equal(await clickText('button','Add box 1'),true);
  await waitFor(`!!document.querySelector('.box-chips')`,'box chips');
  await sleep(200);r=await editorRect();
  await drag(r.x+r.w*0.08,r.y+r.h*0.54,r.x+r.w*0.92,r.y+r.h*0.94);
  assert.equal(await clickText('button','Add box 2'),true);
  await waitFor(`/2 boxes = 2 products/.test(document.querySelector('.box-chips').textContent)`,'count of 2');
  ok('count is automatic: 2 boxes drawn = 2 products');
  if(process.env.E2E_SHOTS){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.E2E_SHOTS,'crop.png'),Buffer.from(shot.result.data,'base64'));}

  // move: take box 2 back to the selection, drag it inside, resize with a corner, add again
  await run(`[...document.querySelectorAll('.box-chip button')].find(b=>b.getAttribute('aria-label')==='Move or resize box 2').click()`);
  await waitFor(`/1 box = 1 product/.test(document.querySelector('.box-chips').textContent)`,'box 2 taken back');
  await sleep(200);
  const before=await run(`(()=>{const s=document.querySelector('.crop-selection');return {left:parseFloat(s.style.left),top:parseFloat(s.style.top),w:parseFloat(s.style.width),h:parseFloat(s.style.height)};})()`);
  r=await editorRect();
  const cx=r.x+r.w*(before.left+before.w/2)/100,cy=r.y+r.h*(before.top+before.h/2)/100;
  await drag(cx,cy,cx,cy-r.h*0.02);
  const after=await run(`(()=>{const s=document.querySelector('.crop-selection');return {left:parseFloat(s.style.left),top:parseFloat(s.style.top),w:parseFloat(s.style.width),h:parseFloat(s.style.height)};})()`);
  const scrolls=await run("JSON.stringify([...document.querySelectorAll('.modal')].map(m=>m.scrollTop))");
  assert.ok(after.top<before.top-0.5,`box moved up (top ${before.top} -> ${after.top}); editor ${JSON.stringify(r)} click ${cx},${cy} selection ${JSON.stringify(before)} scroll ${scrolls}`);
  assert.ok(Math.abs(after.w-before.w)<0.01&&Math.abs(after.h-before.h)<0.01,'moving keeps the size');
  ok('dragging inside a box moves it without resizing');
  const corner=await run(`(()=>{const h=document.querySelector('.crop-handle.se').getBoundingClientRect();return {x:h.x+h.width/2,y:h.y+h.height/2};})()`);
  await drag(corner.x,corner.y,corner.x-r.w*0.04,corner.y-r.h*0.03);
  const resized=await run(`(()=>{const s=document.querySelector('.crop-selection');return {w:parseFloat(s.style.width),h:parseFloat(s.style.height)};})()`);
  assert.ok(resized.w<after.w-0.5&&resized.h<after.h-0.5,'corner drag resizes');
  ok('dragging a corner resizes a box');
  assert.equal(await clickText('button','Add box 2'),true);
  await waitFor(`/2 boxes = 2 products/.test(document.querySelector('.box-chips').textContent)`,'box 2 re-added');

  // delete a box, then redraw
  await run(`[...document.querySelectorAll('.box-chip button')].find(b=>b.getAttribute('aria-label')==='Delete box 1').click()`);
  await waitFor(`/1 box = 1 product/.test(document.querySelector('.box-chips').textContent)`,'box deleted');
  ok('deleting a box lowers the count');
  await sleep(200);r=await editorRect();
  await drag(r.x+r.w*0.08,r.y+r.h*0.06,r.x+r.w*0.92,r.y+r.h*0.46);
  await clickText('button','Add box 2');
  await waitFor(`/2 boxes = 2 products/.test(document.querySelector('.box-chips').textContent)`,'two boxes again');

  // exit with unsaved boxes: prompt with Save for later / Discard / Continue editing
  await run(`document.querySelector('[aria-label="Close photo review"]').click()`);
  await waitFor(`!!document.querySelector('.finish-modal')`,'exit prompt');
  const labels=await run(`[...document.querySelectorAll('.finish-actions button')].map(b=>b.textContent.trim())`);
  assert.ok(labels.includes('Save for later')&&labels.includes('Discard')&&labels.includes('Continue editing'),'exit prompt buttons: '+labels);
  ok('closing with drawn boxes asks: Save for later / Discard / Continue editing');
  await clickText('.finish-actions button','Continue editing');
  await waitFor(`!document.querySelector('.finish-modal')&&!!document.querySelector('.box-chips')`,'back to editing');
  ok('Continue editing keeps the boxes');

  // Save for later, reload, recover
  await run(`document.querySelector('[aria-label="Close photo review"]').click()`);
  await waitFor(`!!document.querySelector('.finish-modal')`,'exit prompt 2');
  await clickText('.finish-actions button','Save for later');
  await waitFor(`!document.querySelector('.finish-modal')&&!document.querySelector('#crop-editor-panel')`,'closed');
  assert.ok(await run(`JSON.parse(localStorage.getItem('imei-lens-drafts-v1')||'{}').boxes?.['seed-1']?.length===2`),'boxes stored');
  ok('Save for later keeps the boxes on the phone');
  await send('Page.navigate',{url:'http://localhost:4191/'});
  await waitFor(`document.readyState==='complete'`,'reload 2');
  await waitFor(`!!document.querySelector('.draft-banner')`,'draft banner');
  ok('after a reload the banner offers the saved-for-later edits');
  await clickText('.draft-banner button','Continue');
  await waitFor(`/2 boxes = 2 products/.test((document.querySelector('.box-chips')||{}).textContent||'')`,'boxes restored');
  ok('Continue restores the 2 drawn boxes');

  // process and save
  await clickText('button','Process 2 boxes');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/^Save 2 pictures/.test(b.textContent.trim()))`,'processed',150000);
  ok('Process reads both boxes');
  await clickText('button','Save 2 pictures');
  await waitFor(`/2 cropped records saved/.test(document.body.textContent)`,'saved toast');
  await sleep(1500);
  const rows=await readDb();
  assert.equal(rows.length,2,'two records after the split: '+JSON.stringify(rows));
  assert.ok(!rows.some(x=>x.id==='seed-1'),'the original whole-photo record is gone');
  assert.ok(rows.every(x=>x.hasData&&x.crop&&!x.hasOriginal),'each crop keeps only its own picture');
  assert.equal(new Set(rows.map(x=>x.sourceId)).size,1,'crops share one new source id');
  assert.notEqual(rows[0].sourceId,'PIC-SEED1','the original source id is not reused');
  const originalLen=photo.length;assert.ok(rows.every(x=>x.dataLen<originalLen*0.8),'crops are smaller than the original photo (original not copied)');
  ok('split replaces the original: 2 records, each with only its own crop, no original photo kept');
  assert.equal(await run(`!localStorage.getItem('imei-lens-drafts-v1')`),true,'no stale draft left');
  ok('no stale draft is left after the split');
  // ---- typed edits: Save for later, recovery after reload, Discard ----
  await waitFor(`!document.querySelector('#crop-editor-panel')`,'review closed after split');
  await run(`document.querySelector('.photo-cell').click()`);
  await waitFor(`!!document.getElementById('manual-imei')`,'review fields');
  await run(`(()=>{const e=document.getElementById('manual-imei');e.focus();e.select();})()`);
  await send('Input.insertText',{text:'490154203237518'});
  await waitFor(`document.getElementById('manual-imei').value==='490154203237518'`,'typed IMEI');
  await run(`document.querySelector('[aria-label="Close photo review"]').click()`);
  await waitFor(`!!document.querySelector('.finish-modal')`,'exit prompt for typed edits');
  const typedLabels=await run(`[...document.querySelectorAll('.finish-actions button')].map(b=>b.textContent.trim())`);
  assert.ok(typedLabels.some(l=>/^Save all/.test(l))&&typedLabels.includes('Save for later')&&typedLabels.includes('Discard')&&typedLabels.includes('Continue editing'),'typed-edit prompt: '+typedLabels);
  ok('closing with typed edits asks: Save all / Save for later / Discard / Continue editing');
  await clickText('.finish-actions button','Save for later');
  await waitFor(`!document.querySelector('.finish-modal')`,'closed 3');
  assert.ok(await run(`Object.values(JSON.parse(localStorage.getItem('imei-lens-drafts-v1')||'{}').fields||{}).some(f=>f.imei==='490154203237518')`),'typed IMEI stored');
  await send('Page.navigate',{url:'http://localhost:4191/'});
  await waitFor(`document.readyState==='complete'`,'reload 3');
  await waitFor(`!!document.querySelector('.draft-banner')`,'draft banner 2');
  await clickText('.draft-banner button','Continue');
  await waitFor(`!!document.getElementById('manual-imei')&&document.getElementById('manual-imei').value==='490154203237518'`,'typed IMEI recovered');
  ok('typed edits survive a reload (draft recovery)');
  await run(`document.querySelector('[aria-label="Close photo review"]').click()`);
  await waitFor(`!!document.querySelector('.finish-modal')`,'exit prompt 4');
  await clickText('.finish-actions button','Discard');
  await waitFor(`!document.querySelector('.finish-modal')&&!document.querySelector('.draft-banner')`,'discarded');
  assert.equal(await run(`!localStorage.getItem('imei-lens-drafts-v1')`),true,'drafts cleared');
  ok('Discard clears the edits, the banner and the stored draft');
  const finalRows=await readDb();assert.ok(!finalRows.some(x=>x.imei==='490154203237518'),'discarded IMEI was not saved');
  ok('a discarded edit is not saved to the record');

  // ---- bulk crop: automatic count, boxes kept if closed ----
  await clickText('button','Bulk crop');
  await waitFor(`!!document.querySelector('.bulk-modal')`,'bulk crop dialog');
  assert.equal(await run(`!/Labels in this photo/.test(document.querySelector('.bulk-modal').textContent)`),true,'no manual count in bulk crop');
  ok('bulk crop has no manual label count');
  await waitFor(`!!document.querySelector('.bulk-modal .crop-editor img')&&document.querySelector('.bulk-modal .crop-editor img').getBoundingClientRect().width>50`,'bulk pad');
  let br=await run(`(()=>{const r=document.querySelector('.bulk-modal .crop-editor img').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
  await drag(br.x+br.w*0.1,br.y+br.h*0.1,br.x+br.w*0.9,br.y+br.h*0.45);
  assert.equal(await clickText('.bulk-modal button','Add box 1'),true);
  await sleep(300);
  await drag(br.x+br.w*0.1,br.y+br.h*0.55,br.x+br.w*0.9,br.y+br.h*0.9);
  assert.equal(await clickText('.bulk-modal button','Add box 2'),true);
  await waitFor(`[...document.querySelectorAll('.bulk-modal button')].some(b=>/^Save 2 /.test(b.textContent.trim()))`,'bulk save button with automatic count');
  ok('bulk crop counts the boxes automatically (Save 2 · next photo)');
  await run(`[...document.querySelectorAll('.bulk-modal .modal-head button')].find(b=>b.textContent.trim()==='Close').click()`);
  await waitFor(`!document.querySelector('.bulk-modal')`,'bulk closed');
  assert.ok(await run(`Object.values(JSON.parse(localStorage.getItem('imei-lens-bulk-crop-plans-v1')||'{}')).some(l=>l.length===0)===false&&Object.keys(JSON.parse(localStorage.getItem('imei-lens-bulk-crop-plans-v1')||'{}')).length>=0`),'plans readable');
  await clickText('button','Bulk crop');
  await waitFor(`!!document.querySelector('.bulk-modal')`,'bulk reopened');
  await waitFor(`[...document.querySelectorAll('.bulk-modal button')].some(b=>/^Save 2 /.test(b.textContent.trim()))||/Undo box 2/.test(document.querySelector('.bulk-modal').textContent)`,'bulk boxes kept');
  ok('bulk crop keeps the drawn boxes after closing the window');

}catch(error){
  console.error('FAIL:',error.message);
  process.exitCode=1;
}
finally{ws.close();proc.kill();server.close();}
console.log(`${results.length} checks passed`);
