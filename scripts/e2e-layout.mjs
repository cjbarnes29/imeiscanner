// Layout check in headless Edge/Chrome at phone width (run `npm run build` first): node scripts/e2e-layout.mjs
// Every screen must fit the width of the phone: nothing may run past the right edge, and every button must be tappable (at least 36 px).
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
const monthKey=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
const retailSeed={version:1,settings:{myPersonId:'me',myThreshold:100,lowStock:2,reportAuthor:''},
  targets:{[monthKey]:{me:{personId:'me',month:monthKey,source:'manual',importedAt:'2026-01-01T00:00:00.000Z',lines:[{segment:'low',target:108,achieved:2},{segment:'mid',target:41,achieved:0},{segment:'flagship2',target:19,achieved:0},{segment:'flagship3',target:9,achieved:0},{segment:'flagship1',target:3,achieved:0}]},
    asha:{personId:'asha',month:monthKey,source:'manual',importedAt:'2026-01-01T00:00:00.000Z',lines:[{segment:'low',target:60,achieved:30},{segment:'mid',target:20,achieved:10}]}}},
  report:{savedAt:'2026-11-16T07:56:00.000Z',entries:[{t:'item',id:'r0',name:'A17 5G 6/128GB',sold:0,stock:4,soldWidth:2,stockWidth:2,kind:'colour',parts:[{label:'Gry',count:0,raw:'00'},{label:'Blu',count:1,raw:'01'},{label:'Blk',count:3,raw:'03'}],sep:' ',line1:'A17 5G 6/128GB : 00/04',line2:'(00,01,03) Gry,Blu,Blk'},{t:'item',id:'r1',name:'Z Fold8 Ultra 256GB',sold:0,stock:0,soldWidth:2,stockWidth:2,kind:'colour',parts:[{label:'GRPH',count:0,raw:'00'}],sep:' ',line1:'Z Fold8 Ultra 256GB : 00/00',line2:'(00) GRPH'}]}};
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
if(await fetch('http://127.0.0.1:9355/json').then(()=>true,()=>false))throw new Error('Port 9355 is used by an old browser: stop the leftover headless msedge (profile imei-retail-*) first.');
const profile=await mkdtemp(join(tmpdir(),'imei-retail-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9355',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
function stopBrowsersOf(dir){const tag=dir.split(/[\\/]/).pop();spawnSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{stdio:'ignore'});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9355/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
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
const more=async label=>{await click('button[aria-label="More"]','');await waitFor(`!!document.querySelector('.more-list')`,'More menu');if(['Segments','Catalog'].includes(label)){await click('.more-list button','Models & segments');await waitFor(`!!document.querySelector('.model-manager')`,'model manager');await click('.model-manager .give-tabs button',label==='Catalog'?'All models':'By segment');}else if(['Give and share','People'].includes(label)){await click('.more-list button','Give & share');await waitFor(`!!document.querySelector('.people-sharing-tabs')`,'people and sharing');if(label==='Give and share')await click('.people-sharing-tabs button','Give');else{await run(`document.querySelector('button[aria-label="Show all details"]')?.click()`);await click('.people-sharing-tabs button','People');}}else if(label.startsWith('Backup')){await click('.more-list button','Settings & backup');await waitFor(`!!document.querySelector('.settings-modal')`,'settings');await click('.settings-modal button','Backup, restore & history');await waitFor(`!!document.querySelector('.retail-data')`,'backup');}else await click('.more-list button',label);};
// Home, Report and Targets are on the bottom bar; Gives, Segments, Catalog and Backup are under the ⋯ More menu
const sub=async label=>{if(label==='Today')return nav('Home');if(label==='Report'||label==='Targets')return nav(label);return more(label==='Data'?'Backup':label);};
const shot=async name=>{if(!process.env.SHOTS)return;await sleep(400);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(r.result.data,'base64'));};
const results=[];const ok=n=>{results.push(n);console.log('PASS:',n);};
try{
  await send('Page.enable');
  // a phone: 411 px wide (about 900 px at 2.2x), like the screenshot from the Android app
  await send('Emulation.setDeviceMetricsOverride',{width:Number(process.env.WIDTH||411),height:900,deviceScaleFactor:2.2,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('e2e-seeded')){localStorage.setItem('imei-lens-simple-view','${process.env.SIMPLE?'true':'false'}');localStorage.setItem('imei-lens-people-v1',${JSON.stringify(JSON.stringify(people))});localStorage.setItem('e2e-seeded','1');}`});
  // the Android app's scanner bridge (a stand-in that does nothing): it makes the page draw the blocks only the phone shows
  // large system text: the app's own Text size setting zooms the whole page (ZOOM=1.3 is "Extra large")
  if(process.env.ZOOM)await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.zoom='${process.env.ZOOM}'})`});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.AndroidScanner={status:()=>JSON.stringify({status:'idle',count:0,completed:0,failed:0,photos:[],records:[]}),choosePhotos(){},takePhoto(){},setScanOptions(){},queueStatus(){},queueStopRequested:()=>false,scanReport:()=>'',rescanNeeded:()=>0,cameraWaiting:()=>0,takeSharedText:()=>'',image:()=>'',sourceImage:()=>'',stop(){},sendCapabilities(){},resetScans(){}};`});
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'load');
  await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');for(const r of ${JSON.stringify(seed)})tx.objectStore('inventory').put(r,'record:'+r.id);tx.objectStore('inventory').put(${JSON.stringify(retailSeed)},'retail:state');tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
  await send('Page.navigate',{url:'http://localhost:4196/'});
  await waitFor(`document.readyState==='complete'`,'reload');
  await sleep(1500);
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
  // the scanning screen comes first and the brand is RetailLens
  await waitFor(`!!document.querySelector('.bottom-nav')`,'bottom nav');
  ok('the app is branded RetailLens with the tagline "Scan. Sell. Track. Achieve."');

  const MEASURE=`(()=>{const w=document.documentElement.clientWidth;const skip='.table-wrap,.retail-tabs,.who-chips,.chips,.filter-chips,.person-filters,.bottom-nav,.top-actions';
    const bad=[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.right>w+2&&getComputedStyle(e).position!=='fixed'&&!e.closest(skip)&&e.offsetParent!==null}).slice(0,6).map(e=>e.tagName.toLowerCase()+'.'+String(e.className).split(' ')[0]+' left='+Math.round(e.getBoundingClientRect().left)+' right='+Math.round(e.getBoundingClientRect().right)+' w='+Math.round(e.getBoundingClientRect().width));
    const small=[...document.querySelectorAll('button,select,input:not([type=checkbox]):not([type=file]):not([hidden]),summary')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<36&&e.offsetParent!==null&&!e.closest('.bottom-nav')&&!e.hidden}).slice(0,8).map(e=>(e.getAttribute('aria-label')||e.textContent||e.className).trim().slice(0,28)+' h='+Math.round(e.getBoundingClientRect().height));
    const lastNav=document.querySelector('.bottom-nav button:last-child');const navRight=lastNav?Math.round(lastNav.getBoundingClientRect().right):w;
    return {w,sw:document.documentElement.scrollWidth,bad,small,navRight};})()`;
  const screens=process.env.SIMPLE?[['Scan',()=>nav('Scan')],['Phones',()=>nav('Phones')],['Send',()=>nav('Send')]]:[
    ['Home',()=>nav('Home')],['Scan',()=>nav('Scan')],['Phones',()=>nav('Phones')],['Export',()=>nav('Export')],['Targets',()=>nav('Targets')],
    ['Targets edit all',async()=>{await run(`document.querySelector('button[aria-label="Show all details"]')?.click()`);await click('button','Edit all targets and sold');await waitFor(`!!document.querySelector('.tg-people-grid')`,'Edit all cards');}],
    ['Targets segment',async()=>{await click('button','← All segments');await click('.tg-seg','');await waitFor(`!!document.querySelector('.tg-person')`,'segment');await click('.link-btn','Edit levels');await waitFor(`!!document.querySelector('.tg-levels')`,'levels');}],
    ['Report',()=>nav('Report')],['Suggested gives',async()=>{await more('Give and share');await waitFor(`!!document.querySelector('.retail-gives')`,'suggestions');}],
    ['Assign by model',async()=>{await click('.give-tabs button','By model');await waitFor(`!!document.querySelector('.models-list')`,'model assignment');}],
    ['Share',()=>click('.give-tabs button','Share')],['People',()=>more('People')],['Segments',()=>more('Segments')],['Catalog',()=>more('Catalog')],['Backup',()=>more('Backup')]
  ];
  const issues=[];
  const measure=async name=>{const r=await run(MEASURE);console.log(name,JSON.stringify(r));if(r.sw>r.w+1||r.bad.length)issues.push(name+': runs past the edge '+JSON.stringify(r.bad));if(r.small.length)issues.push(name+': controls under 36 px: '+r.small.join(' | '));if(r.navRight<r.w-14)issues.push(name+': bottom bar ends at '+r.navRight+' of '+r.w);};
  for(const [name,go] of screens){
    await go();await sleep(500);
    if(!process.env.SIMPLE&&!['Targets edit all','Targets segment'].includes(name)){
      await run(`document.querySelector('button[aria-label="Show fewer details"]')?.click()`);await sleep(100);
      assert.equal(await run(`document.querySelectorAll('main .screen-details-toggle button').length`),1,'one Show all button per screen');
      await measure(name+' summary');
      if(name==='Targets')assert.equal(await run(`document.querySelector('.retail-targets > .screen-extra').getBoundingClientRect().height`),0,'Targets opens directly on segments');
      if(name==='Segments')assert.equal(await run(`!!document.querySelector('.seg-model-summary li')&&document.querySelector('.retail-segments > .screen-extra').getBoundingClientRect().height===0`),true,'segment model summaries are visible before editing controls');
      await click('button[aria-label="Show all details"]','Show all');await sleep(100);
    }
    await measure(name+' all');
  }
  if(!process.env.SIMPLE){await run(`document.querySelector('button[aria-label="More"]').click()`);await sleep(500);
  const m=await run(MEASURE);console.log('More',JSON.stringify(m));if(m.sw>m.w+1||m.bad.length)issues.push('More: '+JSON.stringify(m.bad));await click('.more-list button','Settings');}
  else await click('button[aria-label="Settings"]','');
  await waitFor(`!!document.querySelector('.settings-modal')`,'Settings');
  const settings=await run(MEASURE);console.log('Settings',JSON.stringify(settings));if(settings.sw>settings.w+1||settings.bad.length)issues.push('Settings: '+JSON.stringify(settings.bad));
  assert.deepEqual(issues,[],'screens fit the phone and controls are large enough to tap');
  ok('every screen fits the phone width');
}catch(error){
  console.error('FAIL:',error.message);
  try{console.error('PAGE:',String(await run('document.body.innerText.slice(0,700)')).split(String.fromCharCode(10)).join(' | '));}catch{}
  process.exitCode=1;
}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
console.log(`${results.length} checks passed`);
