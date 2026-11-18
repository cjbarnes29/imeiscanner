// Emulator check of the Android routine helper (foreground service + alarm + page wake). Isolated .phonetest app on an EMULATOR only.
//   1. start the isolated app, forward its WebView devtools socket to 9229:  adb -s emulator-5554 forward tcp:9229 localabstract:webview_devtools_remote_<pid>
//   2. ADB_SERIAL=emulator-5554 node scripts/check-android-routine-helper.mjs
// It calls the real bridge (AndroidScanner.routineKeeper), then checks the service, notification, alarm and the wake event. Nothing in the app's data is touched.
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
const run=async expression=>{const n=++id,result=new Promise((resolve,reject)=>{pending.set(n,resolve);setTimeout(()=>{if(pending.delete(n))reject(new Error('no answer from the page for: '+expression.slice(0,60)));},15000);});ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));const response=await result;if(response.result?.exceptionDetails)throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0,300));return response.result?.result?.value;};
const service=()=>adb('shell','dumpsys','activity','services',PKG);
const stillRunning=()=>/RoutineKeeperService/.test(service());
try{
  assert.equal(await run(`typeof AndroidScanner.routineKeeper`),'function','the page has the new routine helper bridge');
  assert.equal(await run(`typeof AndroidScanner.routineKeeperStopRequested`),'function');
  await run(`window.__wake=0;window.addEventListener('retaillens-routine-wake',()=>{window.__wake++;});true`);
  const at=Date.now()+25000;
  await run(`AndroidScanner.routineKeeper(true,'emulator check at 00:00',${at});true`);await sleep(2500);
  const s=service();assert.match(s,/RoutineKeeperService/,'the helper service is running');assert.match(s,/isForeground=true/,'it is a foreground service');
  const notes=adb('shell','dumpsys','notification');assert.match(notes,/AI LENS timed routines are on/,'the ongoing notification is shown');
  const alarms=adb('shell','dumpsys','alarm');assert.match(alarms,/RoutineAlarmReceiver/,'the alarm is armed for the routine receiver');
  assert.equal(await run(`window.__wake`),0,'nothing wakes the page before the due time');
  const wait=at-Date.now()+6000;await sleep(Math.max(0,wait));
  assert.ok(await run(`window.__wake`)>=1,'at the due time Android woke the page (retaillens-routine-wake)');
  await run(`AndroidScanner.routineKeeper(false,'',0);true`);await sleep(2500);
  assert.ok(!stillRunning(),'switched off: the helper service stops');
  assert.doesNotMatch(adb('shell','dumpsys','notification'),/AI LENS timed routines are on/,'and its notification is gone');
  assert.equal(await run(`AndroidScanner.routineKeeperStopRequested()`),false,'no stray Turn off request');
  // a past or absurd time is refused: nothing starts
  await run(`AndroidScanner.routineKeeper(true,'in the past',${Date.now()-60000});true`);await sleep(1500);assert.ok(!stillRunning(),'a time in the past never starts the helper');
  console.log('PASS: routine helper on the emulator: foreground service + notification + exact alarm, woke the page at the due time, stopped when switched off, refused a past time.');
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}finally{try{await run(`AndroidScanner.routineKeeper(false,'',0);true`);}catch{/* already off */}ws.close();}
