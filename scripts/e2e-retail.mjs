// RetailLens plan v2 end to end in headless Edge/Chrome (not part of `npm test`; run `npm run build` first):  node scripts/e2e-retail.mjs
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
const nav=label=>click('.bottom-nav button',label);
const more=async label=>{await run(`document.querySelector('button[aria-label="More"]').click()`);await waitFor(`!!document.querySelector('.more-list')`,'the More menu');await click('.more-list button',label);};
// Home, Report and Targets are on the bottom bar; Gives, Segments, Catalog and Backup are under the ⋯ More menu
const sub=async label=>{if(label==='Today')return nav('Home');if(label==='Report'||label==='Targets')return nav(label);return more(label==='Data'?'Backup':label);};
const shot=async name=>{if(!process.env.SHOTS)return;await sleep(400);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(r.result.data,'base64'));};
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
try{
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('e2e-seeded')){localStorage.setItem('imei-lens-simple-view','false');localStorage.setItem('imei-lens-people-v1',${JSON.stringify(JSON.stringify(people))});localStorage.setItem('e2e-seeded','1');}localStorage.setItem('retaillens-theme-v1','${process.env.THEME||'mint'}');`});
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');for(const r of ${JSON.stringify(seed)})tx.objectStore('inventory').put(r,'record:'+r.id);tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
  // the scanning screen comes first and the brand is RetailLens
  await waitFor(`!!document.querySelector('.bottom-nav')`,'bottom nav');
  assert.match(await run(`document.querySelector('.brand')?.innerText||''`),/RETAILLENS[\s\S]*SCAN\. SELL\. TRACK\. ACHIEVE\./);
  assert.match(await run(`document.title`),/RetailLens/);
  ok('the app is branded RetailLens with the tagline "Scan. Sell. Track. Achieve."');

  // ---------- Report: paste a synthetic report, see it checked against the scanned phones ----------
  await nav('Home');
  await waitFor(`!!document.querySelector('.retail-hub')`,'retail home');
  assert.deepEqual(await run(`[...document.querySelectorAll('.bottom-nav button span')].map(s=>s.textContent)`),['Home','Scan','Phones','Report','Targets','Export'],'the bottom bar');
  assert.equal(await run(`document.querySelector('.results .view-head h2').innerText`),'Home','each screen has its own title');
  assert.ok(!/Scanned records/.test(await run(`document.querySelector('.results').innerText`)),'no "Scanned records" header on Home');
  await run(`document.querySelector('button[aria-label="More"]').click()`);
  await waitFor(`!!document.querySelector('.more-list')`,'More menu');
  assert.deepEqual(await run(`[...document.querySelectorAll('.more-list strong')].map(s=>s.textContent)`),['People','Gives','Segments','Catalog','Assign by model','Share','Backup and data','Settings'],'the More menu');
  await shot('10-more');
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
  await shot('1-report');
  assert.match(await body(),/Sellout in the list: 2 · the report says 3/);
  await click('button','Includes phones not listed');
  await waitFor(`/includes 1 phone not in the list/.test(document.body.innerText)`,'total acknowledged');
  ok('a total that is higher than the list can be marked as including phones that are not listed');

  // tap a line: fix the colours (stock follows), save
  const openRow=text=>run(`(()=>{const r=[...document.querySelectorAll('.rep-row')].find(x=>x.innerText.includes(${JSON.stringify(text)}));if(!r)return false;r.click();return true;})()`);
  assert.equal(await openRow('S26U 256GB'),true);
  await waitFor(`!!document.querySelector('.modal-backdrop .rep-sheet')`,'the line opens as a popup');
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

  // ---------- Targets: level chips and one line per segment ----------
  await sub('Targets');
  await waitFor(`!!document.querySelector('.lvl-chips')`,'level chips');
  assert.deepEqual(await run(`[...document.querySelectorAll('.lvl-chips button')].map(b=>b.textContent)`),['70','80','90','100','110','120']);
  assert.ok(await run(`[...document.querySelectorAll('.tg-seg')].some(b=>b.innerText.includes('Fold 1'))`),'Fold 1 is a line');
  await run(`(()=>{[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).click();return true;})()`);
  await waitFor(`!!document.querySelector('input[aria-label="Target of Carlou Test"]')`,'segment open');
  await setVal('input[aria-label="Target of Carlou Test"]','5');
  await click('button','80');
  await run(`document.querySelector('button[aria-label="One more sold for Carlou Test"]').click()`);
  await waitFor(`/For 80%:[\\s\\S]*needs 3 more[\\s\\S]*\\(4 in total\\)/.test(document.querySelector('.retail-targets').innerText)`,'80% needs 3 more');
  assert.match(await run(`document.querySelector('.tg-person').innerText`),/Sold\s*\n?\s*−\s*1\s*\+/);
  ok('tapping 80 shows 3 more pieces needed for a target of 5 with 1 sold (4 in total), and per day');
  await shot('5-targets-segment');
  await click('button','Edit levels');
  await setVal('input[aria-label="80% pieces for Carlou Test"]','5');
  await waitFor(`/needs 4 more[\\s\\S]*\\(5 in total\\)/.test(document.querySelector('.retail-targets').innerText)`,'typed level wins');
  ok('the pieces typed for a level (from the Promoter screen) win over target x level');
  await click('button','90');
  await waitFor(`/For 90%:[\\s\\S]*needs 4 more/.test(document.querySelector('.retail-targets').innerText)`,'90 uses target x level (4.5 -> 5)');
  ok('a level left blank falls back to target x level, rounded up');
  await click('button','← All segments');
  await waitFor(`!!document.querySelector('.tg-segs')`,'back to the list');
  assert.match(await run(`[...document.querySelectorAll('.tg-seg')].find(b=>b.innerText.includes('Fold 1')).innerText`),/Sold 1 of 5/);
  ok('the segment line adds everyone up: sold 1 of 5');
  await shot('4-targets-lines');

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
  await nav('Home'); await sub('Gives');
  await waitFor(`!!document.querySelector('.retail-gives')`,'gives');
  await run(`(()=>{const d=document.querySelector('.retail-gives details');d.open=true;return true;})()`);
  await setVal('.retail-gives details select',  'me');
  await waitFor(`/Suggested \\(1\\)/.test(document.querySelector('.retail-gives').innerText)`,'one suggestion');
  assert.match(await run(`document.querySelector('.gv-item').innerText`),/1 × Fold 1 → Carlou Test/);
  assert.equal((await owners()).r8,'','nothing is given until approved');
  await shot('6-gives');
  ok('Gives suggests the unassigned Fold 1 phone to me (my target first) and changes nothing until approved');
  await click('button','Approve');
  for(let i=0;i<40;i++){if((await owners()).r8==='me')break;await sleep(250);}
  assert.equal((await owners()).r8,'me');
  ok('Approve gives the phone to the person (shown in the history, undoable)');
  await run(`(()=>{const d=[...document.querySelectorAll('.retail-gives details')].find(x=>/History/.test(x.innerText));d.open=true;return true;})()`);
  await click('.retail-gives button','Undo');
  for(let i=0;i<40;i++){if((await owners()).r8==='')break;await sleep(250);}
  assert.equal((await owners()).r8,'');
  ok('Undo puts the phone back');

  // ---------- Catalog: a phone marked sold is no longer in stock for the report ----------
  await sub('Catalog');
  await waitFor(`!!document.querySelector('input[aria-label="Select r1.jpg"]')`,'phone list');

  // the colours of a model, typed once in the Catalog
  await setVal('input[aria-label="Search models"]','a17 5g');
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
  console.error('FAIL:',error.message);
  try{console.error('PAGE:',String(await run('document.body.innerText.slice(0,700)')).split(String.fromCharCode(10)).join(' | '));}catch{}
  process.exitCode=1;
}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
console.log(`${results.length} checks passed`);
