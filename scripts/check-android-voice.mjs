// Emulator check of voice input in the real Android WebView. Isolated .phonetest app on an EMULATOR only.
//   1. adb -s emulator-5554 shell pm grant com.imeilens.scanner.phonetest android.permission.RECORD_AUDIO   (so no system dialog appears)
//   2. start the isolated app and forward its devtools socket to 9229:  adb -s emulator-5554 forward tcp:9229 localabstract:webview_devtools_remote_<pid>
//   3. ADB_SERIAL=emulator-5554 node scripts/check-android-voice.mjs      (needs internet once: the 43 MB voice model downloads into the app)
// It records the emulator's microphone, decodes it, then drives the real Speak button: download notice, model load in the WebView, recording, and the
// "nothing heard" message (the emulator's microphone is silent). The voice model stays cached in the isolated app afterwards.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const SERIAL=process.env.ADB_SERIAL||'',ADB=process.env.ADB||'adb',PKG='com.imeilens.scanner.phonetest';
assert.ok(/^emulator-\d+$/.test(SERIAL),'Set ADB_SERIAL to an emulator serial. This check never runs on a real phone.');
const adb=(...args)=>execFileSync(ADB,['-s',SERIAL,...args],{encoding:'utf8',maxBuffer:64*1024*1024});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pages=await fetch('http://127.0.0.1:9229/json').then(r=>r.json());
const page=pages.find(p=>p.type==='page'&&p.url.includes('appassets.androidplatform.net'));assert.ok(page,'isolated app WebView must be forwarded to port 9229');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));let id=0;const pending=new Map();
ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
const run=async(expression,ms=20000)=>{const n=++id,result=new Promise((resolve,reject)=>{pending.set(n,resolve);setTimeout(()=>{if(pending.delete(n))reject(new Error('no answer from the page for: '+expression.slice(0,70)));},ms);});ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));const response=await result;if(response.result?.exceptionDetails)throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0,400));return response.result?.result?.value;};
const waitFor=async(expression,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await run(expression))return;}catch{/* the page may be busy */}await sleep(500);}throw new Error('Timed out waiting for: '+label);};
try{
  assert.match(adb('shell','dumpsys','package',PKG),/RECORD_AUDIO: granted=true/,'the microphone permission is granted to the isolated app');
  // 1. the microphone itself: record 1.5 s, decode to 16 kHz like the app does. An emulator started with -no-audio has no microphone: that is reported, not hidden.
  let micWorks=true;
  try{
    const clip=await run(`(async()=>{const s=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1}});const r=new MediaRecorder(s),chunks=[];r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};r.start(250);await new Promise(x=>setTimeout(x,1500));await new Promise(x=>{r.onstop=x;r.stop();});s.getTracks().forEach(t=>t.stop());const buf=await new Blob(chunks,{type:r.mimeType}).arrayBuffer();const ctx=new AudioContext({sampleRate:16000});const d=await ctx.decodeAudioData(buf);return {bytes:buf.byteLength,samples:d.length,rate:d.sampleRate,type:r.mimeType};})()`,30000);
    assert.ok(clip.bytes>300&&clip.samples>8000,'the WebView recorded and decoded the microphone: '+JSON.stringify(clip));
  }catch(error){
    if(!/Could not start audio source|NotReadable/i.test(error.message))throw error; // a permission error (NotAllowed) would be a real failure
    micWorks=false;console.log('NOTE: this emulator has no working microphone (started with -no-audio?). The permission was granted; Chromium reached the audio device. Recording itself is NOT verified here.');
  }
  // 2. the real Speak button
  await run(`(()=>{if(!document.querySelector('.assistant-panel'))document.querySelector('[aria-label="Open assistant"]')?.click();return true;})()`);
  await waitFor(`!!document.querySelector('[aria-label="Speak to the assistant"]')`,'the Speak button in the assistant chat',30000);
  const cached=await run(`caches.has('retaillens-voice-v1')`);
  await run(`document.querySelector('[aria-label="Speak to the assistant"]').click();true`);
  if(!cached){
    await waitFor(`!!document.querySelector('[aria-label="Voice download"]')`,'the one-time download notice');
    await run(`[...document.querySelectorAll('.voice-consent button')].find(b=>/Download and speak/.test(b.textContent)).click();true`);
  }
  // the model downloads and loads first; then recording starts (or, without a microphone, the page says it could not start)
  await waitFor(`!!document.querySelector('.voice-recording')||/microphone could not start|microphone is off/i.test(document.body.innerText)`,'the model loaded in the WebView',600000);
  assert.ok(await run(`caches.has('retaillens-voice-v1')`),'the voice model is kept in the app for offline use');
  assert.ok(await run(`caches.open('retaillens-voice-v1').then(c=>c.match('https://retaillens.invalid/voice-ready')).then(Boolean)`),'and it is marked ready');
  if(micWorks){
    await waitFor(`!!document.querySelector('.voice-recording')`,'recording started');await sleep(1500);
    await run(`[...document.querySelectorAll('.voice-recording button')].find(b=>/Stop and understand/.test(b.textContent)).click();true`);
    await waitFor(`/did not hear anything|Heard:/.test(document.body.innerText)`,'a result after stopping',120000);
  }else assert.match(await run(`document.body.innerText`),/microphone could not start/i,'without a microphone the app says so and typing still works');
  console.log('PASS: voice in the Android WebView: permission path, one-time download notice, model downloaded and loaded in a worker, cached for offline'+(micWorks?', recording and stop worked.':'. Recording was not tested: no microphone on this emulator.'));
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}finally{ws.close();}
