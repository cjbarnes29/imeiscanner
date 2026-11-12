// Camera check in headless Edge/Chrome with a fake camera that streams a real photo (not part of `npm test`; run `npm run build` first).
//   node scripts/e2e-camera.mjs
// Streams a sharp photo and a blurred copy through the app's camera screen and checks the live advice, tap-to-focus and the shot check.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile,readdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';

const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw new Error('No Edge/Chrome found.');
const photo=(await readdir('test-photos')).find(f=>/^multi-02\.jpg$/.test(f));
if(!photo)throw new Error('test-photos/multi-02.jpg is missing');
const work=await mkdtemp(join(tmpdir(),'imei-cam-'));
// 640x480 frames: the camera feed is a single JPEG repeated (mjpeg)
const feed=async(name,pipeline)=>{const buf=await pipeline(sharp('test-photos/'+photo).rotate().resize({width:640,height:480,fit:'contain',background:'#808080'})).jpeg({quality:92}).toBuffer();const file=join(work,name+'.mjpeg');await writeFile(file,Buffer.concat(Array(30).fill(buf)));return file;};
const feeds={sharp:await feed('sharp',p=>p),blurred:await feed('blurred',p=>p.blur(6))};

const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const file=join('dist',p==='/'?'index.html':p);const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4193);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let port=9340;const results=[];

async function session(name,videoFile){
  const profile=await mkdtemp(join(tmpdir(),'imei-camp-'));
  const myPort=port++;
  const proc=spawn(browser,['--headless=new','--disable-gpu',`--remote-debugging-port=${myPort}`,`--user-data-dir=${profile}`,'--window-size=420,1000','--no-first-run','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${videoFile}`,'about:blank'],{stdio:'ignore'});
  let targets;for(let i=0;i<60;i++){try{targets=await (await fetch(`http://127.0.0.1:${myPort}/json`)).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(500);}
  const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0;const waiting=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
  const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const run=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;};
  const waitFor=async(expr,label,ms=40000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expr))return true;}catch{}await sleep(300);}throw new Error('Timed out waiting for: '+label);};
  try{
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('imei-lens-simple-view','false');"});
    await send('Page.navigate',{url:'http://localhost:4193/'});
    await waitFor(`document.readyState==='complete'`,'load');
    await sleep(1500);
    await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Got it/.test(b.textContent));if(b)b.click();return true;})()`);
    await waitFor(`[...document.querySelectorAll('button')].some(b=>/^Scan with camera/.test(b.textContent.trim())&&!b.disabled)`,'camera button');
    await run(`[...document.querySelectorAll('button')].find(b=>/^Scan with camera/.test(b.textContent.trim())).click()`);
    await waitFor(`!!document.querySelector('.frame-quality')`,'live quality advice');
    await sleep(1500);
    const live=await run(`(()=>{const e=document.querySelector('.frame-quality');return {cls:e.className,text:e.textContent};})()`);
    // tap to focus
    const stage=await run(`(()=>{const r=document.querySelector('.camera-stage').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:stage.x,y:stage.y,button:'none'});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:stage.x,y:stage.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:stage.x,y:stage.y,button:'left',clickCount:1});
    await sleep(250);
    const ring=await run(`!!document.querySelector('.focus-ring')`);
    // capture and read the shot check
    await run(`[...document.querySelectorAll('button')].find(b=>/Capture/.test(b.textContent)&&!b.disabled).click()`);
    await waitFor(`/This shot|Check:/.test(document.body.innerText)`,'shot check',40000);
    const shot=await run(`(document.body.innerText.match(/(This shot:[^\\n]*|Check:[^\\n]*)/)||[''])[0]`);
    return {name,live,ring,shot};
  }finally{ws.close();proc.kill();}
}
try{
  for(const [name,file] of Object.entries(feeds)){
    const r=await session(name,file);results.push(r);
    console.log(`${name}: live advice [${r.live.cls.replace('frame-quality ','')}] "${r.live.text}" | tap-to-focus ring shown: ${r.ring} | shot check: ${r.shot}`);
  }
  const [good,bad]=results;
  assert.ok(/frame-quality-(good|soft|glare)/.test(good.live.cls)&&!/blurry/.test(good.live.cls),'sharp photo is not flagged blurry: '+good.live.cls);
  assert.ok(/frame-quality-blurry/.test(bad.live.cls),'blurred photo is flagged blurry: '+bad.live.cls);
  assert.ok(good.ring&&bad.ring,'tapping the camera shows the focus ring');
  assert.ok(/blurry/i.test(bad.shot),'the shot check of the blurred photo mentions blur: '+bad.shot);
  assert.ok(!/blurry/i.test(good.shot),'the shot check of the sharp photo does not mention blur: '+good.shot);
  console.log('PASS: camera screen: live advice tells sharp from blurred, tap shows the focus ring, the shot check mentions blur only for the blurred feed.');
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
finally{server.close();}
