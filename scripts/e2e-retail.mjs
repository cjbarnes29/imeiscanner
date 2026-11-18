// AI LENS plan v2 end to end in headless Edge/Chrome (not part of `npm test`; run `npm run build` first):  node scripts/e2e-retail.mjs
// SYNTHETIC data only. Seeds 9 coloured phones and 2 people, then drives the real screens: a pasted report is checked against the scanned phones, a line is
// fixed and an unknown name is taught, the person's own segment is made and filled, targets show levels 70-120 (typed pieces win), Gives only suggests until
// approved (and Undo), a phone marked sold leaves the stock, reload persistence, and the scan records themselves were never changed.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import sharp from 'sharp';
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const luhn=d=>{let s=0;for(let i=0;i<d.length;i++){let n=+d[d.length-1-i];if(i%2===0){n*=2;if(n>9)n-=9;}s+=n;}return String((10-s%10)%10);};
let seq=700000;const imei=()=>{const b='49015420'+String(seq++).padStart(6,'0');return b+luhn(b);};
const PX='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const phone=(id,model,personId,raw)=>({id,number:Number(id.slice(1)),name:id+'.jpg',dataUrl:PX,originalDataUrl:PX,model,imei:imei(),status:'Valid',personId,raw,pictureId:'PIC-'+id,sourcePictureId:'PIC-'+id,duplicate:false,createdAt:new Date().toISOString()});
const seed=[phone('r1','SM-A176B','me','6GB | 128GB\nColour: Black'),phone('r2','SM-A176B','me','6GB | 128GB\nColour: Black'),phone('r3','SM-A576B','me','8GB | 256GB\nColour: Gray'),phone('r4','SM-S948B','me','12GB | 256GB\nColour: Black'),
  phone('r5','SM-A176B','','6GB | 128GB\nColour: Blue'),phone('r6','SM-A176B','','6GB | 128GB\nColour: Black'),phone('r7','SM-A576B','','8GB | 256GB\nColour: Gray'),phone('r8','SM-S942B','','12GB | 256GB\nColour: Black'),phone('r9','SM-A576B','asha','8GB | 256GB\nColour: Navy')];
const before=JSON.stringify(seed.map(r=>[r.id,r.imei,r.model,r.dataUrl,r.originalDataUrl,r.name,r.raw]));
const people=[{id:'me',label:'Person 1',name:'Carlou Test'},{id:'asha',label:'Person 2',name:'Asha Test'}];
const now=new Date();const monthName=now.toLocaleString('en-US',{month:'long'});
const pad=n=>String(n).padStart(2,'0');const today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;const todayDMY=`${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
// the Promoter screen (synthetic): a picture of text, read offline by the page
const lines=['Samsung Promoter','Name: Carlou Test',`${monthName} ${now.getFullYear()}  Target vs Achievement`,'Flagship 1   Target 2   Achieved 1   50%','Flagship 2   Target 4   Achieved 1   25%','Mid   Target 4   Achieved 2   50%','Low   Target 10   Achieved 6   60%'];
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${120+lines.length*70}"><rect width="100%" height="100%" fill="#ffffff"/>${lines.map((l,i)=>`<text x="40" y="${80+i*70}" font-family="Arial" font-size="42" fill="#000">${l}</text>`).join('')}</svg>`);
const screenshot=(await sharp(svg).png().toBuffer()).toString('base64');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.gz':'application/gzip','.traineddata':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4196);
if(await fetch('http://127.0.0.1:9352/json').then(()=>true,()=>false))throw new Error('Port 9352 is used by an old browser: stop the leftover headless msedge (profile imei-retail-*) first.');
const profile=await mkdtemp(join(tmpdir(),'imei-retail-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9352',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
function stopBrowsersOf(dir){const tag=dir.split(/[\\/]/).pop();spawnSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{stdio:'ignore'});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9352/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(250);}throw new Error('Timed out waiting for: '+label);};
const clickText=(selector,text)=>run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const click=async(selector,text)=>{if(!await clickText(selector,text))throw new Error(`no enabled "${text}" in ${selector}`);};
const setVal=(selector,value,index=0)=>run(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})][${index}];if(!el)return false;const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;})()`);
const setLabelVal=(labelText,value)=>run(`(()=>{const label=[...document.querySelectorAll('.retail-card label')].find(l=>(l.childNodes[0]?.textContent||'').trim().startsWith(${JSON.stringify(labelText)}));const el=label?.querySelector('select,input,textarea');if(!el)return false;const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;})()`);
const body=()=>run(`document.body.innerText`);
const stat=name=>run(`(()=>{const d=[...document.querySelectorAll('.retail-stats > div')].find(x=>x.querySelector('span')?.textContent===${JSON.stringify(name)});return d?d.querySelector('strong').textContent:null;})()`);
const readDb=key=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const s=db.transaction('inventory').objectStore('inventory');const q=${key.endsWith(':')?`s.getAll(IDBKeyRange.bound(${JSON.stringify(key)},${JSON.stringify(key)}+'\\uffff'))`:`s.get(${JSON.stringify(key)})`};q.onsuccess=()=>{db.close();res(q.result);};};})`);
const owners=async()=>Object.fromEntries((await readDb('record:')).map(r=>[r.id,r.personId]));
const expandScreen=async()=>{await sleep(100);await run(`document.querySelector('button[aria-label="Show all details"]')?.click()`);await sleep(100);};
const nav=async label=>{await click('.bottom-nav button',label);await expandScreen();};
const more=async label=>{await run(`document.querySelector('button[aria-label="More"]').click()`);await waitFor(`!!document.querySelector('.more-list')`,'the More menu');if(['Segments','Catalog'].includes(label)){await click('.more-list button','Models & segments');await waitFor(`!!document.querySelector('.model-manager')`,'model manager');await click('.model-manager .give-tabs button',label==='Catalog'?'All models':'By segment');}else if(['Give and share','People'].includes(label)){await click('.more-list button','Give & share');await waitFor(`!!document.querySelector('.people-sharing-tabs')`,'people and sharing');if(label==='Give and share')await click('.people-sharing-tabs button','Give');else{await expandScreen();await click('.people-sharing-tabs button','People');}}else if(label.startsWith('Backup')){await click('.more-list button','Settings & backup');await waitFor(`!!document.querySelector('.settings-modal')`,'settings');await click('.settings-modal button','Backup, restore & history');await waitFor(`!!document.querySelector('.retail-data')`,'backup screen');}else await click('.more-list button',label);await expandScreen();};
// Home, Report and Targets are on the bottom bar; Gives, Segments, Catalog and Backup are under the ⋯ More menu
const sub=async label=>{if(label==='Today')return nav('Home');if(label==='Report'||label==='Targets')return nav(label);return more(label==='Data'?'Backup':label);};
const shot=async name=>{if(!process.env.SHOTS)return;await sleep(400);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(r.result.data,'base64'));};
const shotRegion=async(name,expr)=>{if(!process.env.SHOTS)return;await sleep(500);await run(`document.querySelectorAll('.bottom-nav,.toast').forEach(e=>e.style.visibility='hidden')`);try{const clip=await run(`(()=>{const r=(${expr}).getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(r.result.data,'base64'));}finally{await run(`document.querySelectorAll('.bottom-nav,.toast').forEach(e=>e.style.removeProperty('visibility'))`);}};
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
try{
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:411,height:900,deviceScaleFactor:1,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('e2e-seeded')){localStorage.setItem('imei-lens-simple-view','false');localStorage.setItem('imei-lens-people-v1',${JSON.stringify(JSON.stringify(people))});localStorage.setItem('e2e-seeded','1');}localStorage.setItem('retaillens-theme-v1','${process.env.THEME||'mint'}');`});
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await waitFor(`!!document.querySelector('.bottom-nav')`,'initial app ready');
  await sleep(400);
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');for(const r of ${JSON.stringify(seed)})tx.objectStore('inventory').put(r,'record:'+r.id);tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
  // the scanning screen comes first and the brand is AI LENS
  await waitFor(`!!document.querySelector('.bottom-nav')`,'bottom nav');
  assert.match(await run(`document.querySelector('.brand')?.textContent||''`),/AI LENS[\s\S]*SCAN\. SELL\. TRACK\. ACHIEVE\./i);
  assert.match(await run(`document.title`),/AI LENS/);
  ok('the app is branded AI LENS with the tagline "Scan. Sell. Track. Achieve."');

  // ---------- Report: paste a synthetic report, see it checked against the scanned phones ----------
  await nav('Home');
  await waitFor(`!!document.querySelector('.retail-hub')`,'retail home');
  assert.deepEqual(await run(`[...document.querySelectorAll('.bottom-nav button span')].map(s=>s.textContent)`),['Home','Scan','Phones','Report','Targets','Export'],'the bottom bar');
  assert.equal(await run(`document.querySelector('.results .view-head h2').innerText`),'Home','each screen has its own title');
  assert.ok(!/Scanned records/.test(await run(`document.querySelector('.results').innerText`)),'no "Scanned records" header on Home');
  await run(`document.querySelector('button[aria-label="More"]').click()`);
  await waitFor(`!!document.querySelector('.more-list')`,'More menu');
  assert.deepEqual(await run(`[...document.querySelectorAll('.more-list strong')].map(s=>s.textContent)`),['People','Give & share','Models & segments','Settings & backup'],'the consolidated More menu');
  await shotRegion('10-more',`document.querySelector('.more-sheet')`);
  await run(`document.querySelector('.more-sheet [aria-label="Close"]').click()`);

  // Home says whose month it is, with a person switcher
  assert.deepEqual(await run(`[...document.querySelectorAll('.who-chips button')].map(b=>b.textContent.trim())`),['★Everyone','CCarlou Test','AAsha Test']);
  assert.match(await body(),/Sell first: everyone/,'Home looks at everyone first');
  await click('.who-chips button','CCarlou');
  await waitFor(`/Sell first for Carlou Test/.test(document.body.innerText)`,'one person');
  await click('.who-chips button','AAsha');
  await waitFor(`/Sell first for Asha Test/.test(document.body.innerText)`,'switch person');
  await shot('7-home');
  await click('.who-chips button','★Everyone');
  ok('Home looks at everyone together, with a person switcher that narrows it to one person');
  ok('the bottom bar is Home, Scan, Phones, Report, Targets, Export; Gives, Segments, Catalog, People and Backup are under ⋯ More; each screen has its own title');
  await sub('Report');
  await waitFor(`!!document.querySelector('textarea[aria-label="The report"]')`,'paste box');
  const REPORT=['Location: DEMO','Date: Nov 11, 2026','','A17 5G 6/128GB : 00/04','(00,01,03) Gry,Blu,Blk','','A57 5G 8/256GB : 01/03','(02,01,00) GRY,NVY,LiLc','',
    'S26U 256GB : 00/02','(02) Blk','','Note 17 : 01/01','(01) Blk','','Total Sellout : 3','Apple : 2'].join(String.fromCharCode(10));
  await setVal('textarea[aria-label="The report"]',REPORT);
  await click('button','Read the report');
  await waitFor(`!!document.querySelector('.rep-chips')`,'summary chips');
  const chips=await run(`document.querySelector('.rep-chips').innerText`);
  assert.match(chips,/2 agree/); assert.match(chips,/1 differ/); assert.match(chips,/1 unknown/);
  assert.match(await body(),/Scanned in the app \(in stock\): 9/);
  ok('the pasted report is checked against the 9 scanned phones: 2 lines agree, 1 differs, 1 is unknown');
  const rows=await run(`[...document.querySelectorAll('.rep-row')].map(r=>r.innerText.replace(/\\s+/g,' '))`);
  assert.match(rows[0],/Note 17/, 'problems come first (the unknown one on top)');
  assert.ok(rows.some(r=>/S26U 256GB/.test(r)&&/report 2, scanned 1|Report stock 2, scanned 1/i.test(r)),'the difference is said in words: '+JSON.stringify(rows));
  ok('every problem is described in words, worst first');
  // colour names: the built-in dictionary named every short form by itself; one answer names a short form everywhere
  await waitFor(`!!document.querySelector('.rep-colours-card')`,'the colour names list');
  assert.match(await run(`document.querySelector('.rep-colours-card summary').innerText`),/all named/,'every short form was named by itself');
  await run(`document.querySelector('.rep-colours-card').open=true`);
  await click('.rep-colours-card button','Show all');
  await waitFor(`document.querySelectorAll('.rep-colours-card .rep-lab').length>=4`,'a row for each short form');
  const labTexts=await run(`[...document.querySelectorAll('.rep-colours-card .rep-lab')].map(r=>r.innerText.replace(/\\s+/g,' '))`);
  assert.ok(labTexts.some(t=>/LiLc/.test(t)&&/= Lilac/.test(t)&&/built in/.test(t)),'LiLc = Lilac from the dictionary: '+JSON.stringify(labTexts));
  assert.ok(labTexts.some(t=>/NVY/.test(t)&&/= Navy/.test(t)&&/from scanned phones/.test(t)),'NVY = Navy from a scanned phone: '+JSON.stringify(labTexts));
  assert.ok(labTexts.some(t=>/Blk/.test(t)&&/\d+ lines/.test(t)),'one row for the whole report, with the number of lines that use it: '+JSON.stringify(labTexts));
  await run(`(()=>{const el=document.querySelector('input[aria-label="Colour for LiLc"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Lilac Purple');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;})()`);
  await waitFor(`[...document.querySelectorAll('.rep-colours-card .rep-lab')].some(r=>/LiLc/.test(r.innerText)&&/= Lilac Purple/.test(r.innerText)&&/· you/.test(r.innerText))`,'named once');
  ok('the dictionary names every short form by itself, and one answer names a short form on every line');
  await shot('1-report');
  assert.match(await body(),/Sellout in the list: 2 · the report says 3/);
  await click('button','Includes phones not listed');
  await waitFor(`/includes 1 phone not in the list/.test(document.body.innerText)`,'total acknowledged');
  ok('a total that is higher than the list can be marked as including phones that are not listed');

  // tap a line: fix the colours (stock follows), save
  const openRow=text=>run(`(()=>{const r=[...document.querySelectorAll('.rep-row')].find(x=>x.innerText.includes(${JSON.stringify(text)}));if(!r)return false;r.click();return true;})()`);
  assert.equal(await openRow('S26U 256GB'),true);
  await waitFor(`!!document.querySelector('.modal-backdrop .rep-sheet')`,'the line opens as a popup');
  // the popup is in the right place: on top of the bottom bar, inside the screen, nothing of it hidden behind the bar
  await sleep(800); // the popup slides up first
  const place=await run(`(()=>{const m=document.querySelector('.rep-modal').getBoundingClientRect();const nav=document.querySelector('.bottom-nav').getBoundingClientRect();const top=(x,y)=>document.elementFromPoint(x,y);
    const overNav=top(nav.left+nav.width/2,nav.top+nav.height/2);const atBottom=top(m.left+m.width/2,Math.min(m.bottom,innerHeight)-12);
    return {bottom:Math.round(m.bottom),h:innerHeight,navTop:Math.round(nav.top),coversNav:!!overNav&&!!overNav.closest('.modal-backdrop'),lowestPartIsPopup:!!atBottom&&!!atBottom.closest('.rep-modal')};})()`);
  assert.ok(place.coversNav,'the popup layer is above the bottom bar: '+JSON.stringify(place));
  assert.ok(place.lowestPartIsPopup&&place.bottom<=place.h+1,'the popup sits inside the screen: '+JSON.stringify(place));
  assert.equal(await run(`!!document.querySelector('.rep-sheet [aria-label="Previous line"]')&&!!document.querySelector('.rep-sheet [aria-label="Next line"]')`),true,'Previous and Next are in the popup');
  assert.match(await run(`document.querySelector('.rep-sheet .rep-help')?.innerText||''`),/How to fix this line/,'the popup says how to fix the line');
  assert.match(await run(`document.querySelector('.rep-sheet').innerText`),/Matches[\s\S]*Galaxy S26 Ultra/);
  assert.equal(await run(`document.querySelector('.rep-sheet input[aria-label="Blk is"]').value`),'Black','the report colour "Blk" is matched to the scanned colour Black, and can be changed');
  await setVal('.rep-sheet input[aria-label="Blk count"]','1');
  assert.equal(await run(`document.querySelector('.rep-sheet input[disabled]')?.value`),'1','the stock follows the colours');
  await shot('2-line-sheet');
  await click('.rep-sheet button','Save line');
  await waitFor(`!document.querySelector('.rep-sheet')&&/3 agree/.test(document.querySelector('.rep-chips').innerText)`,'line saved');
  ok('fixing the colour count of a line makes it agree (stock follows the colours) and saves it');

  // an unknown name: say what it means once, it is remembered
  assert.equal(await openRow('Note 17'),true);
  await waitFor(`!!document.querySelector('.rep-sheet input[type=search]')`,'search');
  await setVal('.rep-sheet input[type=search]','a57 5g');
  await waitFor(`[...document.querySelectorAll('.rep-sheet .retail-list li')].some(l=>/A57 5G/.test(l.innerText))`,'search result');
  await run(`(()=>{const li=[...document.querySelectorAll('.rep-sheet .retail-list li')].find(l=>/A57 5G/.test(l.innerText));li.querySelector('button').click();return true;})()`);
  await waitFor(`/Matches/.test(document.querySelector('.rep-sheet').innerText)`,'model chosen');
  await click('.rep-sheet button','Save line');
  await waitFor(`!document.querySelector('.rep-sheet')&&/0 unknown/.test(document.querySelector('.rep-chips').innerText)`,'alias saved');
  ok('an unknown report name is matched to a catalog model by search, and remembered');
  // saving a line marks it as checked: it leaves "to check" even though it still differs from the scans
  const chipsNow=await run(`document.querySelector('.rep-chips').innerText`);
  assert.match(chipsNow,/1 checked by you/,'the saved line counts as checked: '+chipsNow); assert.match(chipsNow,/0 differ/);
  assert.ok(await run(`[...document.querySelectorAll('.rep-row')].some(r=>/You checked this line/.test(r.innerText))`),'the line says it was checked');
  ok('Save line marks the line as checked: it leaves the "to check" count even though it still differs from the scans');
  // Previous / Next move along the report without going back to the list
  assert.equal(await openRow('A17 5G 6/128GB'),true);
  await waitFor(`!!document.querySelector('.rep-sheet')`,'popup for A17');
  const titleBefore=await run(`document.querySelector('.rep-sheet h3').innerText`);
  await run(`document.querySelector('.rep-sheet [aria-label="Next line"]').click()`);
  await waitFor(`document.querySelector('.rep-sheet h3').innerText!==${JSON.stringify(titleBefore)}`,'the next line');
  await run(`document.querySelector('.rep-sheet [aria-label="Previous line"]').click()`);
  await waitFor(`document.querySelector('.rep-sheet h3').innerText===${JSON.stringify(titleBefore)}`,'back to the first line');
  await run(`document.querySelector('.rep-sheet [aria-label="Close"]').click()`);
  await waitFor(`!document.querySelector('.rep-sheet')`,'popup closed');
  ok('the line popup has Previous and Next');
  await click('button','Copy report');
  ok('Copy report works on the edited report');

  // ---------- Segments: the person's own ----------
  await sub('Segments');
  await waitFor(`!!document.querySelector('input[aria-label="New segment name"]')`,'segments');
  await setVal('input[aria-label="New segment name"]','Fold 1');
  await click('button','+ New segment');
  await waitFor(`!!document.querySelector('.tg-edit input[type=search]')`,'new segment is open for editing');
  await shot('3-segments');
  await setVal('.tg-edit input[type=search]','s26');
  await waitFor(`!!document.querySelector('.tg-edit input[aria-label="Galaxy S26 Ultra in Fold 1"]')`,'S26 Ultra listed');
  const tick=label=>run(`(()=>{const c=document.querySelector('input[aria-label=${JSON.stringify(label)}]');if(!c)return false;if(!c.checked)c.click();return true;})()`);
  assert.equal(await tick('Galaxy S26 Ultra in Fold 1'),true); assert.equal(await tick('Galaxy S26 in Fold 1'),true);
  await waitFor(`document.querySelector('input[aria-label="Galaxy S26 Ultra in Fold 1"]').checked`,'ticked');
  await setVal('input[aria-label="New segment name"]','fold 1');
  await click('button','+ New segment');
  await waitFor(`/already a segment with that name/.test(document.body.innerText)`,'duplicate refused');
  ok('a segment is made, models are ticked into it, and a second one with the same name is refused');
  await click('button[aria-label="Show fewer details"]','Show less');
  await waitFor(`document.querySelector('.retail-segments > .screen-extra').getBoundingClientRect().height===0`,'segment controls are collapsed');
  assert.match(await run(`document.querySelector('[aria-label="Models in Fold 1"] .seg-model-summary').innerText`),/Galaxy S26 Ultra/,'the segment lists its assigned models directly');
  await shotRegion('segments-summary',`document.querySelector('.retail-segments')`);
  await expandScreen();

  // ---------- Targets: level chips and one line per segment ----------
  await sub('Targets');
  await waitFor(`!!document.querySelector('.lvl-chips')`,'level chips');
  assert.deepEqual(await run(`[...document.querySelectorAll('.lvl-chips button')].map(b=>b.textContent)`),['70','80','90','100','110','120']);
  assert.ok(await run(`[...document.querySelectorAll('.tg-seg')].some(b=>b.innerText.includes('Fold 1'))`),'Fold 1 is a line');
  await run(`(()=>{[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).click();return true;})()`);
  await waitFor(`!!document.querySelector('input[aria-label="Target of Carlou Test"]')`,'segment open');
  await setVal('input[aria-label="Target of Carlou Test"]','5');
  await click('button','80');
  await setVal('input[aria-label="Sold of Carlou Test"]','1');
  await waitFor(`/For 80%:[\\s\\S]*needs 3 more[\\s\\S]*\\(4 in total\\)/.test(document.querySelector('.retail-targets').innerText)`,'80% needs 3 more');
  assert.equal(await run(`document.querySelector('input[aria-label="Sold of Carlou Test"]').value`),'1','Sold is typed');
  assert.equal(await run(`!!document.querySelector('.tg-step')`),false,'no plus and minus buttons');
  ok('tapping 80 shows 3 more pieces needed for a target of 5 with 1 sold (4 in total), and per day');
  await shot('5-targets-segment');
  await click('button','Edit levels');
  await setVal('input[aria-label="80% pieces for Carlou Test"]','5');
  await waitFor(`/needs 4 more[\\s\\S]*\\(5 in total\\)/.test(document.querySelector('.retail-targets').innerText)`,'typed level wins');
  ok('the pieces typed for a level (from the Promoter screen) win over target x level');
  await click('button','90');
  await waitFor(`/For 90%:[\\s\\S]*needs 4 more/.test(document.querySelector('.retail-targets').innerText)`,'90 uses target x level (4.5 -> 5)');
  ok('a level left blank falls back to target x level, rounded up');
  // less typing for levels: "Use suggested" writes target x level into the boxes, "Same as last month" waits for a last month
  assert.equal(await run(`[...document.querySelectorAll('button')].some(b=>/^Start from last month/.test(b.textContent.trim()))`),false,'no last month: no "Start from last month"');
  await click('.tg-level-actions button','Use suggested');
  await waitFor(`document.querySelector('input[aria-label="70% pieces for Carlou Test"]').value==='4'`,'suggested levels written down');
  assert.equal(await run(`document.querySelector('input[aria-label="90% pieces for Carlou Test"]').value`),'5','target 5 x 90% = 4.5, rounded up');
  assert.equal(await run(`document.querySelector('.tg-level-actions button:nth-child(2)').disabled`),true,'with no last month, "Same as last month" is off');
  ok('"Use suggested" fills the levels from the target; "Same as last month" and "Start from last month" only appear when there is a last month');
  // numbers are typed or pasted (only the digits count), and one person's target can be copied to everyone
  await setVal('input[aria-label="Sold of Carlou Test"]','12 pcs');
  await waitFor(`document.querySelector('input[aria-label="Sold of Carlou Test"]').value==='12'`,'pasted text keeps its digits');
  await setVal('input[aria-label="Sold of Carlou Test"]','1');
  assert.equal(await run(`document.querySelector('input[aria-label="Target of Asha Test"]').value`),'0');
  await run(`document.querySelector('button[aria-label="Copy the target of Carlou Test to everyone"]').click()`);
  await waitFor(`document.querySelector('input[aria-label="Target of Asha Test"]').value==='5'`,'the target was copied');
  assert.equal(await run(`document.querySelector('input[aria-label="Sold of Asha Test"]').value`),'0','sold is not copied');
  assert.equal(await run(`document.querySelector('input[aria-label="Sold of Carlou Test"]').value`),'1','the person copied from keeps their sold');
  ok('Sold and target are typed (a pasted "12 pcs" keeps its digits), and "Copy target to everyone" copies the target only');
  await click('button','← All segments');
  await waitFor(`!!document.querySelector('.tg-segs')`,'back to the list');
  assert.match(await run(`[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).innerText`),/Sold 1 of 10/);
  assert.match(await run(`[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).innerText`),/Carlou Test[\s\S]*(?:a day|every \d+ days)/,'each person and per day under the segment (whole numbers)');
  ok('the segment line adds everyone up: sold 1 of 10 (two people with a target of 5 each)');
  await shot('4-targets-lines');

  // ---------- 1.39: whole-number pace, finish dates, the highest level, who an import is for, Edit all ----------
  assert.ok(!/\d\.\d+\s*\/day/.test(await run(`document.querySelector('.retail-targets').innerText`)), 'no 0.1/day style numbers anywhere on Targets');
  assert.match(await run(`[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).innerText`), /(a day|every \d+ days)/, 'whole-number pace under the segment');
  assert.match(await run(`[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).innerText`), /70%[\s\S]*100%[\s\S]*120%/, 'a finish line for 70, 100 and 120 under the segment');
  ok('pace is in whole numbers ("2 a day" / "1 every 3 days") and every segment says when 70%, 100% and 120% are reached at this month\'s pace');

  // the highest level (some segments stop at 100%)
  await run(`(()=>{[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).click();return true;})()`);
  await waitFor(`!!document.querySelector('input[aria-label="Target of Carlou Test"]')`, 'segment open again');
  await click('button', '120');
  await click('button', 'Edit levels');
  assert.ok(!/The top level here/.test(await run(`document.querySelector('.retail-targets').innerText`)), 'no limit at first');
  await setVal('select[aria-label="Highest level for Carlou Test"]', '100');
  await waitFor(`/The top level here is 100%/.test(document.querySelector('.retail-targets').innerText)`, 'the highest level shows');
  await click('button', '← All segments');
  const foldCard = `[...document.querySelectorAll('.tg-seg')].find(b=>b.getAttribute('aria-label')==='Open Fold 1')`;
  await waitFor(`${foldCard}?.innerText.includes('Caps vary by person')`, 'different caps are visible on the overview');
  assert.match(await run(`${foldCard}.querySelector('.tg-people').innerText`), /Carlou Test[\s\S]*Cap 100%/);
  await run(`${foldCard}.click()`); await click('button', 'Edit levels');
  await run(`document.querySelector('button[aria-label="Copy the highest level of Carlou Test to everyone"]').click()`);
  await waitFor(`(document.querySelector('.retail-targets').innerText.match(/The top level here is 100%/g)||[]).length===2`, 'the highest level was copied to Asha');
  await click('button', '← All segments');
  await waitFor(`${foldCard}?.querySelector('.tg-cap-badge')?.textContent==='Cap 100%'`, 'the shared cap is on the segment card');
  assert.match(await run(`${foldCard}.querySelector('.tg-need').innerText`), /for 100%/);
  assert.doesNotMatch(await run(`${foldCard}.querySelector('.tg-finish').innerText`), /120%/, 'finish dates stop at the cap');
  await shotRegion('targets-capped-overview',foldCard);
  await click('button[aria-label="Show fewer details"]','Show less');
  await waitFor(`${foldCard}?.offsetParent!==null&&!document.querySelector('.retail-targets > .screen-extra').offsetParent`,'segments come first in the compact view');
  assert.equal(await run(`${foldCard}.querySelector('.tg-people').getBoundingClientRect().height`),0,'per-person details are hidden until Show all');
  await shotRegion('targets-simple',`document.querySelector('.retail-targets')`);
  await shot('targets-simple-screen');
  await expandScreen();
  await click('button', '70');
  assert.equal(await run(`${foldCard}.querySelector('.tg-cap-badge').textContent`), 'Cap 100%', 'the cap stays visible below the selected level');
  await run(`${foldCard}.click()`); await click('button', 'Edit levels');
  await click('button', '70');
  await waitFor(`!/The top level here/.test(document.querySelector('.retail-targets').innerText)`, 'asking for 70 is below the top, so it is a normal line');
  await click('button', '120');
  await setVal('select[aria-label="Highest level for Carlou Test"]', '');
  await run(`document.querySelector('button[aria-label="Copy the highest level of Carlou Test to everyone"]').click()`);
  await waitFor(`!/The top level here/.test(document.querySelector('.retail-targets').innerText)&&/For 120%/.test(document.querySelector('.retail-targets').innerText)`, 'no limit again');
  await click('button', '90');
  ok('a segment can stop at 100%: 120 then shows "The top level here is 100%", it copies to everyone, and "No limit" puts it back');
  ok('target overview shows common and per-person caps, uses the effective percentage and stops finish dates at the cap');
  await click('button', '← All segments');
  await waitFor(`!!document.querySelector('.tg-segs')`, 'back to the list');

  // who an import is for: pasted text and a screenshot (both read offline), nobody picked unless the text says who
  const dlg = `document.querySelector('[aria-label="Check the imported targets"]')`;
  const paste = async text => { await click('button', 'Paste text'); await setVal('textarea[aria-label="Pasted targets text"]', text); await click('button', 'Read text'); await waitFor(`!!${dlg}`, 'the check screen'); };
  const who = () => run(`[...${dlg}.querySelectorAll('.tg-import select:not([aria-label])')].map(s=>s.value)`);
  await paste('Name: Asha Test\nTablet  Target 4  Achieved 1');
  assert.deepEqual(await who(), ['asha'], 'the name on the text picks Asha');
  assert.match(await run(`${dlg}.innerText`), /Found the name on it/);
  await click('button', 'Discard');
  await paste('Name: Zed Nobody\nTablet  Target 4  Achieved 1');
  assert.deepEqual(await who(), [''], 'an unknown name: nobody is picked');
  assert.match(await run(`${dlg}.innerText`), /Could not tell who this is for/);
  await click('button', 'Save targets');
  await sleep(500);
  assert.equal(await run(`!!${dlg}`), true, 'saving without a person does nothing');
  await setVal('.tg-import select:not([aria-label])', 'me');
  await click('button', 'Save targets');
  await waitFor(`!${dlg}`, 'saved');
  await paste('Name: Zed Nobody\nTablet  Target 4  Achieved 1');
  assert.deepEqual(await who(), ['me'], 'a name that was confirmed once is recognised next time');
  assert.match(await run(`${dlg}.innerText`), /Recognised from the name or ID/);
  await click('button', 'Discard');
  await paste('Name: Asha Test\nTablet  Target 4  Achieved 1\n\nName: Carlou Test\nWearables  Target 2  Achieved 0');
  assert.deepEqual(await who(), ['asha', 'me'], 'two people in one text: one part each');
  assert.match(await run(`${dlg}.querySelector('button.primary').innerText`), /Save targets \(2 of 2\)/);
  await click('button', 'Discard');
  ok('pasted text finds the person from the name (several people per text too); an unknown name is never guessed, and is remembered once confirmed');
  const shotPath = join(tmpdir(), 'e2e-promoter-shot.png');
  (await import('node:fs')).writeFileSync(shotPath, Buffer.from(screenshot, 'base64'));
  const docNode = (await send('DOM.getDocument')).result;
  const fileNode = (await send('DOM.querySelector', { nodeId: docNode.root.nodeId, selector: '.retail-targets input[type=file]' })).result;
  await send('DOM.setFileInputFiles', { files: [shotPath], nodeId: fileNode.nodeId });
  await waitFor(`!!${dlg}`, 'the screenshot was read', 180000);
  assert.deepEqual(await who(), ['me'], 'the Promoter screenshot says Name: Carlou Test, so it is for Carlou');
  assert.ok(await run(`${dlg}.querySelectorAll('.tg-draft').length>=2`), 'the lines were read');
  await click('button', 'Discard');
  ok('a Promoter screenshot is read offline and is matched to the person named on it');

  // Edit all: every person and segment on one screen
  await click('button', 'Edit all targets and sold');
  await waitFor(`!!document.querySelector('.tg-people-grid')`, 'the Edit all screen');
  const head = await run(`[...document.querySelectorAll('.tg-pcard:first-child .tg-rowname strong')].map(t=>t.textContent.trim())`);
  assert.ok(head.includes('Fold 1') && head.includes('Tablet'), 'every segment has its name in the person card: ' + head.join(','));
  assert.deepEqual(await run(`[...document.querySelectorAll('.tg-pcard:not(.tg-allcard) > .tg-top strong')].map(t=>t.textContent.trim())`), ['Carlou Test', 'Asha Test'], 'a card per person');
  assert.equal(await run(`document.querySelectorAll('.tg-pcard:not(.tg-allcard) .tg-row').length`), head.length * 2, 'every person has a row for every segment');
  assert.equal(await run(`[...document.querySelectorAll('.tg-row input, .tg-rowname strong')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})`), true, 'segment labels and inputs fit the phone viewport');
  await shotRegion('targets-edit-all',`document.querySelector('.tg-pcard')`);
  await setVal('input[aria-label="Target of Asha Test in Fold 1"]', '6');
  await waitFor(`document.querySelector('[data-total="Fold 1"]').textContent.replace(/\\s+/g,'')==='1/11'`, 'column total follows (1 sold of 5 + 6)');
  await setVal('input[aria-label="Sold of Asha Test in Fold 1"]', '2');
  await waitFor(`document.querySelector('[data-total="Fold 1"]').textContent.replace(/\\s+/g,'')==='3/11'`, 'sold total follows');
  await setVal('input[aria-label="Target of Asha Test in Fold 1"]', '5');
  await setVal('input[aria-label="Sold of Asha Test in Fold 1"]', '0');
  await waitFor(`document.querySelector('[data-total="Fold 1"]').textContent.replace(/\\s+/g,'')==='1/10'`, 'put back');
  await setVal('input[aria-label="Target of Carlou Test in Tablet"]', '0');
  await setVal('input[aria-label="Sold of Carlou Test in Tablet"]', '0');
  await waitFor(`document.querySelector('input[aria-label="Target of Carlou Test in Tablet"]').value==='0'`, 'the test line is cleared again');
  assert.equal(await run(`!!document.querySelector('.tg-cell-fin')`), true, 'a finish line under cells that have a target');
  await run(`document.querySelector('button[aria-label="Levels of Carlou Test in Fold 1"]').click()`);
  await waitFor(`!!document.querySelector('input[aria-label="Target of Carlou Test"]')&&!document.querySelector('.tg-people-grid')`, 'Levels opens that segment');
  await click('button', '← All segments');
  await waitFor(`!!document.querySelector('.tg-segs')`, 'back to the list');
  ok('Edit all: labeled segment rows fit the phone, targets and sold save at once, totals follow, and Levels opens the segment');

  // the Records screen shows the person's own segment name
  await nav('Phones');
  await waitFor(`!!document.querySelector('.phone-row')`,'phone rows');
  assert.equal(await run(`document.querySelector('.results .view-head h2').innerText.replace(/\\d+$/,'')`),'Phones');
  assert.ok(await run(`[...document.querySelectorAll('.phone-row .pr-facts')].some(f=>/Segment\\s*Fold 1/.test(f.innerText||f.textContent))`),'S26 phones show Fold 1');
  ok('Phones shows "Fold 1" on the phones of the models placed in it');

  // a short list: model and IMEI per phone, details on tap, tick boxes only in Select mode
  const rowsText=await run(`[...document.querySelectorAll('.phone-row .pr-open')].map(b=>b.innerText.replace(/\\s+/g,' '))`);
  assert.equal(rowsText.length,9); assert.ok(rowsText.every(t=>/\d{8} \d{6} \d/.test(t)),'IMEI in groups: '+rowsText[0]);
  assert.ok(rowsText.some(t=>/Galaxy A17 5G 128GB/.test(t)),'model name and storage: '+rowsText[0]);
  assert.equal(await run(`document.querySelector('.phone-row .pr-more').hidden`),true,'details are closed');
  assert.equal(await run(`document.querySelector('.phone-row .selection-check').hidden`),true,'no tick boxes until Select');
  const phonesText=await body();
  assert.ok(!phonesText.includes('Group IMEIs by person')&&!phonesText.includes('New scans go to'),'the old controls are gone from the list');
  await shot('8-phones');
  await run(`document.querySelector('.phone-row .pr-open').click()`);
  await waitFor(`!document.querySelector('.phone-row.open .pr-more').hidden`,'details open');
  assert.match(await run(`document.querySelector('.phone-row.open .pr-facts').innerText`),/Colour[\s\S]*Segment/);
  await shot('9-phones-open');
  await click('button','Select');
  await waitFor(`!!document.querySelector('.action-bar.show')`,'selection bar');
  await run(`document.querySelector('.phone-row .selection-check').click()`);
  await waitFor(`/Done \\(1 selected\\)/.test(document.body.innerText)`,'one selected');
  await click('button','Done');
  await waitFor(`!document.querySelector('.action-bar.show')`,'selection bar goes away');
  ok('Phones is a short list (model and IMEI in groups), details open on tap, and the selection bar only shows in Select mode');

  // a colour for a phone, from the colours of its model
  const colourOpts=await run(`[...document.querySelector('select[aria-label="Colour of Galaxy A17 5G 128GB"]').options].map(o=>o.textContent)`);
  assert.deepEqual(colourOpts,['Not set','Black','Blue'],'the colours seen on the scanned A17 phones: '+colourOpts);
  await setVal('select[aria-label="Colour of Galaxy A17 5G 128GB"]','Blue',0);
  await waitFor(`/Colour\\s*\\n?\\s*Blue/.test(document.querySelector('.phone-row .pr-facts').innerText)`,'colour saved');
  ok('each phone has a colour dropdown limited to the colours of its model');
  // a person can be made right where people are chosen
  await click('.chip-add','+ Person');
  await waitFor(`!!document.querySelector('input[aria-label="New person name"]')`,'name box');
  await setVal('input[aria-label="New person name"]','Zed Test');
  await click('.quick-person button','Add');
  await waitFor(`/Zed Test/.test(document.querySelector('.person-filters').innerText)`,'the new person is a chip');
  ok('"+ Person" on Phones makes a person with a name, right there');
  await nav('Scan');
  await waitFor(`!!document.querySelector('select[aria-label="New scans go to"]')`,'new scans go to');
  ok('"New scans go to" is on the Scan screen');

  // ---------- Gives: suggestions only ----------
  await nav('Home'); await sub('Give and share');
  await waitFor(`!!document.querySelector('.retail-gives')`,'gives');
  await run(`(()=>{const d=[...document.querySelectorAll('.retail-gives details')].find(d=>d.querySelector('summary')?.textContent==='My target');d.open=true;return true;})()`);
  await setVal('select[aria-label="My target person"]', 'me');
  await waitFor(`/Suggested \\(1\\)/.test(document.querySelector('.retail-gives').innerText)`,'one suggestion');
  assert.match(await run(`document.querySelector('.gv-item').innerText`),/1 × Fold 1 → Carlou Test/);
  assert.equal((await owners()).r8,'','nothing is given until approved');
  await shot('6-gives');
  ok('Gives suggests the unassigned Fold 1 phone to me (my target first) and changes nothing until approved');

  // ---------- Give and share: limits per person, Suggest only / Auto give ----------
  assert.equal(await run(`document.querySelector('.give-tabs.two button[aria-pressed="true"]').innerText`), 'Suggest only', 'Suggest only is the starting mode');
  await run(`(()=>{const d=[...document.querySelectorAll('.retail-gives details')].find(x=>/Limits per person/.test(x.innerText));d.open=true;return true;})()`);
  await waitFor(`!!document.querySelector('input[aria-label="Maximum a day for Carlou Test"]')`, 'the limits');
  await setVal('input[aria-label="Maximum a day for Carlou Test"]', '0');
  await waitFor(`!/→ Carlou Test/.test(document.querySelector('.gv-list').innerText)`, 'a maximum of 0 keeps new phones from me');
  await run(`document.querySelector('input[aria-label="Leave Asha Test out"]').click()`);
  await waitFor(`/Suggested \\(0\\)/.test(document.querySelector('.retail-gives').innerText)`, 'with me at 0 and Asha left out nothing is suggested');
  await setVal('input[aria-label="Minimum a day for Asha Test"]', '2');
  await setVal('input[aria-label="Maximum a day for Asha Test"]', '1');
  await waitFor(`/the maximum wins/.test(document.querySelector('.retail-gives').innerText)`, 'a minimum above the maximum is explained');
  await setVal('input[aria-label="Minimum a day for Asha Test"]', '');
  await setVal('input[aria-label="Maximum a day for Asha Test"]', '');
  await run(`document.querySelector('input[aria-label="Leave Asha Test out"]').click()`);
  await setVal('input[aria-label="Maximum a day for Carlou Test"]', '');
  await waitFor(`/Suggested \\(1\\)/.test(document.querySelector('.retail-gives').innerText)&&/→ Carlou Test/.test(document.querySelector('.gv-list').innerText)`, 'limits cleared: the suggestion is back');
  assert.equal(await run(`document.querySelector('input[aria-label="Maximum a day for Carlou Test"]').value`), '', 'an empty box means no limit');
  ok('each person has a minimum and a maximum a day and can be left out: a maximum of 0 or "left out" stops suggestions, and an empty box means no limit');

  await click('.give-tabs.two button', 'Auto give');
  for (let i = 0; i < 80; i++) { if ((await owners()).r8 === 'me') break; await sleep(250); }
  assert.equal((await owners()).r8, 'me', 'Auto give gave the waiting phone to me by itself');
  assert.equal(await run(`document.querySelector('.give-tabs.two button[aria-pressed="true"]').innerText`), 'Auto give');
  await run(`(()=>{const d=[...document.querySelectorAll('.retail-gives details')].find(x=>/History/.test(x.innerText));d.open=true;return true;})()`);
  await waitFor(`/automatic/.test([...document.querySelectorAll('.retail-gives details')].find(x=>/History/.test(x.innerText)).innerText)`, 'the history says automatic');
  ok('Auto give gives a waiting phone by itself (my target first); the history says "automatic"');
  await click('.retail-gives button', 'Undo');
  for (let i = 0; i < 40; i++) { if ((await owners()).r8 === '') break; await sleep(250); }
  assert.equal((await owners()).r8, '', 'Undo hands the phone back');
  await sleep(4000);
  assert.equal((await owners()).r8, '', 'a phone whose automatic give was undone is not given again by itself');
  ok('Undo of an automatic give sticks: the phone is not given again by itself');
  await click('.give-tabs.two button', 'Suggest only');
  await waitFor(`/Suggested \\(1\\)/.test(document.querySelector('.retail-gives').innerText)`, 'still suggested by hand');
  await click('button','Approve');
  for(let i=0;i<40;i++){if((await owners()).r8==='me')break;await sleep(250);}
  assert.equal((await owners()).r8,'me');
  ok('Approve gives the phone to the person (shown in the history, undoable)');
  await run(`(()=>{const d=[...document.querySelectorAll('.retail-gives details')].find(x=>/History/.test(x.innerText));d.open=true;return true;})()`);
  await click('.retail-gives button','Undo');
  for(let i=0;i<40;i++){if((await owners()).r8==='')break;await sleep(250);}
  assert.equal((await owners()).r8,'');
  ok('Undo puts the phone back');
  // Home: the month outlook (where the month ends at this pace, what to push and what not)
  await nav('Home');
  await waitFor(`!!document.querySelector('.fc-card')`, 'the month outlook');
  const fcText = await run(`document.querySelector('.fc-card').innerText`);
  assert.match(fcText, /Month outlook/); assert.match(fcText, /Too early to project|ends at about \d+%/, 'it says where the month ends, or that it is too early');
  assert.ok(await run(`document.querySelectorAll('.fc-card .fc-line').length>=1`), 'at least one segment line');
  assert.match(fcText, /Push these|Keep the pace|Hard to reach|Done: stop pushing/, 'the lines are grouped by what to do');
  ok('Home shows a month outlook: where each segment ends at this pace and which ones to push or leave');

  // Backup: restoring says what is wrong with a file, tries an empty read again, and the same file can be chosen twice
  await more('Backup');
  await waitFor(`!!document.querySelector('.retail-data input[type=file]')`, 'the backup screen');
  const fsx = await import('node:fs');
  const emptyPath = join(tmpdir(), 'e2e-empty-backup.json'), junkPath = join(tmpdir(), 'e2e-junk.json'), goodPath = join(tmpdir(), 'e2e-good-backup.json');
  fsx.writeFileSync(emptyPath, ''); fsx.writeFileSync(junkPath, '<html>not a backup</html>');
  fsx.writeFileSync(goodPath, JSON.stringify({ app: 'RetailLens', /* the old marker is kept on purpose so older backups still restore */ version: 1, createdAt: '2026-11-17T10:00:00.000Z', state: {}, ledger: [] }));
  const chooseBackup = async path => { const d = (await send('DOM.getDocument')).result; const n = (await send('DOM.querySelector', { nodeId: d.root.nodeId, selector: '.retail-data input[type=file]' })).result; await send('DOM.setFileInputFiles', { files: [path], nodeId: n.nodeId }); };
  const alertText = () => run(`(document.querySelector('.retail-data [role=alert]')||{}).innerText||''`);
  await chooseBackup(emptyPath);
  await waitFor(`/is empty/.test(document.querySelector('.retail-data').innerText)`, 'an empty file is called empty', 30000);
  assert.match(await alertText(), /e2e-empty-backup\.json.*wait a little and choose it again/s, 'it names the file and says what to do');
  await chooseBackup(junkPath);
  await waitFor(`/is not a AI LENS backup/.test(document.querySelector('.retail-data').innerText)`, 'a file that is not a backup is named');
  assert.match(await alertText(), /e2e-junk\.json/);
  await chooseBackup(goodPath);
  await waitFor(`!!document.querySelector('[aria-label="Restore this backup"]')`, 'a good backup is accepted');
  assert.equal(await alertText(), '', 'the old message is gone');
  await click('button', 'Cancel');
  await chooseBackup(goodPath);
  await waitFor(`!!document.querySelector('[aria-label="Restore this backup"]')`, 'the same file can be chosen again');
  await click('button', 'Cancel');
  await chooseBackup(emptyPath);
  await waitFor(`/Reading backup/.test(document.querySelector('.retail-data').innerText)`, 'an empty read is pending');
  await chooseBackup(goodPath);
  await waitFor(`!!document.querySelector('[aria-label="Restore this backup"]')`, 'a new selection replaces the pending read');
  await sleep(5200);
  assert.equal(await alertText(), '', 'the older empty read cannot overwrite the selected backup');
  assert.equal(await run(`!!document.querySelector('[aria-label="Restore this backup"]')`), true, 'the newer backup stays ready');
  await click('button', 'Cancel');
  await run(`window.originalFileText=File.prototype.text;File.prototype.text=function(){return Promise.reject(new Error('unreadable'));}`);
  await chooseBackup(goodPath);
  await waitFor(`/could not be opened/.test(document.querySelector('.retail-data').innerText)`, 'a read failure is distinct from an empty file');
  await run(`File.prototype.text=window.originalFileText;delete window.originalFileText`);
  ok('restore: an empty file, a file that is not a backup and a good backup each get their own clear message, and the same file can be chosen again');
  await nav('Home');
  // Assign by model: typed numbers (no plus / minus), paste keeps the digits, and a number can be copied to everyone
  await more('Give and share'); await click('.give-tabs button','By model');
  await waitFor(`!!document.querySelector('.models-list')`,'assign by model');
  assert.equal(await run(`!!document.querySelector('button[aria-label^="One more"],button[aria-label^="One less"]')`),false,'no plus and minus buttons');
  const giveBox='input[aria-label="How many Galaxy A17 5G for Carlou Test"]';
  await setVal(giveBox,'2 pcs');
  await waitFor(`document.querySelector('${giveBox}').value==='2'`,'digits only');
  await run(`document.querySelector('button[aria-label="Copy the number of Galaxy A17 5G for Carlou Test to everyone"]').click()`);
  await waitFor(`document.querySelector('input[aria-label="How many Galaxy A17 5G for Asha Test"]').value==='2'`,'the number was copied to the next person');
  await click('.confirm-bar button','Reset');
  ok('Assign by model: numbers are typed or pasted (no plus / minus), and "Copy to everyone" gives the same number to all as far as the phones go');

  // ---------- Catalog: a phone marked sold is no longer in stock for the report ----------
  await sub('Catalog');
  await waitFor(`!!document.querySelector('input[aria-label="Select r1.jpg"]')`,'phone list');

  // the colours of a model, typed once in the Catalog
  await setVal('input[aria-label="Search models and segments"]','a17 5g');
  await waitFor(`[...document.querySelectorAll('.retail-catalog .retail-list li')].some(l=>/A17 5G/.test(l.innerText))`,'A17 in the catalog');
  await run(`(()=>{const li=[...document.querySelectorAll('.retail-catalog .retail-list li')].find(l=>/A17 5G/.test(l.innerText)&&[...l.querySelectorAll('button')].some(x=>x.textContent.trim()==='Edit'));[...li.querySelectorAll('button')].find(x=>x.textContent.trim()==='Edit').click();return true;})()`);
  await waitFor(`!!document.querySelector('textarea[aria-label="Colours of this model"]')`,'the colours box');
  await setVal('textarea[aria-label="Colours of this model"]','Graphite = GRPH\ngrey = GRY');
  await click('button','Save');
  await waitFor(`!document.querySelector('textarea[aria-label="Colours of this model"]')`,'saved');
  await run(`(()=>{const li=[...document.querySelectorAll('.retail-catalog .retail-list li')].find(l=>/A17 5G/.test(l.innerText)&&[...l.querySelectorAll('button')].some(x=>x.textContent.trim()==='Edit'));[...li.querySelectorAll('button')].find(x=>x.textContent.trim()==='Edit').click();return true;})()`);
  await waitFor(`!!document.querySelector('textarea[aria-label="Colours of this model"]')`,'reopened');
  assert.equal(await run(`document.querySelector('textarea[aria-label="Colours of this model"]').value`),'Graphite = GRPH\nGray = GRY','one spelling (grey -> Gray), abbreviations kept');
  await click('button','Cancel');
  ok('the colours of a model (and their report abbreviations) are typed once in the Catalog and kept');
  await run(`document.querySelector('input[aria-label="Select r1.jpg"]').click()`);
  await waitFor(`!!document.querySelector('select[aria-label="Stock status"]')`,'bulk bar');
  await setVal('select[aria-label="Stock status"]','sold');
  await click('button','Apply to these phones');
  await sub('Report');
  await waitFor(`/Scanned in the app \\(in stock\\): 8/.test(document.body.innerText)`,'8 in stock');
  assert.ok(await run(`[...document.querySelectorAll('.rep-row')].some(r=>r.innerText.includes('A17 5G 6/128GB')&&/scanned 3/.test(r.innerText))`),'the A17 line now says scanned 3');
  ok('a phone marked sold leaves the stock: the report check counts 8 and the A17 line differs');
  // a phone taken out of stock lowers the matching report line by itself ("from scans since you pasted")
  assert.ok(await run(`[...document.querySelectorAll('.rep-row')].some(r=>r.innerText.includes('A17 5G 6/128GB')&&/-1 from scans since you pasted/.test(r.innerText))`),'the A17 line follows the scans');
  ok('a phone taken out of stock lowers the matching report line by itself, and the line says so');
  // and the sale counts by itself: the Sold of the report line, and the owner's Sold in Targets
  assert.ok(await run(`[...document.querySelectorAll('.rep-row')].some(r=>r.innerText.includes('A17 5G 6/128GB')&&/Sold 1/.test(r.innerText))`),'the report line says Sold 1');
  await nav('Targets');
  await waitFor(`[...document.querySelectorAll('.tg-seg')].some(b=>/^Low/.test(b.innerText.trim())&&/Sold 1 of 0/.test(b.innerText))`,'Low shows Sold 1');
  await sub('Report');
  ok('a phone marked Sold counts by itself: the report line says Sold 1 and the owner\'s Sold in Targets goes up');
  await nav('Targets');
  await waitFor(`[...document.querySelectorAll('.tg-seg')].some(b=>/^Low/.test(b.innerText.trim())&&/today 1/.test(b.innerText))`,'Low shows today 1');
  assert.equal(await run(`[...document.querySelectorAll('button')].some(b=>/^Share summary: pieces per day/.test(b.innerText)&&!b.disabled)`),true,'the summary can be shared');
  ok('Targets shows what was sold today ("today 1") on the segment line');

  // ---------- after sending: "Mark them as Sold?" ----------
  await nav('Phones');
  await click('.select-toggle button','Select');
  await waitFor(`[...document.querySelectorAll('input[aria-label^="Select "]')].some(i=>i.getAttribute('aria-label')!=='Select r1.jpg'&&i.getAttribute('aria-label')!=='Select visible')`,'phone list');
  await click('button','Select visible');
  await run(`navigator.share=async()=>{};true`);
  await click('button','Send numbers');
  await waitFor(`!!document.querySelector('.sold-offer')`,'the Mark as Sold prompt');
  assert.match(await run(`document.querySelector('.sold-offer').innerText`),/Mark them as Sold\?[\s\S]*×[\s\S]*Owner:/,'the prompt lists model, colour and owner');
  await click('.sold-offer button','Not now');
  await waitFor(`!document.querySelector('.sold-offer')`,'prompt closed');
  assert.equal(await run(`document.body.innerText.includes('marked Sold')`),false,'Not now changes nothing');
  // the phone's Back button: closes the popup first, then goes to the screen before
  await click('button','Send numbers');
  await waitFor(`!!document.querySelector('.sold-offer')`,'the prompt for Back');
  await run(`history.back();true`);
  await waitFor(`!document.querySelector('.sold-offer')`,'Back closed the popup');
  assert.equal(await run(`!!document.querySelector('.select-toggle')`),true,'Back from a popup stays on the same screen');
  await run(`history.back();true`);
  await waitFor(`document.querySelectorAll('.tg-seg').length>0`,'Back went to Targets, the screen before Phones');
  ok('Back closes a popup first, then goes to the screen before (it does not leave the app)');
  // Every new upload gets an explicit disposition instead of a sticky Store-only switch.
  await nav('Scan');
  assert.match(await body(), /After scanning, choose Use now, Store for now, or Plan release/);
  ok('Scan explains the explicit per-upload storage choice');
  await nav('Phones');
  await waitFor(`!!document.querySelector('.select-toggle')`,'Phones once more');
  await nav('Phones');
  await waitFor(`!!document.querySelector('.select-toggle')`,'Phones again');
  await run(`navigator.share=async()=>{};true`);
  await click('button','Send numbers');
  await waitFor(`!!document.querySelector('.sold-offer')`,'the prompt again');
  await click('.sold-offer button','Mark as Sold');
  await waitFor(`/phones? marked Sold/.test(document.querySelector('.sold-offer')?.innerText||'')`,'marked');
  await nav('Targets');
  await waitFor(`[...document.querySelectorAll('.tg-seg')].some(b=>/today [2-9]/.test(b.innerText))`,'today went up');
  await nav('Phones');
  await click('.sold-offer button','Undo');
  ok('after sending, the prompt lists what changes; Not now changes nothing; Mark as Sold adds to today in Targets');

  // One model library: shared search, direct model editing, and names used by the scanner too.
  await sub('Catalog');
  await click('button','Import and Samsung catalog tools');
  await waitFor(`document.querySelector('.settings-modal h2')?.textContent==='Model sources'`,'source tools');
  assert.equal(await run(`[...document.querySelectorAll('.settings-modal button')].some(b=>b.textContent.startsWith('Check catalog'))`),true,'downloaded catalog management is retained');
  assert.equal(await run(`[...document.querySelectorAll('.settings-modal button')].some(b=>b.textContent==='Import file…')`),true,'model import is retained');
  await click('.settings-modal .modal-head button','Close');
  await waitFor(`!document.querySelector('.settings-modal')&&!!document.querySelector('.model-manager')`,'return to the model library');
  await sleep(300);
  assert.equal(await run(`document.querySelector('.results .view-head h2').textContent`),'Models & segments','closing source tools keeps the current screen');
  ok('Samsung catalog maintenance and model import remain available inside the consolidated model library');
  await setVal('input[aria-label="Search models and segments"]','A176');
  await waitFor(`document.querySelectorAll('.retail-catalog > section:not([role=dialog]) .retail-list li').length>=1`,'model library result');
  const openA176 = async()=>{await run(`(()=>{const row=[...document.querySelectorAll('.retail-catalog .retail-list li')].find(li=>li.innerText.includes('A176')&&li.querySelector('button'));row.querySelector('button').click();})()`);await waitFor(`!!document.querySelector('[aria-label="Edit model"]')`,'shared model editor');};
  await openA176();
  const oldModelName=await run(`document.querySelector('[aria-label="Edit model"] input:not([disabled])').value`);
  await setLabelVal('Name','Audit Galaxy A17');await click('[aria-label="Edit model"] button','Save');
  assert.equal(await run(`JSON.parse(localStorage.getItem('imei-lens-custom-models'))['A176']`),'Audit Galaxy A17','model editor updates scanner model names');
  await click('button','Import and Samsung catalog tools');
  await waitFor(`!!document.querySelector('#bulk-models')`,'bulk model import');
  await setVal('#bulk-models','SM-A176, Audit imported A17');await click('.settings-modal button','Add all');
  await click('.settings-modal .modal-head button','Close');
  await waitFor(`!document.querySelector('.settings-modal')&&document.querySelector('.retail-catalog').innerText.includes('Audit imported A17')`,'imported names update the shared editor too');
  await openA176();await setLabelVal('Name',oldModelName);await click('[aria-label="Edit model"] button','Save');
  await click('.model-manager .give-tabs button','By segment');
  assert.match(await run(`document.querySelector('.retail-segments').innerText`),/A176/,'the same search works in the segment view');
  await setVal('input[aria-label="Search models and segments"]','');
  await click('button[aria-label="Show fewer details"]','Show less');
  await shotRegion('models-and-segments',`document.querySelector('.model-manager')`);
  ok('one model library searches both views, opens one editor and shares saved model names with the scanner');

  // ---------- Reload: everything persists, scan records untouched ----------
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'reload 2');
  await waitFor(`!!document.querySelector('.bottom-nav')`,'bottom nav after reload');
  await nav('Home'); await sub('Report');
  await waitFor(`!!document.querySelector('.rep-chips')&&document.querySelectorAll('.rep-row').length===4`,'report after reload');
  await sub('Segments');
  await waitFor(`/Fold 1/.test(document.body.innerText)`,'segment after reload');
  ok('after a reload the report, the segment and its models are still there');
  const final=await readDb('record:');
  assert.equal(JSON.stringify(seed.map(r=>{const f=final.find(x=>x.id===r.id);return [f.id,f.imei,f.model,f.dataUrl,f.originalDataUrl,f.name,f.raw];})),before);
  assert.equal(final.length,9);
  ok('the scan records (numbers, models, pictures) were never changed; only owners can change, and they were put back');
}catch(error){
  console.error('FAIL:',error.message);console.error('DB:',(await readDb('record:'))?.length,JSON.stringify((await readDb('retail:state'))?.recordMeta));
  try{console.error('PAGE:',String(await run('document.body.innerText.slice(0,700)')).split(String.fromCharCode(10)).join(' | '));}catch{}
  process.exitCode=1;
}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
console.log(`${results.length} checks passed`);
