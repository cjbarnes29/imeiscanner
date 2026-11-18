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
const seed=Array.from({length:68},(_,i)=>phone('r'+(i+1),i<45?'SM-S948B':'SM-A576B','me',i<45?'12GB | 256GB\nColour: Black':'8GB | 256GB\nColour: Navy'));
const before=JSON.stringify(seed.map(r=>[r.id,r.imei,r.model,r.dataUrl,r.originalDataUrl,r.name,r.raw]));
const people=[{id:'me',label:'Person1',name:'Maya Demo'},{id:'asha',label:'Person2',name:'Noor Demo'},{id:'c',label:'Person3',name:'Lee Demo'}];
const now=new Date();const monthName=now.toLocaleString('en-US',{month:'long'});
const pad=n=>String(n).padStart(2,'0');const today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;const todayDMY=`${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
// the Promoter screen (synthetic): a picture of text, read offline by the page
const lines=['Samsung Promoter','Name: Carlou Test',`${monthName} ${now.getFullYear()}  Target vs Achievement`,'Flagship 1   Target 2   Achieved 1   50%','Flagship 2   Target 4   Achieved 1   25%','Mid   Target 4   Achieved 2   50%','Low   Target 10   Achieved 6   60%'];
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${120+lines.length*70}"><rect width="100%" height="100%" fill="#ffffff"/>${lines.map((l,i)=>`<text x="40" y="${80+i*70}" font-family="Arial" font-size="42" fill="#000">${l}</text>`).join('')}</svg>`);
const screenshot=(await sharp(svg).png().toBuffer()).toString('base64');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.gz':'application/gzip','.traineddata':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4204);
if(await fetch('http://127.0.0.1:9364/json').then(()=>true,()=>false))throw new Error('Port 9364 is used by an old browser: stop the leftover headless msedge (profile imei-retail-*) first.');
const profile=await mkdtemp(join(tmpdir(),'imei-retail-'));
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9364',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
function stopBrowsersOf(dir){const tag=dir.split(/[\\/]/).pop();spawnSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{stdio:'ignore'});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch('http://127.0.0.1:9364/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
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
const out='phase2-results/assistant-actions';await mkdir(out,{recursive:true});
const errors=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
const capture=async (name,keepScroll=false)=>{await sleep(250);await run(`${keepScroll?'':'window.scrollTo(0,0);'}document.querySelector('.toast')?.style.setProperty('visibility','hidden')`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name+'.png'),Buffer.from(r.result.data,'base64'));};
const tap=async(text)=>{const yes=await run(`(()=>{const b=[...document.querySelectorAll('.bottom-nav button'),...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.childNodes[0]?.textContent?.trim()===${JSON.stringify(text)})&&!b.disabled&&b.getBoundingClientRect().width);if(!b)return false;b.click();return true;})()`);assert.ok(yes,'button '+text);await sleep(160);};

const select=async(selector,value)=>{assert.equal(await setVal(selector,value),true,selector);await sleep(120);};
const setInput=async(selector,value)=>{assert.equal(await setVal(selector,String(value)),true,selector);await sleep(120);};
const openPlan=async()=>{await tap('Home');await tap('Open plan →');await waitFor(`!!document.querySelector('.release-planner')`,'plan');};
let acceptDialogs=true,dialogs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params.message);void send('Page.handleJavaScriptDialog',{accept:acceptDialogs});}});
try{
await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:411,height:900,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:'http://localhost:4204/'});await sleep(700);
const rows=seed.slice(0,20).map(r=>({...r,personId:'',model:'SM-F956B',checked:true}));
const state={version:1,settings:{myPersonId:'me',myThreshold:100,lowStock:2,reportAuthor:''},recordMeta:{},soldLedger:{},catalog:[],aliases:{},corrections:{},sales:[],allocations:[],days:{},stockAdjust:[],history:{},audit:[],pendingUploadIds:[],targets:{[today.slice(0,7)]:Object.fromEntries(people.map(p=>[p.id,{personId:p.id,month:today.slice(0,7),source:'manual',importedAt:today,lines:[{segment:'flagship1',target:40,achieved:0}]}]))}};
await run(`localStorage.setItem('imei-lens-simple-view','false');localStorage.setItem('imei-lens-people-v1',${JSON.stringify(JSON.stringify(people))});localStorage.setItem('retaillens-processing-v1',JSON.stringify({autoFindBoxes:false,autoReview:false,autoSplit:false,autoRetry:false}));new Promise(resolve=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result,t=db.transaction('inventory','readwrite'),store=t.objectStore('inventory');store.put(${JSON.stringify(state)},'retail:state');for(const r of ${JSON.stringify(rows)})store.put(r,'record:'+r.id);t.oncomplete=()=>{db.close();resolve(true);};};})`);
await send('Page.navigate',{url:'http://localhost:4204/'});await sleep(1000);await run(`[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent))?.click()`);await sleep(500);
await run(`document.querySelector('[aria-label="Open assistant"]').click()`);await waitFor(`!!document.querySelector('.assistant-panel')`,'global assistant');await sleep(1000);await capture('17-assistant-panel');
const openChat=async()=>{if(!await run(`!!document.querySelector('.assistant-panel')`)){await run(`document.querySelector('[aria-label="Open assistant"]').click()`);await waitFor(`!!document.querySelector('.assistant-panel')`,'the chat opens from the header');await sleep(300);}};
const ask=async(text)=>{await openChat();await setInput('.assistant-panel [aria-label="Ask local assistant"]',text);await click('.assistant-panel button','Get answer');await sleep(350);};
const toHome=async()=>{await click('.assistant-panel button','Review requests on Home');await waitFor(`!document.querySelector('.assistant-panel')&&!!document.querySelector('.assistant-requests')`,'Home review');await sleep(300);};
const atReview=()=>run(`document.querySelector('.assistant-requests').scrollIntoView({block:'start'})`);
// 1. the compact chat only summarises: a request is saved and reviewed on Home, never approved inside the chat
await ask('give 4 Fold6 to Maya and 10 to Noor');await waitFor(`!!document.querySelector('.assistant-panel .plan-ai-output')`,'summary answer in the chat');
assert.equal(await run(`!!document.querySelector('.assistant-panel .assistant-request')||!!document.querySelector('.assistant-panel .assistant-requests')`),false,'the compact chat holds no approval controls or request list');
assert.match(await run(`document.querySelector('.assistant-panel .plan-ai-status').innerText`),/saved for review on Home/);
const faceState=()=>run(`document.querySelector('.assistant-launch .ai-mascot')?.dataset.state||''`);
await waitFor(`document.querySelector('.assistant-launch .ai-mascot')?.dataset.state==='ready'`,'the face says something is ready for review');
assert.equal(await run(`document.querySelector('.assistant-panel .ai-mascot-label').innerText`),'Something is ready for your review on Home','the chat says it in words too');
let saved=await readDb('retail:state');assert.equal((await readDb('record:')).filter(r=>r.personId).length,0,'nothing is given by asking');assert.equal(saved.assistantRequests[0].status,'pending');
// 2. Home shows the full preview; approving gives 4 and 10, and the receipt has Undo
await toHome();await waitFor(`!!document.querySelector('.assistant-requests .assistant-request')`,'request preview on Home');await atReview();await capture('18-give-preview',true);
await click('.assistant-requests .assistant-request button','Approve changes');await sleep(500);saved=await readDb('retail:state');assert.equal(saved.assistantRequests[0].status,'applied');assert.equal((await readDb('record:')).filter(r=>r.personId==='me').length,4);assert.equal((await readDb('record:')).filter(r=>r.personId==='asha').length,10);
await run(`document.querySelector('.assistant-requests>details').open=true`);await capture('19-approved-action-receipt',true);
await click('.assistant-requests button','Undo this action');await sleep(500);assert.equal((await readDb('record:')).filter(r=>r.personId).length,0,'Undo hands every phone back');await capture('20-undo-result',true);
await waitFor(`document.querySelector('.assistant-launch .ai-mascot')?.dataset.state!=='ready'`,'nothing is waiting for review any more, so the face is no longer in the ready state');
// 3. a report change shows its warning on Home and needs an explicit tick
await ask('set report Fold6 to 6');await toHome();await atReview();await capture('21-report-output-warning',true);
assert.equal(await run(`document.querySelector('.assistant-requests .assistant-request .primary').disabled`),true,'blocked until the warning is accepted');
await run(`document.querySelector('.assistant-requests .assistant-request input[type=checkbox]').click()`);await click('.assistant-requests .assistant-request button','Approve changes');await sleep(500);saved=await readDb('retail:state');assert.equal(saved.reportDrafts[today].report.entries.find(r=>r.t==='item').sold,6);assert.equal(saved.releases?.length||0,0,'a report change records no sale');
// 4. a settings request is also approved on Home
await ask('Turn off auto-detection');await toHome();await click('.assistant-requests .assistant-request button','Approve changes');await sleep(300);assert.equal(await run(`JSON.parse(localStorage.getItem('retaillens-processing-v1')).autoFindBoxes`),false);await atReview();await capture('22-settings-action-result',true);
// 5. an app report (Excel, PowerPoint or simple notes) is asked for in the chat and made on Home; it can be downloaded or sent on WhatsApp. Making a report changes nothing.
// WhatsApp is never really opened in this test: the browser's share and open functions are replaced by recorders.
const ownersBefore=JSON.stringify((await readDb('record:')).map(r=>[r.id,r.personId]).sort());
const lastMonth=(()=>{const d=new Date(now.getFullYear(),now.getMonth()-1,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);})();
await ask('make a powerpoint report for last month');
await waitFor(`/Report ready to make: a PowerPoint file for everyone, ${lastMonth}/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'the chat understood the report request');
assert.equal(await run(`!!document.querySelector('.assistant-panel [aria-label^="Make "]')||!!document.querySelector('.assistant-panel [aria-label="Send report on WhatsApp"]')`),false,'the chat only summarises: the report is made and sent from Home');
await toHome();
await waitFor(`!!document.querySelector('.assistant-report-files[open]')`,'the request opened the Make a report card on Home');
assert.equal(await run(`document.querySelector('[aria-label="Report month"]').value`),lastMonth,'the month was filled in');
assert.match(await run(`document.querySelector('[aria-label="Make PowerPoint report"]').className`),/primary/,'the PowerPoint button is the highlighted one');
assert.equal(await run(`!!document.querySelector('[aria-label="Send report on WhatsApp"]')`),false,'nothing to send before the report is made');
await run(`window.__blobs=[];window.__opened=[];window.__shared=[];const make=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{window.__blobs.push(b);return make(b)};window.open=(u)=>{window.__opened.push(String(u));return null};true`);
// PowerPoint: made first, then downloaded
await click('.assistant-report-files button','PowerPoint (.pptx)');
await waitFor(`!!document.querySelector('[aria-label="Report ready"]')`,'the PowerPoint report is ready');
assert.match(await run(`document.querySelector('[aria-label="Report ready"]').innerText`),/PowerPoint · AI-LENS-report-\d{4}-\d{2}\.pptx · \d+ KB/);
assert.equal(await run(`window.__blobs.length`),0,'making does not download by itself');
await click('.assistant-report-files button','Download');
await waitFor(`window.__blobs.length>=1`,'the PowerPoint file was downloaded');
assert.equal(await run(`window.__blobs[0].type`),'application/vnd.openxmlformats-officedocument.presentationml.presentation');
assert.ok(await run(`window.__blobs[0].size`)>3000,'a real file, not an empty one');assert.equal(await run(`window.__blobs[0].slice(0,2).text()`),'PK','a zip package (.pptx)');
// Send on WhatsApp where the browser can share files: the file goes to the share menu with a caption, nothing is saved
await run(`navigator.canShare=d=>!!(d&&d.files&&d.files.length);navigator.share=async d=>{window.__shared.push({names:d.files.map(f=>f.name),types:d.files.map(f=>f.type),size:d.files[0].size,text:d.text||''});};true`);
await click('.assistant-report-files button','Send on WhatsApp');
await waitFor(`window.__shared.length>=1`,'the PowerPoint file was handed to the share menu');
const sharedPpt=await run(`window.__shared[0]`);
assert.match(sharedPpt.names[0],/^AI-LENS-report-\d{4}-\d{2}\.pptx$/);assert.equal(sharedPpt.types[0],'application/vnd.openxmlformats-officedocument.presentationml.presentation');assert.ok(sharedPpt.size>3000);assert.match(sharedPpt.text,/^AI LENS report · /);
await waitFor(`/share menu is open[\\s\\S]*cannot tell whether it was sent/.test(document.querySelector('[aria-label="Report ready"]').parentElement.innerText)`,'the status says the person finishes sending in WhatsApp');
assert.equal(await run(`window.__blobs.length`),1,'sending shared the file without saving another copy');
// Send on WhatsApp where files cannot be shared: the file is saved so it can be attached, and nothing is claimed as sent
await run(`navigator.canShare=()=>false;true`);
await click('.assistant-report-files button','Send on WhatsApp');
await waitFor(`window.__blobs.length>=2`,'the file was saved when files cannot be shared');
await waitFor(`/Nothing was sent/.test(document.querySelector('[aria-label="Report ready"]').parentElement.innerText)`,'the status does not claim it was sent');
// Excel: made, downloaded
await click('.assistant-report-files button','Excel (.xlsx)');
await waitFor(`/Excel · AI-LENS-report/.test(document.querySelector('[aria-label="Report ready"]')?.innerText||'')`,'the Excel report is ready');
await click('.assistant-report-files button','Download');
await waitFor(`window.__blobs.length>=3`,'the Excel file was downloaded');
assert.equal(await run(`window.__blobs[2].type`),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(await run(`window.__blobs[2].slice(0,2).text()`),'PK');
// Simple notes for one person: sent on WhatsApp as a link with the text ready, or downloaded as a .txt
await setVal('.assistant-report-files select[aria-label="Report for"]','asha');
await click('.assistant-report-files button','Simple notes');
await waitFor(`!!document.querySelector('[aria-label="Report notes"]')`,'the notes appear');
const notesText=await run(`document.querySelector('[aria-label="Report notes"]').value`);
assert.match(notesText,/^AI LENS report · /);assert.match(notesText,/For: Noor Demo/);assert.ok(!/\d{15}/.test(notesText),'no IMEI in the notes');
await click('.assistant-report-files button','Send on WhatsApp');
await waitFor(`window.__opened.length>=1`,'WhatsApp was asked to open with the notes');
const wa=await run(`window.__opened[0]`);
assert.ok(wa.startsWith('https://wa.me/?text='),'the WhatsApp link: '+wa.slice(0,40));assert.match(decodeURIComponent(wa.slice('https://wa.me/?text='.length)),/AI LENS report · [\s\S]*For: Noor Demo/,'the notes travel in the WhatsApp text');
await click('.assistant-report-files button','Download .txt');
await waitFor(`window.__blobs.length>=4`,'the notes were downloaded');
assert.match(await run(`window.__blobs[3].type`),/^text\/plain/);assert.match(await run(`window.__blobs[3].text()`),/^AI LENS report · /);
assert.equal(JSON.stringify((await readDb('record:')).map(r=>[r.id,r.personId]).sort()),ownersBefore,'making and sending reports changed no phone owner');
assert.equal((await readDb('retail:state')).releases?.length||0,0,'and recorded no sale');
await atReview();await capture('24-make-a-report',true);
await waitFor(`['idle','checking','waiting','ready'].includes(document.querySelector('.assistant-launch .ai-mascot')?.dataset.state)`,'the face is showing');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(200);
assert.equal(await run(`getComputedStyle(document.querySelector('.assistant-launch .ai-mascot .eye')).animationName`),'none','with reduced motion nothing on the face animates');
assert.equal(await run(`document.querySelector('.assistant-launch .ai-mascot').getAttribute('aria-label').length>8`),true,'and the state is still given in words');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await sleep(200);
await atReview();await capture('23-home-assistant-history',true);assert.deepEqual(errors,[]);console.log('PASS: report files requested in chat, made on Home, downloaded or sent on WhatsApp (PowerPoint, Excel, notes; nothing changed); assistant face shows ready / reduced motion; compact header chat summarises; requests reviewed, approved and undone on Home; give4/10 receipt/Undo; report warning review; settings approval; Home history; unchanged sales.');
}catch(error){console.error(error.stack);console.error(await body());process.exitCode=1;}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
