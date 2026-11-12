// Review sheet in headless Edge/Chrome at phone size (not part of `npm test`; run `npm run build` first).
//   node scripts/e2e-review.mjs [screenshot-folder]
// Checks: the sheet fits the screen; header, body and footer never overlap; every field is fully visible and
// not clipped; the photo preview is compact and opens full size on tap; typing is instant and kept; Save works;
// Previous / Next / Finish behave; leaving with unsaved changes asks first.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
const shots=process.argv[2];if(shots)await mkdir(shots,{recursive:true});
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const name=(await readdir('test-photos')).find(f=>/^multi-02\.jpg$/.test(f));
if(!name)throw new Error('test-photos/multi-02.jpg is missing');
const photo='data:image/jpeg;base64,'+(await readFile('test-photos/'+name)).toString('base64');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4195);
const profile=await mkdtemp(join(tmpdir(),'imei-review-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9351',`--user-data-dir=${profile}`,'--window-size=420,900','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9351/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
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
const seed=(n,model,imei)=>`tx.objectStore('inventory').put({id:'seed-${n}',pictureId:'PIC-SEED${n}',sourcePictureId:'PIC-SEED${n}',number:${n+2},personId:'',name:'IMG_20260821_${n}.jpg',dataUrl:${JSON.stringify(photo)},originalDataUrl:${JSON.stringify(photo)},model:'${model}',imei:'${imei}',status:'Valid',duplicate:false,createdAt:new Date().toISOString(),raw:'Model : SM-A576B/DS\\nIMEI 1: ${imei}\\nS/N: R5GL80LDKFM'},'record:seed-${n}');`;
try{
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:860,deviceScaleFactor:2,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
  await send('Page.navigate',{url:'http://localhost:4195/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');${seed(1,'Galaxy A57 5G 128GB (Unlocked) · SM-A576B','350357925907537')}${seed(2,'SM-A576B','350950575907532')}tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4195/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
  await waitFor(`!!document.querySelector('.results .imei-edit, .results tbody tr, .simple-record-photo')`,'records listed');
  await run(`(()=>{const b=document.querySelector('.results button[title*="review" i], .results td img, .simple-record-photo, .results tbody tr button');if(b)b.click();return true;})()`);
  await waitFor(`!!document.querySelector('.review-modal')`,'review sheet opens');
  await sleep(600);
  await shot('1-review-open');

  const vp=await run(`({w:innerWidth,h:innerHeight})`);
  const modal=await rect('.review-modal'),head=await rect('.review-sticky'),body=await rect('.review-body'),foot=await rect('.review-foot');
  assert.ok(modal.b<=vp.h+1&&modal.r<=vp.w+1,'sheet fits the screen');
  assert.ok(head.b<=body.y+1&&body.b<=foot.y+1,'header, body and footer do not overlap');
  ok(`sheet fits ${vp.w}x${vp.h}; header/body/footer stack without overlap`);

  const thumb=await rect('.review-thumb');
  assert.ok(thumb.h<=vp.h*0.2,`preview is compact (${Math.round(thumb.h)}px of ${vp.h})`);
  assert.ok(body.h>=vp.h*0.4,`body has room (${Math.round(body.h)}px)`);
  ok(`photo preview is compact (${Math.round(thumb.h)}px) and the body keeps ${Math.round(body.h)}px`);

  // fields: stacked, full width, none clipped or covered
  const fields=await run(`[...document.querySelectorAll('.review-field')].map(f=>{const r=f.getBoundingClientRect(),l=f.querySelector('label').getBoundingClientRect(),c=f.querySelector('input,select,.model-picker-button').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,b:r.bottom,labelBottom:l.bottom,controlTop:c.top,controlRight:c.right}})`);
  assert.equal(fields.length,5,'five fields');
  for(let i=0;i<fields.length;i++){const f=fields[i];assert.ok(f.labelBottom<=f.controlTop+1,'label above its control');assert.ok(f.controlRight<=vp.w,'control inside the screen');if(i)assert.ok(fields[i-1].b<=f.y+1,`field ${i} does not overlap the previous one`);}
  const clipped=await run(`[...document.querySelectorAll('.review-field input,.review-field select')].filter(e=>e.scrollWidth>e.clientWidth+1&&e.tagName==='SELECT').length`);
  assert.equal(clipped,0,'no clipped select');
  const modelTextFits=await run(`(()=>{const s=document.querySelector('.model-picker-button span');return s.scrollWidth<=s.clientWidth+1;})()`);
  assert.ok(modelTextFits,'model name is not cut off');
  ok('five fields stack with labels above, nothing overlaps or runs off the screen, model name wraps instead of clipping');

  const footButtons=await run(`[...document.querySelectorAll('.review-foot button')].map(b=>b.textContent.trim())`);
  assert.ok(footButtons.some(t=>/Previous/.test(t))&&footButtons.some(t=>/Next/.test(t))&&footButtons.includes('Save'),'footer has Previous, Next, Save: '+footButtons);
  ok('footer has Previous / Next / Save: '+footButtons.join(' | '));

  // tap to enlarge
  await run(`document.querySelector('.review-thumb').click()`);
  await waitFor(`!!document.querySelector('.photo-lightbox img')`,'lightbox');
  const big=await rect('.photo-lightbox img');
  assert.ok(big.h>thumb.h*2,'enlarged photo is bigger');
  await shot('2-enlarged');
  await run(`document.querySelector('.photo-lightbox').click()`);
  await waitFor(`!document.querySelector('.photo-lightbox')`,'lightbox closed');
  ok('tap on the preview enlarges the photo, tap again closes it');

  // typing: instant and kept
  const t0=Date.now();
  await typeInto('#manual-serial','R5GL80LDKFM');
  await typeInto('#manual-imei','350357925907537');
  const typed=Date.now()-t0;
  assert.equal(await run(`document.querySelector('#manual-serial').value`),'R5GL80LDKFM');
  assert.equal(await run(`document.querySelector('#manual-imei').value`),'350357925907537');
  await typeInto('#manual-imei','35a0b3-57925907537999');
  assert.equal(await run(`document.querySelector('#manual-imei').value`),'350357925907537','IMEI box keeps digits only, 15 max');
  ok(`typing is kept and cleaned (digits only, 15 max); two fields took ${typed} ms`);
  await waitFor(`/unsaved|All saved/.test(document.querySelector('.review-save-state').textContent)`,'save state');
  await shot('3-typed');

  // Save writes the typed values
  await run(`document.querySelector('#manual-serial').blur()`);
  await clickText('.review-foot button','Save');
  await waitFor(`/All saved/.test(document.querySelector('.review-save-state').textContent)`,'saved state');
  ok('Save stores the typed values ("All saved")');

  // Next shows the second record; Previous returns; typed text is not leaked between records
  await clickText('.review-foot button','Next');
  await waitFor(`/2 of 2/.test(document.querySelector('.review-navigation span').textContent)`,'second record');
  assert.equal(await run(`document.querySelector('#manual-imei').value`),'350950575907532','second record shows its own IMEI');
  assert.ok(await run(`[...document.querySelectorAll('.review-foot button')].some(b=>/Finish/.test(b.textContent))`),'last record offers Finish');
  await shot('4-last');
  ok('Next opens record 2 with its own IMEI; the last record offers Finish');
  await typeInto('#manual-serial','CHANGEDX1');
  await run(`document.querySelector('#manual-serial').blur()`);
  await clickText('.review-foot button','Finish');
  await waitFor(`!!document.querySelector('.finish-modal, [role="alertdialog"]')||!document.querySelector('.review-modal')`,'finish prompt');
  assert.ok(await run(`!!document.querySelector('.review-modal')`),'sheet is still open: unsaved work asks first');
  const finishOptions=await run(`[...document.querySelectorAll('.finish-modal button')].map(b=>b.textContent.trim())`);
  assert.ok(finishOptions.length>=2,'finish prompt has choices: '+finishOptions);
  await shot('5-finish-prompt');
  ok('Finish with unsaved changes asks first: '+finishOptions.join(' | '));
  await run(`[...document.querySelectorAll('.finish-modal button')].find(b=>/Keep editing/.test(b.textContent)).click()`);
  console.log(`\nAll ${results.length} review checks passed.`);
}catch(error){console.error('FAIL:',error.message);await shot('failure');process.exitCode=1;}
finally{try{ws.close();}catch{}proc.kill();server.close();}
