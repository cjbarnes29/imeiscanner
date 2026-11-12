// Accuracy on labeled photos through the real in-browser scan (not part of `npm test`; run `npm run build` first).
//   node scripts/eval-labeled.mjs [folder=test-photos/composite] [name-filter] [--products=N] [--speed=fast|standard|detailed]
// folder/truth.json: { "photo.jpg": { products: [{imei, imei2?, serial?, model?}, ...] } } (make-composites.mjs writes it).
// Reports per photo: records vs products, IMEI 1 found / missed / invented, fields mixed between products, serial and
// model correct, and what was flagged for review. "Invented" = an IMEI that is not on any label of that photo.
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname,resolve} from 'node:path';
const args=process.argv.slice(2);
const opt=k=>(args.find(a=>a.startsWith('--'+k+'='))||'').split('=')[1];
const pos=args.filter(a=>!a.startsWith('--'));
const folder=pos[0]||'test-photos/composite',filter=pos[1]||'';
const truth=JSON.parse(await readFile(join(folder,'truth.json'),'utf8'));
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.gz':'application/gzip'};
const port=4200+Math.floor(Math.random()*50),dbg=9400+Math.floor(Math.random()*50);
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(port);
const profile=await mkdtemp(join(tmpdir(),'imei-eval-'));
const proc=spawn(browser,['--headless=new','--disable-gpu',`--remote-debugging-port=${dbg}`,`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<60;i++){try{targets=await (await fetch(`http://127.0.0.1:${dbg}/json`)).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;};
const waitFor=async(expr,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(500);}throw new Error('Timed out waiting for: '+label);};
const rowsOf=()=>run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const g=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));g.onsuccess=()=>{const rows=g.result.map(r=>({imei:r.imei||'',imei2:r.imei2||'',serial:r.serial||'',model:r.model||'',review:!!r.cropNeedsReview,status:r.status,deviceCount:r.deviceCount||0,sid:r.sourcePictureId,raw:r.raw||''}));db.close();res(rows);};};o.onerror=()=>res([]);})`);
const allTruthOf=t=>new Set(t.products.flatMap(p=>[p.imei,p.imei2].filter(Boolean)));
const speed=opt('speed')||'standard',products=Number(opt('products')||0);
const summary=[];
try{
  await send('Page.enable');await send('DOM.enable');
  const settings=`localStorage.setItem('imei-lens-simple-view','false');localStorage.setItem('imei-lens-scan-speed','${speed}');`;
  for(const [name,t] of Object.entries(truth)){
    if(filter&&!name.includes(filter))continue;
    const file=resolve(folder,name);if(!existsSync(file))continue;
    const known=t.products.filter(p=>p.imei&&!p.optional);const optionalImeis=t.products.filter(p=>p.optional).map(p=>p.imei);
    // the products setting: --products=auto-from-truth uses the real count (what a careful user would choose)
    const expectedCount=args.includes('--products=truth')?t.products.length:products;
    await send('Page.addScriptToEvaluateOnNewDocument',{source:settings+`localStorage.setItem('imei-lens-expected-products','${expectedCount}');`});
    await send('Page.navigate',{url:`http://localhost:${port}/`});
    await waitFor(`document.readyState==='complete'`,'load');
    await run(`new Promise(r=>{const q=indexedDB.deleteDatabase('imei-lens-v2');q.onsuccess=q.onerror=q.onblocked=()=>r(true);})`);
    await send('Page.navigate',{url:`http://localhost:${port}/`});
    await waitFor(`document.readyState==='complete'`,'reload');
    await sleep(1500);
    await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
    if(args.includes('--split')){
      // Phone-scanner path: the photo arrives as ONE flagged record (as the native scanner leaves it) and the web pipeline splits it.
      const photo='data:image/jpeg;base64,'+(await readFile(file)).toString('base64');
      await run(`new Promise((res,rej)=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>o.result.createObjectStore('inventory');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('inventory','readwrite');tx.objectStore('inventory').put({id:'seed-1',pictureId:'PIC-SEED1',sourcePictureId:'PIC-SEED1',number:3,personId:'',name:'IMG_native.jpg',dataUrl:${JSON.stringify(photo)},originalDataUrl:${JSON.stringify(photo)},model:'Unknown unit — review',imei:'',status:'Review',cropNeedsReview:true,deviceCount:${t.products.length},duplicate:false,createdAt:new Date().toISOString(),raw:''},'record:seed-1');tx.oncomplete=()=>{db.close();res(true);};tx.onerror=()=>rej(tx.error);};})`);
      await send('Page.navigate',{url:`http://localhost:${port}/`});
      await waitFor(`document.readyState==='complete'`,'reload seeded');await sleep(1500);
      await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
      await waitFor(`!!document.querySelector('.results tbody tr, .simple-record-photo')`,'record listed');
      await run(`(()=>{const b=document.querySelector('.results td img, .simple-record-photo, .results tbody tr button');if(b)b.click();return true;})()`);
      await waitFor(`!![...document.querySelectorAll('button')].find(b=>/Split automatically/.test(b.textContent))`,'split button');
      const t0=Date.now();
      await run(`[...document.querySelectorAll('button')].find(b=>/Split automatically/.test(b.textContent)).click()`);
      await waitFor(`!document.querySelector('.review-modal')`,'split done',600000);
      await sleep(1500);
      const rows2=await rowsOf();const ims=rows2.map(r=>r.imei).filter(Boolean);
      const seconds2=Math.round((Date.now()-t0)/1000);
      const truthI=new Set(known.map(p=>p.imei));const hit2=[...truthI].filter(i=>ims.includes(i));
      console.log(name.padEnd(18),'SPLIT PATH products',t.products.length,'· records',rows2.length,'· IMEI1',hit2.length+'/'+known.length,'· invented',ims.filter(i=>!allTruthOf(t).has(i)).length,'·',seconds2+'s');
      summary.push({name,products:t.products.length,knownImeis:known.length,records:rows2.length,hit:hit2.length,invented:ims.filter(i=>!allTruthOf(t).has(i)).length,mixed:0,dupes:0});
      continue;
    }
    await waitFor(`!!document.querySelector('input[type=file][accept="image/*"]')`,'file input');
    const doc=await send('DOM.getDocument');
    const node=await send('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'input[type=file][accept="image/*"]'});
    await send('DOM.setFileInputFiles',{nodeId:node.result.nodeId,files:[file]});
    await waitFor(`/photo\\(s\\) ready/.test(document.body.innerText)`,'queued');
    const started=Date.now();
    await run(`[...document.querySelectorAll('button')].find(b=>/Extract IMEI from|Scan 1 photo/.test(b.textContent)).click()`);
    let timedOut=false;
    try{await waitFor(`/Finished scanning|Scanning failed|could not be read/.test(document.body.innerText)`,'finished',600000);}catch{timedOut=true;}
    const seconds=Math.round((Date.now()-started)/1000);await sleep(1500);
    const rows=await rowsOf();
    if(args.includes('--debug'))console.log('   debug',JSON.stringify(await run('window.__dbg')));
    const truthImeis=new Set(known.map(p=>p.imei)),allTruth=new Set(t.products.flatMap(p=>[p.imei,p.imei2].filter(Boolean)));
    const found=rows.map(r=>r.imei).filter(Boolean);
    const hit=[...truthImeis].filter(i=>found.includes(i)),missed=[...truthImeis].filter(i=>!found.includes(i));
    const invented=found.filter(i=>!allTruth.has(i)),wrongField=found.filter(i=>!truthImeis.has(i)&&allTruth.has(i));
    const dupes=found.length-new Set(found).size;
    let mixed=0,serialOk=0,serialKnown=0,serialWrong=0,imei2Ok=0,imei2Known=0,modelOk=0,modelKnown=0;
    for(const r of rows){
      const own=known.find(p=>p.imei===r.imei);if(!own)continue;
      const others=known.filter(p=>p!==own);
      if(own.serial){serialKnown++;if(r.serial===own.serial)serialOk++;else if(r.serial){serialWrong++;if(others.some(p=>p.serial===r.serial))mixed++;}}
      else if(r.serial&&others.some(p=>p.serial===r.serial))mixed++;
      if(own.imei2){imei2Known++;if(r.imei2===own.imei2)imei2Ok++;else if(r.imei2&&others.some(p=>p.imei2===r.imei2))mixed++;}
      if(own.model){modelKnown++;if(r.model.includes(own.model.replace('SM-','')))modelOk++;else if(others.some(p=>p.model&&r.model.includes(p.model.replace('SM-',''))&&p.model!==own.model))mixed++;}
    }
    const flagged=rows.filter(r=>r.review||r.status!=='Valid').length;
    const line={name,products:t.products.length,knownImeis:known.length,records:rows.length,hit:hit.length,missed:missed.length,invented:invented.length,wrongField:wrongField.length,dupes,mixed,serial:`${serialOk}/${serialKnown}`,serialWrong,imei2:`${imei2Ok}/${imei2Known}`,model:`${modelOk}/${modelKnown}`,flagged,seconds,timedOut,deviceCount:Math.max(0,...rows.map(r=>r.deviceCount))};
    summary.push(line);
    console.log(`${name.padEnd(18)} products ${t.products.length} · records ${rows.length} · IMEI1 ${hit.length}/${known.length} · invented ${invented.length} · mixed ${mixed} · serial ${line.serial} (wrong ${serialWrong}) · imei2 ${line.imei2} · model ${line.model} · flagged ${flagged} · ${seconds}s${timedOut?' (TIMEOUT)':''}`);
    if(args.includes('--verbose'))for(const r of rows)console.log('     ',r.imei||'(none)',r.imei2||'-',r.serial||'-',r.model,r.review?'[crop review]':'',r.deviceCount?'[deviceCount '+r.deviceCount+']':'',r.status);
    if(missed.length)console.log('   missed:',missed.join(', '));
    if(invented.length)console.log('   INVENTED:',invented.join(', '));
    if(args.includes('--raw'))for(const r of rows.filter(r=>invented.includes(r.imei)||!r.imei))console.log('   RAW['+(r.imei||'none')+']:',r.raw.split('\n').join(' | '));
  }
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
finally{ws.close();proc.kill();server.close();}
const sum=k=>summary.reduce((s,x)=>s+(x[k]||0),0);
console.log(`\nTOTAL ${summary.length} photos · products ${sum('products')} (with a known IMEI ${sum('knownImeis')}) · IMEI 1 found ${sum('hit')} (${Math.round(100*sum('hit')/Math.max(1,sum('knownImeis')))}%) · invented ${sum('invented')} · mixed ${sum('mixed')} · duplicate records ${sum('dupes')} · settings speed=${speed} products=${products||'auto'}`);
await writeFile(join(tmpdir(),'eval-labeled-last.json'),JSON.stringify(summary,null,1));
