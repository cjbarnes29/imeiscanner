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
const seed=Array.from({length:68},(_,i)=>phone('r'+(i+1),i<45?'SM-S948B':'SM-A576B','me',i<45?'12GB | 256GB\nColour: Black':'8GB | 256GB\nColour: Navy'));
const before=JSON.stringify(seed.map(r=>[r.id,r.imei,r.model,r.dataUrl,r.originalDataUrl,r.name,r.raw]));
const people=[{id:'me',label:'Person 1',name:'Carlou Demo'},{id:'asha',label:'Person 2',name:'Asha Demo'}];
const now=new Date();const monthName=now.toLocaleString('en-US',{month:'long'});
const pad=n=>String(n).padStart(2,'0');const today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;const todayDMY=`${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
// the Promoter screen (synthetic): a picture of text, read offline by the page
const lines=['Samsung Promoter','Name: Carlou Test',`${monthName} ${now.getFullYear()}  Target vs Achievement`,'Flagship 1   Target 2   Achieved 1   50%','Flagship 2   Target 4   Achieved 1   25%','Mid   Target 4   Achieved 2   50%','Low   Target 10   Achieved 6   60%'];
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${120+lines.length*70}"><rect width="100%" height="100%" fill="#ffffff"/>${lines.map((l,i)=>`<text x="40" y="${80+i*70}" font-family="Arial" font-size="42" fill="#000">${l}</text>`).join('')}</svg>`);
const screenshot=(await sharp(svg).png().toBuffer()).toString('base64');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.gz':'application/gzip','.traineddata':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4198);
if(await fetch('http://127.0.0.1:9358/json').then(()=>true,()=>false))throw new Error('Port 9358 is used by an old browser: stop the leftover headless msedge (profile imei-retail-*) first.');
const profile=await mkdtemp(join(tmpdir(),'imei-retail-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9358',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
function stopBrowsersOf(dir){const tag=dir.split(/[\\/]/).pop();spawnSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{stdio:'ignore'});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9358/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
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
const more=async label=>{await run(`document.querySelector('button[aria-label="More"]').click()`);await waitFor(`!!document.querySelector('.more-list')`,'the More menu');if(['Segments','Catalog'].includes(label)){await click('.more-list button','Models & segments');await waitFor(`!!document.querySelector('.model-manager')`,'model manager');await click('.model-manager .give-tabs button',label==='Catalog'?'All models':'By segment');}else if(['Give and share','People'].includes(label)){await click('.more-list button','People & sharing');await waitFor(`!!document.querySelector('.people-sharing-tabs')`,'people and sharing');if(label==='Give and share')await click('.people-sharing-tabs button','Suggested');}else if(label.startsWith('Backup')){await click('.more-list button','Settings & backup');await waitFor(`!!document.querySelector('.settings-modal')`,'settings');await click('.settings-modal button','Backup, restore & history');await waitFor(`!!document.querySelector('.retail-data')`,'backup screen');}else await click('.more-list button',label);await expandScreen();};
// Home, Report and Targets are on the bottom bar; Gives, Segments, Catalog and Backup are under the ⋯ More menu
const sub=async label=>{if(label==='Today')return nav('Home');if(label==='Report'||label==='Targets')return nav(label);return more(label==='Data'?'Backup':label);};
const shot=async name=>{if(!process.env.SHOTS)return;await sleep(400);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(r.result.data,'base64'));};
const shotRegion=async(name,expr)=>{if(!process.env.SHOTS)return;await sleep(500);await run(`document.querySelectorAll('.bottom-nav,.toast').forEach(e=>e.style.visibility='hidden')`);try{const clip=await run(`(()=>{const r=(${expr}).getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(r.result.data,'base64'));}finally{await run(`document.querySelectorAll('.bottom-nav,.toast').forEach(e=>e.style.removeProperty('visibility'))`);}};

const {mkdir,writeFile}=await import('node:fs/promises');
const out='phase2-results/release-planner';await mkdir(out,{recursive:true});
const errors=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
const capture=async name=>{await sleep(250);await run(`window.scrollTo(0,0);document.querySelector('.toast')?.style.setProperty('visibility','hidden')`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name+'.png'),Buffer.from(r.result.data,'base64'));};
const tap=async(text)=>{const yes=await run(`(()=>{const b=[...document.querySelectorAll('.bottom-nav button'),...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.childNodes[0]?.textContent?.trim()===${JSON.stringify(text)})&&!b.disabled&&b.getBoundingClientRect().width);if(!b)return false;b.click();return true;})()`);assert.ok(yes,'button '+text);await sleep(160);};
try{
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:411,height:900,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:'http://localhost:4198/'});await sleep(700);
const state={version:1,settings:{myPersonId:'me',myThreshold:100,lowStock:2,reportAuthor:''},soldLedger:{},catalog:[],aliases:{},corrections:{},sales:[],allocations:[],days:{},stockAdjust:[],history:{},audit:[],recordMeta:Object.fromEntries(seed.map((r,i)=>[r.id,{status:'held',segment:i<45?'flagship1':'mid'}])),targets:{[today.slice(0,7)]:{me:{personId:'me',month:today.slice(0,7),source:'manual',importedAt:new Date().toISOString(),lines:[{segment:'flagship1',target:100,achieved:40,cap:100},{segment:'mid',target:50,achieved:25,cap:100}]}}},report:{savedAt:new Date().toISOString(),entries:[{t:'item',id:'demo1',name:'S26 Ultra 256GB',sold:0,stock:45,soldWidth:2,stockWidth:2,kind:'none',parts:[],sep:' ',line1:'S26 Ultra 256GB : 00/45',line2:''},{t:'item',id:'demo2',name:'A57 5G 256GB',sold:0,stock:23,soldWidth:2,stockWidth:2,kind:'none',parts:[],sep:' ',line1:'A57 5G 256GB : 00/23',line2:''}]}};
await run(`localStorage.setItem('imei-lens-simple-view','false');localStorage.setItem('imei-lens-people-v1',${JSON.stringify(JSON.stringify(people))});localStorage.setItem('retaillens-theme-v1','mint');new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const t=db.transaction('inventory','readwrite');const s=t.objectStore('inventory');s.put(${JSON.stringify(state)},'retail:state');for(const r of ${JSON.stringify(seed)})s.put(r,'record:'+r.id);t.oncomplete=()=>{db.close();res(true);};};})`);
await send('Page.navigate',{url:'http://localhost:4198/'});await sleep(1100);
await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));b?.click();})()`);
await tap('Home');await capture('01-home');
await tap('Open plan →');await waitFor(`!!document.querySelector('.release-planner')`,'planner');
await tap('+ Create or adjust plan');await capture('02-create-plan');
await tap('Calculate & review →');await capture('03-review-proposal');
await tap('Approve plan · 40 IMEIs');await capture('04-daily-plan');
await tap('Review release');await capture('05-confirm-release');
await tap('Confirm 30 as sold');await capture('06-release-receipt');
let saved=await readDb('retail:state');assert.equal(saved.targets[today.slice(0,7)].me.lines[0].achieved,70);assert.equal(saved.releases[0].reportedIds.length,0);assert.equal(saved.releases[0].recordIds.length,30);
await tap('Report');await tap('Copy report');await capture('07-report-quantities');
await run(`(()=>{const el=document.querySelector('input[aria-label="Report quantity for Flagship 1"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'20');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);await capture('08-partial-report');
await tap('Prepare report');await sleep(400);saved=await readDb('retail:state');assert.equal(saved.releases[0].reportedIds.length,20);assert.equal(saved.targets[today.slice(0,7)].me.lines[0].achieved,70);
await tap('Phones');await tap('Stored (38)');await capture('09-stored');
await tap('Home');await capture('10-home-updated');await tap('Open plan →');await tap('✦ Ask AI');await capture('11-local-ai');
if(process.env.CHECK_AI){
await run(`document.querySelector('.plan-local-ai input[type=checkbox]').click()`);await sleep(200);await tap('Download & check model');
for(let n=0;n<240;n++){const status=await run(`document.querySelector('.plan-ai-status')?.textContent||''`);if(n%15===0)console.log('AI:',status);if(/unavailable|could not|error|failed/i.test(status))throw new Error(status);if(/Model loaded/.test(status))break;if(n===239)throw new Error('AI download timed out: '+status);await sleep(1000);}
await tap('Suggest a plan');
for(let n=0;n<180;n++){const status=await run(`document.querySelector('.plan-ai-status')?.textContent||''`);if(n%20===0)console.log('AI:',status);if(/unavailable|could not|error|failed/i.test(status))throw new Error(status);if(await run(`!!document.querySelector('.plan-ai-output')`))break;if(n===179)throw new Error('AI generation timed out: '+status);await sleep(1000);}
console.log('AI RESULT:',await run(`document.querySelector('.plan-ai-output')?.innerText`));await capture('13-local-ai-result');
}
await tap('Close');
await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false,'no horizontal overflow at 360px');
await send('Emulation.setDeviceMetricsOverride',{width:411,height:900,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:'http://localhost:4198/'});await sleep(800);saved=await readDb('retail:state');assert.equal(saved.releases[0].reportedIds.length,20,'partial reporting survives reload');assert.equal(saved.releasePlans.length,1,'plan survives reload');assert.equal((await readDb('record:')).length,68,'all scanned records preserved');
await run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const t=db.transaction('inventory','readwrite'),st=t.objectStore('inventory'),q=st.get('retail:state');q.onsuccess=()=>st.put({...q.result,pendingUploadIds:['r68']},'retail:state');t.oncomplete=()=>{db.close();res(true);};};})`);
await send('Page.navigate',{url:'http://localhost:4198/'});await sleep(800);await waitFor(`!!document.querySelector('[aria-label="Where should these phones go?"]')`,'saved upload choice');await capture('12-upload-choice');await tap('Store for now');await sleep(200);saved=await readDb('retail:state');assert.equal(saved.pendingUploadIds.length,0);assert.equal(saved.recordMeta.r68.status,'held','store decision survives reload');

// Dated drafts stay separate from actual stock and warn on manual mismatches.
await tap('Report');await tap('Dated drafts');await waitFor(`!!document.querySelector('.dated-reports')`,'dated drafts');
assert.match(await body(),/Stock and sold figures match/);
await run(`(()=>{const el=document.querySelector('select[aria-label="Report draft mode"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'manual');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(100);
await run(`(()=>{const el=document.querySelector('input[aria-label="Draft stock for Flagship 1"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'16');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(120);assert.match(await body(),/Report figures do not match/);await capture('14-dated-report-warning');await tap('Save dated draft');await sleep(100);saved=await readDb('retail:state');assert.equal(saved.targets[today.slice(0,7)].me.lines[0].achieved,70);assert.equal(saved.releases[0].reportedIds.length,20);
// Duration, Auto / Manual daily quantities, upcoming days, and Home decisions.
await tap('Home');await tap('Open plan →');await tap('+ Create or adjust plan');
await run(`(()=>{const el=[...document.querySelectorAll('.plan-modal label')].find(l=>l.firstChild?.textContent.includes('Target percentage'))?.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'90');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await run(`(()=>{const el=document.querySelector('select[aria-label="Plan duration"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'days');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(80);
await run(`(()=>{const el=document.querySelector('input[aria-label="Number of plan days"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'3');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);await capture('15-duration-controls');
await run(`(()=>{const el=document.querySelector('select[aria-label="Daily quantity mode"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'manual');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(100);await capture('16-manual-daily');
await run(`(()=>{const el=document.querySelector('select[aria-label="Daily quantity mode"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'calculated');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(80);
await tap('Calculate & review →');await tap('Approve plan · 35 IMEIs');await tap('Home');await capture('18-home-upcoming');assert.match(await body(),/Release today/);assert.match(await body(),/Not today/);assert.match(await body(),/UPCOMING/);
// Interactive tutorials operate only on demo state, including a simulated sale.
const actualBefore=JSON.stringify(await readDb('retail:state'));
await click('button[aria-label="Help and tutorials"]','');await waitFor(`!!document.querySelector('.guide-modal')`,'interactive help');await click('.guide-topic > button','3. Daily plans: Auto and Manual');
await tap('Calculate demo plan');await tap('Approve demo plan');await tap('Review today’s 10 IMEIs');await tap('Confirm demo release');await capture('17-interactive-tutorial');assert.match(await run(`document.querySelector('.practice-tour').innerText`),/50%/);assert.equal(JSON.stringify(await readDb('retail:state')),actualBefore,'tutorials cannot alter actual inventory, targets, releases or reports');await click('.guide-modal button','Close');
assert.deepEqual(errors,[],'no browser runtime exceptions');console.log('PASS: approve, reserve, release to 70%, report 20 of 30, stock38, persistence, layout, records preserved.');
}catch(e){console.error(e.stack);console.error(await body());process.exitCode=1;}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
