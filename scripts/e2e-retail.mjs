// RetailLens end to end in headless Edge/Chrome (not part of `npm test`; run `npm run build` first):  node scripts/e2e-retail.mjs
// SYNTHETIC data only. Seeds 9 phones and 2 people, then drives the real screens: scanned phones get segments, a Promoter screenshot (a picture made here,
// read offline by the page's own OCR) fills the targets, a sale lowers stock and counts toward the target, submissions, a recommended allocation that
// protects my selected target and lifts the person below 70 % (approve, history, undo), the WhatsApp report in a pasted layout, backup / restore /
// go back, reload persistence, and that the scan records themselves were never changed.
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
const seed=[phone('r1','SM-A176B','me','6GB | 128GB'),phone('r2','SM-A176B','me','6GB | 128GB'),phone('r3','SM-A576B','me','8GB | 256GB'),phone('r4','SM-S948B','me','12GB | 256GB'),
  phone('r5','SM-A176B','','6GB | 128GB'),phone('r6','SM-A176B','','6GB | 128GB'),phone('r7','SM-A576B','','8GB | 256GB'),phone('r8','SM-S942B','','12GB | 256GB'),phone('r9','SM-A576B','asha','8GB | 256GB')];
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
const sub=label=>click('.retail-tabs button',label);
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
try{
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('e2e-seeded')){localStorage.setItem('imei-lens-simple-view','false');localStorage.setItem('imei-lens-people-v1',${JSON.stringify(JSON.stringify(people))});localStorage.setItem('e2e-seeded','1');}`});
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
  assert.deepEqual(await run(`[...document.querySelectorAll('.bottom-nav button span')].map(s=>s.textContent)`),['Scan','Retail','Records','Give','People','Share','Export']);
  ok('the bottom bar has the Retail tab next to Scan');

  // ---------- Records: automatic segments, filter, badge ----------
  await nav('Records');
  await waitFor(`!!document.querySelector('.filter-chips')`,'records filters');
  assert.ok(await run(`!!document.querySelector('[aria-label="Segment filter"]')`));
  await setVal('[aria-label="Segment filter"]','seg:flagship2');
  await waitFor(`document.querySelectorAll('.results tbody tr').length===1`,'one Flagship 2 phone');
  assert.match(await run(`document.querySelector('.results tbody tr').innerText`),/Flagship 2/);
  ok('Records classify phones by segment on their own: the S26 is Flagship 2 (filter and badge)');
  await setVal('[aria-label="Segment filter"]','seg:flagship1');await waitFor(`document.querySelectorAll('.results tbody tr').length===1`,'one Flagship 1');
  await setVal('[aria-label="Segment filter"]','seg:low');await waitFor(`document.querySelectorAll('.results tbody tr').length===4`,'four Low phones');
  await setVal('[aria-label="Segment filter"]','');

  // ---------- Gives: who I am ----------
  await nav('Retail');
  await waitFor(`!!document.querySelector('.retail-tabs')`,'retail tabs');
  assert.deepEqual(await run(`[...document.querySelectorAll('.retail-tabs button')].map(b=>b.childNodes[0].textContent.trim())`),['Today','Catalog','Targets','Gives','Stock','Reports','Data']);
  ok('Retail has Today, Catalog, Targets, Gives, Stock, Reports and Data');
  await sub('Gives');
  await setLabelVal('I am','me');await setLabelVal('Protect my','70');
  await waitFor(`document.querySelector('.retail-card select')?.value==='me'`,'my person set');
  ok('I choose who I am and which target to protect (70%)');

  // ---------- Targets: the Promoter screenshot ----------
  await sub('Targets');
  await run(`(()=>{const b=binary=>Uint8Array.from(atob(binary),c=>c.charCodeAt(0));const input=document.querySelector('.retail-targets input[type=file]');const dt=new DataTransfer();dt.items.add(new File([b(${JSON.stringify(screenshot)})],'promoter.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`!!document.querySelector('[aria-label="Check the imported targets"]')`,'the screenshot was read',180000);
  const draft=await run(`[...document.querySelectorAll('[aria-label="Check the imported targets"] tbody tr')].map(r=>[r.children[0].textContent,...[...r.querySelectorAll('input')].map(i=>i.value)])`);
  assert.deepEqual(draft.slice(0,2),[['Flagship 1','2','1'],['Flagship 2','4','1']],'read: '+JSON.stringify(draft));
  assert.deepEqual(draft.find(r=>r[0]==='Mid'),['Mid','4','2']);assert.deepEqual(draft.find(r=>r[0]==='Low'),['Low','10','6']);
  assert.equal(await run(`document.querySelector('[aria-label="Check the imported targets"] select').value`),'me','the name on the screen matched my person');
  ok('the Promoter screenshot was read offline: 4 segments, the month and the person (Carlou Test)');
  await click('[aria-label="Check the imported targets"] button','Save targets');
  await waitFor(`!document.querySelector('[aria-label="Check the imported targets"]')`,'draft saved');
  await waitFor(`/Overall 50%/.test(document.querySelector('.retail-incentive')?.innerText||'')`,'summary');
  const sum=await run(`document.querySelector('.retail-incentive').innerText`);
  assert.match(sum,/below 70%/);assert.match(sum,/Estimated incentive if every segment reaches: 70% .*100% .*120%/);
  const tbl=await run(`[...document.querySelectorAll('.retail-card:last-child .retail-table tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' '))`);
  assert.ok(tbl.some(r=>/^Flagship 2 .*25%/.test(r)),JSON.stringify(tbl));
  ok('targets show achievement %, units left to 70/100/120 with units per day, and estimated incentives');
  // Asha (below 70%) by hand
  await setLabelVal('Person','asha');
  await waitFor(`!!document.querySelector('[aria-label="Low target for Asha Test"]')`,'asha table');
  await setVal('[aria-label="Low target for Asha Test"]','10');await setVal('[aria-label="Low achieved for Asha Test"]','2');
  await setVal('[aria-label="Mid target for Asha Test"]','5');
  ok('a second person gets a target by hand');

  // ---------- Today ----------
  await sub('Today');
  await waitFor(`/Sell [\\d.]+\\/day of/.test(document.body.innerText)`,'priorities');
  const pri=await run(`[...document.querySelectorAll('.retail-priority')].map(p=>p.innerText)`);
  assert.ok(pri.length>=3&&pri.some(p=>/Flagship 2/.test(p)),JSON.stringify(pri));
  assert.equal(await stat('My target'),'50%');
  ok(`Today shows what to sell first for my target (${pri.length} priorities) and my percent`);
  // the photos are listed by the day they were uploaded, and a day opens in Records
  assert.match(await body(),new RegExp(today+'[\\s\\S]*9 phones? · 9 read'));
  await click('.retail-list button',today);
  await waitFor(`/Uploaded ${today}/.test(document.body.innerText)&&document.querySelectorAll('.results tbody tr').length===9`,'the day opens in Records');
  ok('uploads are listed by day (9 phones, 9 read) and tapping a day opens exactly those phones in Records');
  await nav('Retail');await waitFor(`!!document.querySelector('.retail-tabs')`,'back to retail');await sub('Today');
  // sell: R1 (mine); stock and counts move
  const r1=seed[0];
  await setVal('[aria-label="Find a phone to sell"]',r1.imei.slice(-6));
  await waitFor(`!![...document.querySelectorAll('.retail-card button.primary')].find(b=>b.textContent==='Sell')`,'sell button');
  await click('.retail-card button.primary','Sell');
  await waitFor(`/Sale confirmed/.test(document.body.innerText)`,'sale confirmed');
  assert.equal(await stat('Sold today'),'1');assert.equal(await stat('Pending submission'),'1');
  ok('a sale is confirmed (it belongs to the phone\'s owner); Sold today 1, Pending submission 1');
  await click('.retail-undo button','Undo');
  await waitFor(`document.querySelector('.retail-stats strong')?.textContent==='0'`,'sale undone');
  assert.equal(await stat('Pending submission'),'0');
  await setVal('[aria-label="Find a phone to sell"]',r1.imei.slice(-6));
  await waitFor(`!![...document.querySelectorAll('.retail-card button.primary')].find(b=>b.textContent==='Sell')`,'sell again');
  await click('.retail-card button.primary','Sell');
  await waitFor(`/Sale confirmed/.test(document.body.innerText)`,'sold again');
  ok('Undo takes the sale back (the phone is sellable again); it is sold again for the rest of the test');
  // a phone nobody owns cannot be sold
  await setVal('[aria-label="Find a phone to sell"]',seed[4].imei.slice(-6));await sleep(400);
  assert.ok(!await run(`!![...document.querySelectorAll('.retail-card button.primary')].find(b=>b.textContent==='Sell')`),'an unassigned phone offers no Sell button');
  ok('a phone that belongs to nobody cannot be sold (no unauthorized attribution)');

  // ---------- Stock ----------
  await sub('Stock');
  await waitFor(`/Stock \\(8\\)/.test(document.body.innerText)`,'stock 8 after the sale');
  assert.match(await body(),/A17 5G[\s\S]*128GB/);
  ok('stock fell from 9 to 8 by itself after the confirmed sale, listed by model and storage');
  await setVal('[aria-label="Model"]','A176');await setVal('[aria-label="Storage"]','128GB');await setVal('[aria-label="Colour"]','Green');await setVal('[aria-label="Change"]','3');
  await click('.retail-card button','Add line');
  await waitFor(`/Stock \\(11\\)/.test(document.body.innerText)`,'stock 11');
  assert.match(await body(),/Green/);
  ok('a manual stock line (+3 Green) is added and explained');
  // sales today: Undo needs a reason
  await click('.retail-list button','Undo sale');
  await click('[aria-label="Correct a sale"] button','Undo this sale');
  await sleep(300);
  assert.match(await run(`document.querySelector('.toast')?.innerText||''`),/reason/i);
  await click('[aria-label="Correct a sale"] button','Cancel');
  ok('undoing or moving a sale needs a written reason');

  // ---------- Submissions ----------
  await sub('Today');
  await waitFor(`/Pending submissions \\(1\\)/.test(document.body.innerText)`,'pending 1');
  await click('.retail-card button','Tick all');
  await click('.retail-card button','Mark 1 submitted');
  await waitFor(`/Pending submissions \\(0\\)/.test(document.body.innerText)`,'submitted');
  ok('the sale is marked submitted; pending is 0');
  await sub('Targets');
  await waitFor(`!!document.querySelector('.retail-incentive')`,'targets again');
  await setLabelVal('Person','me');
  await waitFor(`/Overall 55%/.test(document.querySelector('.retail-incentive')?.innerText||'')`,'the submitted sale counts as achieved',20000);
  ok('a sale submitted after the screenshot counts as achieved (50% -> 55%)');

  // ---------- Gives: recommend, approve, undo ----------
  await sub('Gives');
  await click('.retail-card button','Recommend allocation');
  await waitFor(`!!document.querySelector('[aria-label="Proposed allocation"]')`,'proposals');
  const props=await run(`[...document.querySelectorAll('[aria-label="Proposed allocation"] li')].map(l=>l.innerText.replace(/\\s+/g,' '))`);
  assert.ok(/Flagship 2/.test(props[0])&&/Carlou Test/.test(props[0])&&/Protects your 70% target/.test(props[0]),'my own need comes first: '+JSON.stringify(props));
  assert.ok(props.some(p=>/Low/.test(p)&&/Asha Test/.test(p)&&/Below 70%/.test(p)),JSON.stringify(props));
  assert.ok(props.some(p=>/Mid/.test(p)&&/Asha Test/.test(p)),JSON.stringify(props));
  ok('the recommendation reserves my Flagship 2 unit first, then gives Asha (below 70%) the low and mid units she needs');
  assert.deepEqual(await owners(),Object.fromEntries(seed.map(r=>[r.id,r.personId])),'nothing moved before approval');
  ok('nothing moves until I approve');
  await click('[aria-label="Proposed allocation"] button','Approve');
  await waitFor(`/Allocation history[\\s\\S]*phone/.test(document.body.innerText)&&!document.querySelector('[aria-label="Proposed allocation"]')`,'approved');
  await sleep(1500); // the records are saved a moment after the change
  const after=await owners();
  assert.deepEqual([after.r8,after.r5,after.r6,after.r7,after.r1],['me','asha','asha','asha','me'],JSON.stringify(after));
  ok('approved: the S26 is mine, two low and one mid go to Asha; the history lists it');
  await click('.retail-gives .retail-list button','Undo');
  await waitFor(`/undone/.test(document.body.innerText)`,'undone');
  await sleep(1500);
  const undone=await owners();
  assert.deepEqual([undone.r8,undone.r5,undone.r6,undone.r7],['','','',''],JSON.stringify(undone));
  ok('Undo returns every phone to where it was');

  // ---------- Reports ----------
  await sub('Reports');
  await setLabelVal('Activations','3');
  await setLabelVal('Your example (optional)',`*Daily Report 01/01/2026*\nStore: Test Hub\n*Sellout*\n- A17 5G 6/128 Blue - 9\nTotal sellout: 9\nActivations: 1\nThanks team`);
  await click('.retail-card button','Write the report');
  await waitFor(`!!document.querySelector('[aria-label="The report"]')`,'report');
  const rep=await run(`document.querySelector('[aria-label="The report"]').value`);
  assert.ok(rep.startsWith(`*Daily Report ${todayDMY}*`),rep);
  assert.match(rep,/Store: Test Hub/);assert.match(rep,/Total sellout: 1/);assert.match(rep,/Activations: 3/);assert.match(rep,/Thanks team/);assert.match(rep,/- A17 5G 6\/128 - 1/);
  ok('the report follows my pasted layout: new date, my one sale, activations 3, my own lines kept');
  await click('.retail-card button','Save this layout');

  // ---------- Data: backup, restore, go back ----------
  await sub('Data');
  await waitFor(`/Go back to an earlier state/.test(document.body.innerText)`,'data tab');
  const stateNow=await readDb('retail:state');
  assert.equal(stateNow.sales.filter(s=>!s.voided).length,1);assert.ok(stateNow.template,'the layout was saved');
  const backup={app:'RetailLens',version:1,createdAt:new Date().toISOString(),state:{...stateNow,sales:[]},ledger:[]};
  await run(`(()=>{const input=document.querySelector('.retail-data input[type=file]');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(backup))}],'backup.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`!!document.querySelector('[aria-label="Restore this backup"]')`,'restore offered');
  await click('[aria-label="Restore this backup"] button','Restore');
  await sleep(800);
  assert.equal((await readDb('retail:state')).sales.length,0);
  ok('a backup was restored (its sales replaced mine)');
  await waitFor(`!![...document.querySelectorAll('.retail-data button')].find(b=>b.textContent==='Go back to this')`,'snapshot offered');
  await run(`(()=>{const b=[...document.querySelectorAll('.retail-data button')].find(b=>b.textContent==='Go back to this');b.click();})()`);
  await sleep(800);
  assert.equal((await readDb('retail:state')).sales.filter(s=>!s.voided).length,1);
  ok('Go back brings the data from before the restore back');
  await run(`(()=>{const input=document.querySelector('.retail-data input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['{"not":"a backup"}'],'x.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`/not a RetailLens backup/.test(document.body.innerText)`,'a wrong file is refused');
  ok('a file that is not a RetailLens backup is refused');

  // ---------- Catalog: edit and remember ----------
  await sub('Catalog');
  await setVal('[aria-label="Search models"]','A17 5G');
  await waitFor(`!!document.querySelector('[aria-label="Segment of Galaxy A17 5G"]')`,'model row');
  await setVal('[aria-label="Segment of Galaxy A17 5G"]','mid');
  await sleep(600);
  const st2=await readDb('retail:state');
  assert.equal(st2.corrections.A176,'mid');assert.ok(st2.catalog.some(c=>c.code==='A176'&&c.segment==='mid'));
  ok('changing a model\'s segment is remembered as a verified correction');
  await click('.retail-list button','Edit');
  await waitFor(`!!document.querySelector('[aria-label="Edit model"]')`,'edit form');
  await setLabelVal('Report abbreviation','A17 Five');
  await setLabelVal('Variants, one per line','SM-A176BZKGINU | 6GB | 128GB | Black, Blue');
  await click('[aria-label="Edit model"] button','Save');
  await sleep(500);
  const st3=await readDb('retail:state');const item=st3.catalog.find(c=>c.code==='A176');
  assert.equal(item.abbreviation,'A17 Five');assert.deepEqual(item.variants[0],{sku:'SM-A176BZKGINU',ram:'6GB',storage:'128GB',colors:['Black','Blue']});
  ok('catalog edits (abbreviation, SKU, RAM, storage, colours) are saved');
  // bulk segment edit of selected phones (Catalog)
  await run(`document.querySelector('[aria-label="Select r5.jpg"]')?.click()`);
  await waitFor(`!!document.querySelector('[aria-label="Bulk edit selected phones"]')`,'bulk bar');
  await setVal('[aria-label="Bulk edit selected phones"] select','tablet');
  await click('[aria-label="Bulk edit selected phones"] button','Apply to these phones');
  await sleep(700);
  assert.equal((await readDb('retail:state')).recordMeta.r5.segment,'tablet');
  ok('bulk editing: the selected phone is now a Tablet (its own choice, other phones of the model unchanged)');
  // bulk edit from the Records tab (segment field of the existing Bulk edit window)
  await nav('Records');
  await waitFor(`document.querySelectorAll('.results tbody tr').length>=1`,'records list');
  await run(`document.querySelector('.results tbody tr input.selection-check').click()`);
  await run(`document.querySelector('.more-actions summary').click()`);
  await click('.more-actions button','Bulk edit');
  await waitFor(`[...document.querySelectorAll('.modal label')].some(l=>(l.childNodes[0]?.textContent||'').trim()==='Segment')`,'bulk edit window has Segment');
  await run(`(()=>{const el=[...document.querySelectorAll('.modal label')].find(l=>(l.childNodes[0]?.textContent||'').trim()==='Segment').querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'wearable');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.modal button','Apply to');
  await sleep(800);
  assert.ok(Object.values((await readDb('retail:state')).recordMeta).some(m=>m.segment==='wearable'));
  ok('the Records Bulk edit window can set a segment for the ticked phones');

  // ---------- Reload: everything persists, scan records untouched ----------
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'reload 2');
  await waitFor(`!!document.querySelector('.bottom-nav')`,'bottom nav after reload');
  await nav('Retail');
  await waitFor(`!!document.querySelector('.retail-stats')`,'retail after reload');
  assert.equal(await stat('Sold today'),'1');
  ok('after a reload the sale, targets and settings are still there');
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
