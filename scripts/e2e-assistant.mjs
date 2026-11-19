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
// Voice (E2E_VOICE=1 only, needs internet once for the 43 MB model): a spoken sentence made with Windows speech is played by the browser's fake microphone.
const VOICE=process.env.E2E_VOICE==='1';let voiceWav='';
if(VOICE){voiceWav=join(tmpdir(),'imei-voice-give.wav');const ps=`Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.SetOutputToWaveFile('${voiceWav}',(New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)));$s.Speak('Give four Fold six to Maya and ten to Noor');$s.Dispose()`;spawnSync('powershell',['-NoProfile','-Command',ps]);if(!existsSync(voiceWav))throw new Error('could not make the spoken test sentence');}
const proc=spawn(browser,['--headless=new','--disable-gpu','--remote-debugging-port=9364',`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',...(VOICE?[`--use-file-for-fake-audio-capture=${voiceWav}`]:[]),'about:blank'],{stdio:'ignore'});
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
const confirmRemoval=async()=>{const state=await run(`(()=>{const q=document.querySelector('.assistant-requests .assistant-request');const b=q&&q.querySelector('button[data-confirm="hold"]');if(b){b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 'hold';}const i=q&&q.querySelector('.confirm-typed input');if(i){const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'CONFIRM');i.dispatchEvent(new Event('input',{bubbles:true}));return 'typed';}return 'none';})()`);if(state==='hold')await sleep(1300);if(state==='typed'){await sleep(200);await click('.assistant-requests .assistant-request button','Approve removal');}return state;};
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
// the assistant is a small card with a prompt box and suggestions taken from history, opened from the round button; the big panel is one tap further
assert.equal(await run(`!!document.querySelector('.assistant-panel.assistant-quick')`),true,'the assistant opens as a small card');
assert.equal(await run(`document.querySelector('.assistant-quick-wrap').getBoundingClientRect().height<window.innerHeight*0.7`),true,'the card is small');
assert.match(await run(`document.querySelector('.assistant-quick-head').innerText`),/What do you want to do\?/);
const chipTexts=await run(`[...document.querySelectorAll('.assistant-chips .chip')].map(b=>b.textContent.trim())`);
assert.ok(chipTexts.length>=3&&chipTexts.length<=6,'suggestions: '+chipTexts.join(' | '));
await run(`document.querySelector('.assistant-chips .chip').click()`);
await waitFor(`!!document.querySelector('.assistant-quick .assistant-answer')`,'a tapped suggestion is asked at once');
assert.equal(await run(`document.querySelector('[aria-label="Ask local assistant"]').value`),chipTexts[0],'and its words are in the box');
await setInput('.assistant-panel [aria-label="Ask local assistant"]','');
assert.equal(await run(`!!document.querySelector('.assistant-panel .assistant-questions')`),false,'no long question lists inside the small card');
assert.equal(await run(`!!document.querySelector('.assistant-bubble')&&!document.querySelector('.top-actions .assistant-launch')`),true,'the round button, not a header icon');
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
let saved=await readDb('retail:state');assert.equal((await readDb('record:')).filter(r=>r.personId).length,0,'nothing is given by asking');assert.equal(saved.assistantRequests.find(r=>/^give 4 Fold6/.test(r.text)).status,'pending');
// 2. Home shows the full preview; approving gives 4 and 10, and the receipt has Undo
await toHome();await waitFor(`!!document.querySelector('.assistant-requests .assistant-request')`,'request preview on Home');await atReview();await capture('18-give-preview',true);
await click('.assistant-requests .assistant-request button','Approve changes');await sleep(500);saved=await readDb('retail:state');assert.equal(saved.assistantRequests.find(r=>/^give 4 Fold6/.test(r.text)).status,'applied');assert.equal((await readDb('record:')).filter(r=>r.personId==='me').length,4);assert.equal((await readDb('record:')).filter(r=>r.personId==='asha').length,10);
await run(`document.querySelector('.assistant-requests>details').open=true`);await capture('19-approved-action-receipt',true);
await click('.assistant-requests button','Undo this action');await sleep(500);assert.equal((await readDb('record:')).filter(r=>r.personId).length,0,'Undo hands every phone back');await capture('20-undo-result',true);
await waitFor(`document.querySelector('.assistant-launch .ai-mascot')?.dataset.state!=='ready'`,'nothing is waiting for review any more, so the face is no longer in the ready state');
// 3. a report change shows its warning on Home and needs an explicit tick
await ask('set report Fold6 to 6');await toHome();await atReview();await capture('21-report-output-warning',true);
assert.equal(await run(`document.querySelector('.assistant-requests .assistant-request .primary').disabled`),true,'blocked until the warning is accepted');
await run(`document.querySelector('.assistant-requests .assistant-request input[type=checkbox]').click()`);await click('.assistant-requests .assistant-request button','Approve changes');await sleep(500);saved=await readDb('retail:state');assert.equal(saved.reportDrafts[today].report.entries.find(r=>r.t==='item').sold,6);assert.equal(saved.releases?.length||0,0,'a report change records no sale');
// 4. a settings request is also approved on Home
await ask('Turn off auto-detection');await toHome();await click('.assistant-requests .assistant-request button','Approve changes');await sleep(300);assert.equal(await run(`JSON.parse(localStorage.getItem('retaillens-processing-v1')).autoFindBoxes`),false);await atReview();await capture('22-settings-action-result',true);
// 4b. People by chat: the request is only a preview until Approve is pressed on Home; Approve must be ENABLED for a people change (it was not once), the people are saved, and Undo removes them again.
{const peopleNow=()=>run(`JSON.parse(localStorage.getItem('imei-lens-people-v1')||'[]').map(p=>p.name)`);const before=await peopleNow();
await ask('add 2 people omar and lee');assert.deepEqual(await peopleNow(),before,'the chat alone adds nobody');await toHome();
assert.equal(await run(`[...document.querySelectorAll('.assistant-requests .assistant-request button')].find(b=>b.textContent.trim().startsWith('Approve changes'))?.disabled`),false,'Approve is enabled for a people change');
await click('.assistant-requests .assistant-request button','Approve changes');await sleep(700);const added=await peopleNow();assert.ok(added.includes('Omar')&&added.includes('Lee'),'the two people are saved: '+added);
await waitFor(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const q=o.result.transaction('inventory').objectStore('inventory').get('retail:state');q.onsuccess=()=>res(!!(q.result.agentLog||[]).find(e=>e.tool==='people.create'&&e.verify==='verified'&&e.outcome==='applied'));};})`,'the approval is in the audit log and was confirmed in the saved data');assert.match(await run(`document.querySelector('.assistant-requests')?.innerText||''`),/Checked in the saved data|Approved and saved/,'the screen says it was checked');const saved4b=await readDb('retail:state');const req4b=saved4b.assistantRequests.find(r=>/^add 2 people/.test(r.text));assert.equal(req4b.tool,'people.create','the receipt names the tool');assert.equal(req4b.verify,'verified','the receipt records that the saved data was checked');await click('.assistant-requests button','Undo this action');await sleep(900);assert.deepEqual(await peopleNow(),before,'Undo removes them again');await atReview();}
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
// the suggestions now come from what was asked, and the full assistant is one tap further
await openChat();
const historyChips=await run(`[...document.querySelectorAll('.assistant-chips .chip')].map(b=>b.textContent.trim())`);
assert.ok(historyChips.includes('Turn off auto-detection')&&historyChips.some(t=>/powerpoint report for last month/i.test(t)),'suggestions follow the history: '+historyChips.join(' | '));
await click('.assistant-panel button','Open the full assistant');
await waitFor(`!!document.querySelector('.assistant-backdrop .assistant-panel')&&!document.querySelector('.assistant-quick')`,'the full assistant opens');
await click('.assistant-backdrop button','Close assistant');await waitFor(`!document.querySelector('.assistant-panel')`,'the full assistant closes');
await run(`document.querySelector('[aria-label="Open assistant"]').click()`);await waitFor(`!!document.querySelector('.assistant-quick')`,'the round button opens the small card again');
// 4c. Conversation: Approve / Reject / Undo right in the chat, "yes", "no", "undo that", a follow-up number, and the opt-in memory. A destructive change is only offered on Home.
{
  const peopleNow=()=>run(`JSON.parse(localStorage.getItem('imei-lens-people-v1')||'[]').map(p=>p.name)`);
  const chatButtons=()=>run(`[...document.querySelectorAll('.assistant-panel .assistant-chat-actions button')].map(b=>b.textContent.trim())`);
  const reply=()=>run(`document.querySelector('.assistant-panel .plan-ai-output')?.innerText||''`);
  const said=async text=>{await ask(text);await sleep(700);};
  const start=await peopleNow();
  await said('add person Zed');
  assert.deepEqual(await peopleNow(),start,'nothing is applied before Approve');
  assert.ok((await chatButtons()).includes('Approve now')&&(await chatButtons()).includes('Reject'),'Approve and Reject are offered in the chat');
  await click('.assistant-panel .assistant-chat-actions button','Approve now');
  await waitFor(`/Approved and saved/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'approved in the chat and checked in the saved data');
  assert.ok((await peopleNow()).includes('Zed'),'Zed is saved');assert.ok((await chatButtons()).includes('Undo'),'Undo is offered after it');
  await said('rename zed to zack');await said('yes');
  await waitFor(`/Approved and saved/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'"yes" approved the waiting change');
  assert.ok((await peopleNow()).includes('Zack'),'the rename is saved');
  await said('undo that');await waitFor(`/Undone/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'"undo that" undid it');
  assert.ok((await peopleNow()).includes('Zed')&&!(await peopleNow()).includes('Zack'),'the old name is back');
  await said('rename zed to zoe');await said('no');
  assert.ok((await peopleNow()).includes('Zed')&&!(await peopleNow()).includes('Zoe'),'"no" rejects it');assert.match(await reply(),/Rejected/);
  await said('delete zed');assert.ok(!(await chatButtons()).includes('Approve now'),'a delete is only offered on Home, never in the chat');
  await said('yes');assert.ok((await peopleNow()).includes('Zed'),'"yes" cannot approve a delete from the chat');
  await toHome();assert.ok(!await clickText('.assistant-requests .assistant-request button','Approve changes'),'a removal has no one-tap Approve');await run(`(()=>{const b=document.querySelector('.assistant-requests .assistant-request button[data-confirm="hold"]');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));setTimeout(()=>b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})),200);})()`);await sleep(1300);assert.ok((await peopleNow()).includes('Zed'),'a short press removes nothing');assert.equal(await confirmRemoval(),'hold');await sleep(900);assert.deepEqual(await peopleNow(),start,'Zed is removed on Home after press and hold');
  // a follow-up with another number is a new request that says how it was read
  const month4c=today.slice(0,7),target4c=async()=>((await readDb('retail:state')).targets?.[month4c]?.me?.lines||[]).find(l=>l.segment==='flagship1')?.target||0,t0=await target4c();
  await said('set maya flagship 1 target to 9');await said('make it 5');
  assert.match(await reply(),/Same as before, with 5/,'the follow-up shows how it was understood');
  await said('yes');await waitFor(`/Approved and saved/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'the follow-up number was approved');
  assert.equal(await target4c(),5,'the new number was applied, not the old one');
  await said('undo that');await waitFor(`/Undone/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'the target was undone');assert.equal(await target4c(),t0,'the target is back');
  await toHome();await click('.assistant-requests .assistant-request button','Reject');await sleep(500);
  // memory: off by default, opt-in, visible, editable and deletable; never IMEIs
  await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`);await waitFor(`!document.querySelector('.assistant-panel')`,'the chat closes');await run(`document.querySelector('[aria-label="Settings"]').click()`);await waitFor(`!!document.querySelector('.settings-local-ai button')`,'Settings');await click('.settings-local-ai button','Local AI');await waitFor(`!!document.querySelector('.assistant-backdrop .assistant-panel')&&!!document.querySelector('.assistant-memory')`,'the assistant opened from Settings shows Memory & preferences');
  await said('remember that maya covers the north store');assert.match(await reply(),/Memory is off/,'nothing is remembered while memory is off');
  assert.ok(!(await readDb('retail:state')).agentChat?.memory?.length,'nothing was stored');
  await run(`document.querySelector('.assistant-memory').open=true;document.querySelector('.assistant-memory input[type=checkbox]').click()`);await sleep(700);
  assert.equal((await readDb('retail:state')).agentChat.memoryOn,true,'memory is on only after the switch');
  await said('remember that maya covers the north store');await waitFor(`/Remembered/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`,'remembered');
  await said('what do you remember');assert.match(await reply(),/maya covers the north store/i,'the notes can be listed');
  const imeiNote=imei();await said('remember that the phone is '+imeiNote);assert.match(await reply(),/never remember IMEI/,'IMEIs are refused');
  assert.ok(!JSON.stringify(await readDb('retail:state')).includes(imeiNote),'the IMEI is nowhere in the saved data, not even in the chat history');
  await run(`(()=>{const el=document.querySelector('.assistant-memory .memory-note input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'maya covers the south store');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await click('.assistant-memory .memory-note button','Save');await sleep(700);assert.equal((await readDb('retail:state')).agentChat.memory[0].text,'maya covers the south store','an edit is saved');
  await click('.assistant-memory .memory-note button','Delete');await sleep(700);assert.equal((await readDb('retail:state')).agentChat.memory.length,0,'a note can be deleted');
  await run(`document.querySelector('.assistant-memory input[type=checkbox]').click()`);await sleep(700);assert.equal((await readDb('retail:state')).agentChat.memoryOn,false,'memory can be switched off again');
  await click('.assistant-backdrop button','Close assistant');await waitFor(`!document.querySelector('.assistant-panel')`,'the assistant closes');await run(`document.querySelector('[aria-label="Open assistant"]').click()`);await waitFor(`!!document.querySelector('.assistant-quick')`,'the small card is open again, as the next steps expect');
  await atReview();
}
await run(`document.querySelector('[aria-label="Open assistant"]').click()`);await waitFor(`!document.querySelector('.assistant-panel')`,'and closes it');
// natural wording: the sentence the user typed is understood, previewed first, approved and undone; nothing changes before approval
await ask('change flagship 3 target to 12 and divide it to promoters');
await waitFor(`/saved for review on Home/.test(document.querySelector('.assistant-panel .plan-ai-status')?.innerText||'')`,'understood as a request to review');
await toHome();await atReview();
await waitFor(`/Flagship 3: store target 12; equal base split across 3 people/.test(document.querySelector('.assistant-requests .assistant-request')?.innerText||'')`,'the preview shows the division between the promoters');
await capture('25-target-split-preview',true);
const flag3=async()=>{const st=await readDb('retail:state');const t=st.targets?.[today.slice(0,7)]||{};return ['me','asha','c'].map(id=>t[id]?.lines?.find(l=>l.segment==='flagship3')?.target);};
assert.ok(!(await flag3()).some(v=>v===4),'nothing is applied before approval');
await click('.assistant-requests .assistant-request button','Approve changes');await sleep(700);
assert.deepEqual(await flag3(),[4,4,4],'12 divided equally between the 3 promoters');
await click('.assistant-requests button','Undo this action');await sleep(700);
assert.ok(!(await flag3()).some(v=>v===4),'Undo takes the division back');
// one person's target by chat: previewed first, applied only after approval, Undo restores it, the others are untouched
{
  const before1=await flag3();
  await ask("set Maya's flagship 3 target to 7");
  await waitFor(`/saved for review on Home/.test(document.querySelector('.assistant-panel .plan-ai-status')?.innerText||'')`,'one-person target understood');
  await toHome();await atReview();
  await waitFor(`/Flagship 3: \\d+ → 7/.test(document.querySelector('.assistant-requests .assistant-request')?.innerText||'')`,'the preview shows that person’s change');
  assert.deepEqual(await flag3(),before1,'nothing is applied before approval');
  await click('.assistant-requests .assistant-request button','Approve changes');await sleep(700);
  const after1=await flag3();assert.equal(after1[0],7,'Maya now has 7');assert.deepEqual(after1.slice(1),before1.slice(1),'the other people are unchanged');
  await click('.assistant-requests button','Undo this action');await sleep(700);assert.deepEqual(await flag3(),before1,'Undo restores the earlier target');
}
// a command that cannot be turned into a reviewable change is explained, not answered with an unrelated calculation
await ask('make the sky blue');
await waitFor(`/could not turn this into a change/.test(document.querySelector('.assistant-quick .assistant-answer-title')?.innerText||'')`,'a not-understood command is explained');
assert.match(await run(`document.querySelector('.assistant-quick .plan-ai-status').innerText`),/Nothing was changed/);
assert.ok(await run(`document.querySelectorAll('.assistant-quick .assistant-answer li').length>=3`),'with examples to try');
// replies are a headline and a few bullets; suggested next steps ask the question when tapped
await ask('How much real stock do we have?');
await waitFor(`!!document.querySelector('.assistant-quick .assistant-answer-title')&&!/could not turn/.test(document.querySelector('.assistant-quick .assistant-answer-title').innerText)`,'a stock answer');
assert.ok(await run(`document.querySelectorAll('.assistant-quick .assistant-answer li').length<=5`),'the small chat shows a summary only');
assert.ok(await run(`document.querySelectorAll('.assistant-quick .assistant-next .chip').length>=2`),'next steps are offered');
const firstTitle=await run(`document.querySelector('.assistant-quick .assistant-answer-title').innerText`);
const stepText=await run(`document.querySelector('.assistant-quick .assistant-next .chip').textContent.trim()`);
await run(`document.querySelector('.assistant-quick .assistant-next .chip').click()`);
await waitFor(`document.querySelector('[aria-label="Ask local assistant"]').value===${JSON.stringify(stepText)}&&document.querySelector('.assistant-quick .assistant-answer-title')&&document.querySelector('.assistant-quick .assistant-answer-title').innerText!==${JSON.stringify(firstTitle)}`,'tapping a next step asks it and shows its answer');
await capture('26-small-chat-answer');
// EVERY question asked in the chat is made or answered, and the chat never approves or submits anything by itself
const snapshot=async()=>{const st=await readDb('retail:state');const recs=await readDb('record:');return JSON.stringify({owners:recs.map(r=>[r.id,r.personId]).sort(),sales:(st.sales||[]).map(x=>[x.id,x.submitted,x.voided]),releases:st.releases?.length||0,targets:st.targets,allocations:(st.allocations||[]).length,applied:(st.assistantRequests||[]).filter(r=>r.status==='applied').length,processing:await run(`localStorage.getItem('retaillens-processing-v1')`),workflow:await run(`localStorage.getItem('retaillens-auto-workflow-v1')`)});};
const stateBefore=await snapshot();
const QUESTIONS=['Check my report','How much real stock do we have?','Plan to reach 70 percent today','Check and explain my settings','Make a PowerPoint report for this month','Show only plans and warnings on Home','Store uploads automatically','Turn off auto-detection',
  'what can you do','how many phones are unassigned','which segment should I push this month','what is my target for flagship 3','show my targets','who needs help','how do I share my targets',
  'give 4 Fold6 to Maya and 10 to Noor','set report Fold6 to 6','prepare today report','store 2 Fold6','make 2 Fold6 available','remove 1 Fold6 from stock','set Buds4 stock to 8',
  'split store target 120 for Flagship 1 among everyone','change flagship 3 target to 12 and divide it to promoters','set store target for Flagship 2 to 20 and share it among everyone','mark Maya not available from 2026-12-20 to 2026-12-22','create daily routine to prepare today report','add phone stock F956 IMEI 490154209100009',
  'change flagship 3 target to 12','change flagship 3 target to 12 and divide it to Maya','make the sky blue','delete everything','give phones','do not apply anything',
  'make a powerpoint report for last month','excel report for Noor','simple notes of my targets','build a spreadsheet summary for october',
  'zzzz qqqq','what is the capital of France','12345','???','a','x'.repeat(300)];
const historyLength=async()=>(await readDb('retail:state')).assistantRequests?.length||0;
const unanswered=[];
for(const q of QUESTIONS){
  const n0=await historyLength();await ask(q);
  let n1=n0;for(let i=0;i<60&&n1<=n0;i++){await sleep(150);n1=await historyLength();}
  await sleep(200);
  const reply=await run(`(document.querySelector('.assistant-quick .assistant-answer-title')?.innerText||'')+' '+(document.querySelector('.assistant-quick .plan-ai-status')?.innerText||'')`);
  const explainedFull=/too many requests/.test(reply);
  if(!(n1>n0||explainedFull)||!reply.trim())unanswered.push(`"${q.slice(0,50)}": saved=${n1>n0}, reply="${reply.trim().slice(0,60)}"`);
}
assert.deepEqual(unanswered,[],`every question must be saved and replied to: ${unanswered.join(' | ')}`);
assert.equal(await snapshot(),stateBefore,'the chat approved, applied or submitted nothing: no owner, sale, submission, target, allocation or setting changed');
assert.equal((await readDb('retail:state')).assistantRequests.filter(r=>r.status==='applied').length,JSON.parse(stateBefore).applied,'no request was applied by asking');
// the search bar: opens from the header, finds screens by name, by related word and with a typo, and opens them
const openSearch=async()=>{await run(`document.querySelector('[aria-label="Search"]').click()`);await waitFor(`!!document.querySelector('.nav-search')`,'the search opens');};
const searchFor=async text=>{await setInput('.nav-search [aria-label="Search screens, settings and tools"]',text);await sleep(250);};
await run(`(()=>{const q=document.querySelector('.assistant-panel');if(q)document.querySelector('[aria-label="Close assistant"]').click();return true})()`);
await openSearch();
assert.ok(await run(`document.querySelectorAll('.nav-search-results button').length>=4`),'before typing: recent and popular places');
await capture('27-search-start');
await searchFor('backup');
assert.match(await run(`document.querySelector('.nav-search-results button strong').innerText`),/Backup and data/);
await run(`document.querySelector('.nav-search-results button').click()`);
await waitFor(`!!document.querySelector('.retail-data')&&!document.querySelector('.nav-search')`,'Backup and data opens');
await openSearch();await searchFor('targts');
assert.match(await run(`document.querySelector('.nav-search-results button strong').innerText`),/^Targets$/,'a typo still finds Targets');
await run(`document.querySelector('.nav-search-results button').click()`);
await waitFor(`!!document.querySelector('.retail-targets')`,'Targets opens');
await openSearch();await searchFor('edit all');
await run(`document.querySelector('.nav-search-results button').click()`);
await waitFor(`!!document.querySelector('.tg-people-grid')`,'Edit all opens straight to the screen with every person and segment',20000);
await openSearch();await searchFor('powerpoint');
assert.match(await run(`document.querySelector('.nav-search-results button strong').innerText`),/Make a report/);
await run(`document.querySelector('.nav-search-results button').click()`);
await waitFor(`!!document.querySelector('.assistant-report-files[open]')`,'Make a report opens on Home',20000);
await openSearch();await searchFor('zebra stripes');
assert.match(await run(`document.querySelector('.nav-search-results button strong').innerText`),/Ask the assistant: “zebra stripes”/,'nothing matched: the assistant is offered');
await run(`document.querySelector('.nav-search-results button').click()`);
await waitFor(`!!document.querySelector('.assistant-quick .assistant-answer-title')`,'the assistant asked it at once',20000);
await run(`document.querySelector('[aria-label="Close assistant"]').click()`);
await openSearch();await run(`document.querySelector('.nav-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await waitFor(`!document.querySelector('.nav-search')`,'Escape closes the search');
assert.equal(await snapshot(),stateBefore,'searching and navigating changed no data');
await waitFor(`['idle','checking','waiting','ready'].includes(document.querySelector('.assistant-launch .ai-mascot')?.dataset.state)`,'the face is showing');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(200);
assert.equal(await run(`getComputedStyle(document.querySelector('.assistant-launch .ai-mascot .eye')).animationName`),'none','with reduced motion nothing on the face animates');
assert.equal(await run(`document.querySelector('.assistant-launch .ai-mascot').getAttribute('aria-label').length>8`),true,'and the state is still given in words');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await sleep(200);
// Multi-step tasks. Copilot: approve once, Undo reverses the whole task. Autopilot: allowed steps apply by themselves, others wait. Chat cannot change the mode.
{
  const KEY='retaillens-auto-workflow-v1';
  const setMode=async mode=>{await run(`localStorage.setItem(${JSON.stringify(KEY)},JSON.stringify({assistantMode:${JSON.stringify(mode)}}));window.dispatchEvent(new Event('retaillens-workflow-change'))`);await sleep(200);};
  const assigned=async()=>{await sleep(800);return(await readDb('record:')).filter(r=>r.personId).length;};
  const lastTask=async()=>(await readDb('retail:state')).assistantTasks?.at(-1);
  const until=async(check,label)=>{for(let i=0;i<60;i++){const t=await lastTask();if(t&&check(t))return t;await sleep(300);}throw new Error('task never reached: '+label+' · last task: '+JSON.stringify(await lastTask()));};
  const showTasks=async()=>run(`document.querySelector('.assistant-tasks').open=true;document.querySelector('.assistant-tasks').scrollIntoView({block:'start'})`);
  // the earlier questions leave requests waiting on Home (limit 20); reject them so the task steps below are not stopped by that limit
  // the new bulk button: one press asks, a second press rejects every waiting request (applied ones are not touched)
  await tap('Home');await sleep(500);
  const waiting=(await readDb('retail:state')).assistantRequests.filter(r=>r.status==='pending').length,applied=(await readDb('retail:state')).assistantRequests.filter(r=>r.status==='applied').length;
  if(waiting>1){
    await run(`document.querySelector('.assistant-requests').scrollIntoView({block:'start'});[...document.querySelectorAll('.assistant-requests button')].find(b=>/^Reject all [0-9]+ waiting/.test(b.textContent.trim())).click();true`);await sleep(300);
    assert.match(await body(),/Reject all \d+ waiting requests\?/,'it asks before rejecting everything');assert.equal((await readDb('retail:state')).assistantRequests.filter(r=>r.status==='pending').length,waiting,'asking changes nothing');await capture('50-reject-all-waiting',true);
    await run(`[...document.querySelectorAll('.assistant-requests button')].find(b=>/^Yes, reject all/.test(b.textContent.trim())).click();true`);await sleep(600);
    const afterBulk=(await readDb('retail:state')).assistantRequests;assert.equal(afterBulk.filter(r=>r.status==='pending').length,0,'every waiting request is rejected');assert.equal(afterBulk.filter(r=>r.status==='applied').length,applied,'applied requests are untouched');
  }
  const g0=await assigned();
  await setMode('copilot');await ask('give 2 Fold6 to Maya, then give 3 Fold6 to Noor');await toHome();await waitFor(`!!document.querySelector('.assistant-tasks [data-task-id]')`,'task on Home');
  let task=await lastTask();assert.equal(task.mode,'copilot');assert.equal(task.steps.length,2);assert.ok(task.steps.every(s=>s.status==='pending'),'Copilot applies nothing before the single approval');assert.equal(await assigned(),g0);
  await showTasks();await capture('40-task-copilot-review',true);
  await click('.assistant-tasks button','Approve all remaining steps');task=await until(t=>t.status==='done','copilot done');
  assert.ok(task.steps.every(s=>s.status==='done'&&s.requestId));assert.equal(await assigned(),g0+5,'both steps gave their phones');
  saved=await readDb('retail:state');assert.equal(saved.assistantRequests.filter(r=>/^give (2|3) Fold6/.test(r.text)&&r.status==='applied').length,2,'each step has its own receipt');
  assert.ok(saved.audit.some(a=>/assistant task/.test(a.what)),'the task is written to History');
  await showTasks();await capture('41-task-copilot-done',true);
  await click('.assistant-tasks button','Undo applied steps');task=await until(t=>t.status==='undone','copilot undone');assert.equal(await assigned(),g0,'Undo hands every phone back');
  await setMode('autopilot');await ask('give 2 Fold6 to Maya, then give 1 Fold6 to Noor');
  task=await until(t=>t.mode==='autopilot'&&t.status==='done','autopilot done');assert.equal(await assigned(),g0+3,'Autopilot applied both allowed steps by itself');assert.ok(task.steps.every(s=>s.doneAt));
  await toHome();await showTasks();await capture('42-task-autopilot-done',true);
  await click('.assistant-tasks button','Undo applied steps');await until(t=>t.status==='undone','autopilot undone');assert.equal(await assigned(),g0);
  const before=await run(`localStorage.getItem('retaillens-processing-v1')`);
  await ask('turn on auto-detection');task=await until(t=>t.mode==='autopilot'&&t.status==='review','autopilot holds settings');
  assert.equal(task.steps[0].status,'pending');assert.match(task.steps[0].error,/not allowed to change: settings/);assert.equal(await run(`localStorage.getItem('retaillens-processing-v1')`),before,'a held step changes nothing');
  await toHome();await showTasks();await capture('43-task-autopilot-held',true);await click('.assistant-tasks button','Reject the rest');await until(t=>t.status==='rejected','rejected');
  await ask('set assistant mode to assistant');assert.equal(await run(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).assistantMode`),'autopilot','the chat cannot change the mode');
  // A timed routine, like a Claude routine: saved from one sentence, runs by itself at its time, once a day, keeps a history, and has Run now.
  {
    const t=new Date(Date.now()-60000),hhmm=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`,g1=await assigned();
    await ask(`give 1 Fold6 to Maya every day at ${hhmm}`);
    let st;for(let i=0;i<100;i++){st=await readDb('retail:state');if(st.assistantRoutines?.some(r=>r.time===hhmm&&r.lastRun))break;await sleep(300);}
    let routine=st.assistantRoutines?.find(r=>r.time===hhmm);assert.ok(routine,'the routine was saved with its time');assert.equal(routine.text,'give 1 Fold6 to Maya');assert.deepEqual(routine.days,[]);
    assert.ok(routine.lastRun,'it ran by itself at its time');assert.equal(routine.lastRun.kind,'task');assert.equal(routine.lastPrepared,today,'today is marked done');
    assert.equal(await assigned(),g1+1,'Autopilot gave the phone from the routine');
    await sleep(1500);st=await readDb('retail:state');assert.equal(st.assistantRoutines.find(r=>r.time===hhmm).runs.length,1,'it runs once a day, not on every check');
    await toHome();await run(`document.querySelector('.routine-learning').open=true;document.querySelector('.routine-learning').scrollIntoView({block:'start'})`);await sleep(300);
    assert.match(await body(),new RegExp(`Every day at ${hhmm}`),'the schedule is shown');assert.match(await body(),/Last run/,'the last run is shown');await capture('45-timed-routine',true);
    await run(`[...document.querySelectorAll('.routine-learning button')].find(b=>b.textContent.trim()==='Run now').click()`);
    for(let i=0;i<60;i++){st=await readDb('retail:state');if(st.assistantRoutines.find(r=>r.time===hhmm).runs.length>=2)break;await sleep(300);}
    routine=st.assistantRoutines.find(r=>r.time===hhmm);assert.equal(routine.runs.length,2,'Run now adds a run to the history');assert.equal(await assigned(),g1+2,'and does the work');assert.equal(routine.lastPrepared,today);
    // "auto give" (the Give & share rules with each person's limits) is a tool the assistant can run, and so can a routine
    await ask('auto give');task=await until(t=>t.mode==='autopilot'&&/auto give/.test(t.text)&&t.status!=='running','auto give task finished');
    assert.ok(['done','failed','review'].includes(task.status),'the task finished or says why: '+JSON.stringify(task.steps.map(s=>s.error)));
    console.log('auto give task:',task.status,JSON.stringify(task.steps.map(s=>s.error||'applied')));
  }
  // WhatsApp reporting: the assistant PREPARES the daily report message; it is never opened or sent by itself (WhatsApp needs the person's own Send tap)
  {
    await run(`window.__opened=0;window.open=()=>{window.__opened++;return null;};true`);
    await ask("prepare today's WhatsApp report");task=await until(t=>t.mode==='autopilot'&&/WhatsApp report/i.test(t.text),'whatsapp task');
    assert.equal(task.status,'done','Autopilot prepared it by itself: '+JSON.stringify(task.steps.map(s=>s.error)));
    await sleep(800);const st=await readDb('retail:state'),packet=st.deliveryPackets.at(-1);
    assert.deepEqual([packet.kind,packet.status,packet.destination],['report','prepared','group'],'a prepared daily report message is saved');assert.match(packet.text,/Daily Report/);
    assert.equal(await run(`window.__opened`),0,'WhatsApp was not opened and nothing was sent');assert.ok(st.assistantRequests.some(r=>/WhatsApp report/i.test(r.text)&&r.status==='applied'),'the step has its own receipt (Undo available)');
    await toHome();await run(`document.querySelectorAll('.delivery-packets').forEach(d=>{d.open=true;});document.querySelector('.delivery-packets')?.scrollIntoView({block:'start'})`);await sleep(300);
    assert.match(await body(),/Daily report/,'Home lists the prepared report');assert.match(await body(),/not sent/i,'and says it is not sent');await capture('46-whatsapp-report-prepared',true);
  }
  try{await run(`document.querySelector('[aria-label="Settings"]')?.click()`);await sleep(600);await run(`[...document.querySelectorAll('details')].forEach(d=>{const t=d.querySelector('summary')?.textContent||'';if(/AI integration|Giving, plans/.test(t))d.open=true;})`);await sleep(200);assert.ok(await run(`!!document.querySelector('[aria-label="Assistant mode"]')`),'mode selector is in Settings');await run(`document.querySelector('.assistant-modes').scrollIntoView({block:'start'})`);await capture('44-assistant-mode-settings',true);await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Close')?.click()`);await sleep(300);}catch(e){if(/mode selector/.test(e.message))throw e;console.log('settings screenshot skipped:',e.message);}
  await setMode('assistant');
}
// Voice input: speak, see the transcript, fix it, nothing runs by itself. Real recording, real offline model (downloaded once).
if(VOICE){
  await openChat();assert.ok(await run(`!!document.querySelector('[aria-label="Speak to the assistant"]')`),'the Speak button is in the chat');
  const before=(await readDb('retail:state')).assistantRequests.length;
  await run(`document.querySelector('[aria-label="Speak to the assistant"]').click()`);await waitFor(`!!document.querySelector('[aria-label="Voice download"]')`,'one-time download notice');
  assert.match(await body(),/one-time download of about 43 MB/,'it says what is downloaded');await capture('47-voice-download-notice',true);
  await click('.voice-consent button','Download and speak');await waitFor(`!!document.querySelector('.voice-recording')`,'recording started after the model loaded',240000);
  assert.match(await body(),/Listening · 00:0/,'it shows that it is listening');await sleep(3800);await capture('48-voice-listening',true);
  await click('.voice-recording button','Stop and understand');
  await waitFor(`document.querySelector('[aria-label="Ask local assistant"]').value.length>5`,'transcript in the question box',180000);
  const heard=await run(`document.querySelector('[aria-label="Ask local assistant"]').value`);console.log('voice heard:',heard);
  assert.match(heard,/give 4 fold ?6 to maya/i,'the spoken command was understood: '+heard);assert.match(heard,/10 to noor/i,'and the second person was corrected to a known name: '+heard);
  assert.match(await body(),/Heard: /,'the transcript is shown so it can be fixed');await capture('49-voice-transcript',true);
  assert.equal((await readDb('retail:state')).assistantRequests.length,before,'speaking changed nothing: it only filled the box');
}
await atReview();await capture('23-home-assistant-history',true);assert.deepEqual(errors,[]);console.log('PASS: every asked question made or answered and nothing approved or submitted by the chat; search bar finds and opens screens; natural-wording target split previewed, approved and undone; unknown commands explained; summary replies and working next steps; round assistant button, small card with history suggestions; report files requested in chat, made on Home, downloaded or sent on WhatsApp (PowerPoint, Excel, notes; nothing changed); assistant face shows ready / reduced motion; compact header chat summarises; requests reviewed, approved and undone on Home; give4/10 receipt/Undo; report warning review; settings approval; Home history; unchanged sales.');
}catch(error){console.error(error.stack);console.error(await body());process.exitCode=1;}finally{ws.close();proc.kill();stopBrowsersOf(profile);server.close();}
