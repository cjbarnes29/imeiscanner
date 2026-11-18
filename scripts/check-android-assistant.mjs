// Emulator check of the assistant in the real Android WebView: safety gate, chat, People / Calendar / Targets create-update-delete with Undo, Autopilot,
// and that every approved change is really in the saved data (read back from IndexedDB / localStorage, and again after a page reload).
// Isolated .phonetest app on an EMULATOR only; it never runs on a real phone and never touches the main app. SYNTHETIC names only.
//   1. start the isolated app, forward its WebView devtools socket to 9229:  adb -s emulator-5554 forward tcp:9229 localabstract:webview_devtools_remote_<pid>
//   2. ADB_SERIAL=emulator-5554 node scripts/check-android-assistant.mjs
// The test leaves the app's people, settings and mode as it found them (it undoes what it adds and restores the mode).
import assert from 'node:assert/strict';
const SERIAL = process.env.ADB_SERIAL || '';
assert.ok(/^emulator-\d+$/.test(SERIAL), 'Set ADB_SERIAL to an emulator serial. This check never runs on a real phone.');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pages = await fetch('http://127.0.0.1:9229/json').then(r => r.json());
const page = pages.find(p => p.type === 'page' && p.url.includes('appassets.androidplatform.net'));
assert.ok(page, 'the isolated app WebView must be forwarded to port 9229');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception'); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.delete(n)) reject(new Error('no answer from the page for ' + method)); }, 30000); });
await send('Runtime.enable');
const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
const waitFor = async (expression, label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(expression)) return true; } catch { /* page busy */ } await sleep(250); } throw new Error('Timed out waiting for: ' + label); };
const clickText = (selector, text) => run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const click = async (selector, text) => { if (!await clickText(selector, text)) throw new Error(`no enabled "${text}" in ${selector}`); };
const setVal = (selector, value) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
const readDb = key => run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const q=db.transaction('inventory').objectStore('inventory').get(${JSON.stringify(key)});q.onsuccess=()=>{db.close();res(q.result);};};})`);
const readPeople = async () => JSON.parse(await run(`localStorage.getItem('imei-lens-people-v1')||'[]'`));
const names = async () => (await readPeople()).map(p => p.name);
const SKIP = ['assistantRequests', 'assistantTasks', 'audit', 'history'];
const snap = async () => { const s = await readDb('retail:state'); for (const k of SKIP) delete s[k]; return JSON.stringify({ retail: s, people: await readPeople(), options: await run(`localStorage.getItem('retaillens-auto-workflow-v1')`) }); };
const requests = async () => (await readDb('retail:state')).assistantRequests || [];
const tasks = async () => ((await readDb('retail:state')).assistantTasks || []).length;
const pendingCount = async () => (await requests()).filter(r => r.status === 'pending').length;

const results = [], timings = [];
const step = async (name, fn) => { try { await fn(); results.push([true, name]); console.log('PASS', name); } catch (e) { results.push([false, name + ' -> ' + e.message]); console.log('FAIL', name, '->', e.message); } };

// ---- driving the real screens -------------------------------------------------------------------------------------------------------------
const chatOpen = () => run(`!!document.querySelector('.assistant-panel')`);
const openChat = async () => { if (!await chatOpen()) { await run(`document.querySelector('[aria-label="Open assistant"]').click()`); await waitFor(`!!document.querySelector('.assistant-panel')`, 'the assistant opens'); await sleep(400); } };
const outputText = () => run(`document.querySelector('.assistant-panel .plan-ai-output')?.innerText||''`);
const statusText = () => run(`document.querySelector('.assistant-panel .plan-ai-status')?.innerText||''`);
const ask = async text => { await openChat(); const before = await outputText(); const t0 = Date.now(); assert.equal(await setVal('.assistant-panel [aria-label="Ask local assistant"]', text), true, 'the chat box'); await sleep(150); await click('.assistant-panel button', 'Get answer'); await waitFor(`(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')!==${JSON.stringify(before)}`, 'an answer to: ' + text, 20000).catch(async () => { await sleep(1500); }); timings.push(Date.now() - t0); await sleep(300); return { answer: await outputText(), status: await statusText() }; };
const toHome = async () => { await click('.assistant-panel button', 'Review requests on Home'); await waitFor(`!document.querySelector('.assistant-panel')&&!!document.querySelector('.assistant-requests')`, 'Home review'); await sleep(400); };
const approve = async () => { await run(`(()=>{const c=document.querySelector('.assistant-requests .assistant-request input[type=checkbox]');if(c&&!c.checked)c.click();return true;})()`); await sleep(200); await click('.assistant-requests .assistant-request button', 'Approve changes'); await sleep(900); };
const undoLatest = async () => { await click('.assistant-requests button', 'Undo this action'); await sleep(900); };
const settle = async (check, label) => { const end = Date.now() + 8000; while (Date.now() < end) { if (await check()) return; await sleep(250); } throw new Error('not saved in time: ' + label); };
const lastStatus = async prefix => (await requests()).slice().reverse().find(r => r.text.startsWith(prefix))?.status;
const reload = async () => { await run('location.reload()').catch(() => {}); await sleep(2500); await waitFor(`document.readyState==='complete'&&!!document.querySelector('[aria-label="Open assistant"]')`, 'the app after reload', 60000); await sleep(800); };
const ALL = ['stock', 'give', 'report', 'calendar', 'targets', 'routine', 'whatsapp', 'settings', 'accessory', 'add-stock', 'people', 'remove'];
const setMode = async mode => { await run(`(()=>{localStorage.setItem('retaillens-auto-workflow-v1',JSON.stringify(${mode ? `{assistantMode:'${mode}',autopilotAllow:${JSON.stringify(ALL)},autopilotDailyCap:50}` : '{}'}));window.dispatchEvent(new Event('retaillens-workflow-change'));return true;})()`); await sleep(400); };

// leftovers from an earlier run of this check (isolated test app only): reject waiting requests and remove the test people, so every run starts the same
{
  const waiting = await pendingCount();
  if (waiting) {
    if (await chatOpen()) await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`);
    await sleep(500); await waitFor(`!!document.querySelector('.assistant-requests')`, 'the Home review area');
    if (await clickText('.assistant-requests button', 'Reject all')) { await sleep(300); await click('.assistant-requests button', 'Yes, reject all'); } else await click('.assistant-requests .assistant-request button', 'Reject');
    await sleep(900);
  }
  for (const name of ['Zed', 'Khurram', 'Khuram', 'Raseen', 'Carlou']) if ((await names()).includes(name)) { await ask('delete ' + name.toLowerCase()); await toHome(); await approve(); await settle(async () => !(await names()).includes(name), 'old test person ' + name + ' removed'); }
}
const originalOptions = await run(`localStorage.getItem('retaillens-auto-workflow-v1')`);
const originalPeople = JSON.stringify(await readPeople());
const tomorrow = await run(`(()=>{const d=new Date(Date.now()+86400000),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());})()`);
const month = tomorrow.slice(0, 7);
console.log('emulator check starting; app date', tomorrow, 'is tomorrow; people before:', originalPeople, '; mode setting before:', originalOptions);

const SAFETY_A = ['what if i give 4 fold6 to person 1', 'should i store 4 fold6', "don't give anything", 'delete everything', 'give about 4 fold6 to person 1', 'how do i set my flagship 1 target to 12', 'can i remove 2 fold6 from stock', 'set report fold6 to 6 if possible', 'i might add a person called zed', 'never delete anyone', 'what happens if i turn off auto detection', 'i planned to give person 1 4 fold6'];
const SAFETY_B = ['what if i delete khuram', 'should i remove raseen', "don't remove carlou", 'rename khuram or raseen to zed', 'is raseen on leave tomorrow', 'asha might be off friday', 'what happens if i set khuram flagship 1 target to 12'];
const checkUnsafe = async list => { for (const text of list) { const before = await snap(), p0 = await pendingCount(); const r = await ask(text); assert.equal(await snap(), before, `"${text}" changed saved data`); assert.equal(await pendingCount(), p0, `"${text}" left a request waiting for approval`); assert.ok(!/saved for review/.test(r.status), `"${text}" was queued: ${r.status}`); } };

try {
  await step('real Android WebView with the native bridge, test app (not the main app)', async () => {
    const ua = await run('navigator.userAgent'); assert.match(ua, /; wv\)/, 'a WebView user agent'); assert.equal(await run('typeof AndroidScanner'), 'object');
    assert.match(await run('location.href'), /appassets\.androidplatform\.net/);
  });
  await step('Settings > About shows version 1.27.3 and the build commit', async () => {
    await run(`document.querySelector('[aria-label="Settings"]').click()`); await waitFor(`!!document.querySelector('.settings-about')`, 'Settings');
    const about = await run(`document.querySelector('.settings-about').innerText`); console.log('   About says:', about.replace(/\n/g, ' | ').slice(0, 160));
    assert.match(about, /Version 1\.27\.3 \([0-9a-f]{7}\)/); process.env.ABOUT = about; await reload();
  });
  await step('default mode is Assistant (nothing applies by itself)', async () => { const o = JSON.parse((await run(`localStorage.getItem('retaillens-auto-workflow-v1')`)) || '{}'); assert.ok(!o.assistantMode || o.assistantMode === 'assistant', 'mode: ' + o.assistantMode); });
  await step(`safety gate in the WebView: ${SAFETY_A.length} questions / what-ifs / negations / unclear requests change nothing`, () => checkUnsafe(SAFETY_A));

  await step('chat: "add 3 person khuram raseen and carlou" is previewed and NOT applied until approved', async () => {
    const before = JSON.stringify(await names()); const r = await ask('add 3 person khuram raseen and carlou');
    assert.match(r.status, /saved for review on Home/); assert.match(r.answer, /Not applied yet/); assert.equal(JSON.stringify(await names()), before, 'nothing applied before approval');
    assert.equal(await run(`document.querySelector('.assistant-panel .ai-mascot-label')?.innerText`), 'Something is ready for your review on Home');
  });
  await step('approve (People create): the 3 people are in the saved data and survive a page reload', async () => {
    await toHome(); await approve(); await settle(async () => (await names()).includes('Carlou'), 'people in localStorage');
    const n = await names(); for (const x of ['Khuram', 'Raseen', 'Carlou']) assert.ok(n.includes(x), x + ' saved'); assert.equal(await lastStatus('add 3 person'), 'applied');
    await reload(); const again = await names(); for (const x of ['Khuram', 'Raseen', 'Carlou']) assert.ok(again.includes(x), x + ' still there after reload');
  });
  await step(`safety gate with real names: ${SAFETY_B.length} more sentences change nothing`, () => checkUnsafe(SAFETY_B));

  await step('People update: rename Khuram to Khurram, saved, then Undo restores it', async () => {
    await ask('can you rename khuram to khurram for me'); await toHome(); await approve(); await settle(async () => (await names()).includes('Khurram'), 'rename saved');
    assert.ok(!(await names()).includes('Khuram')); await undoLatest(); await settle(async () => (await names()).includes('Khuram'), 'rename undone'); assert.ok(!(await names()).includes('Khurram'));
  });
  await step('People delete: delete Raseen is only a preview until approved, then removed, then Undo brings back the same person', async () => {
    const before = await readPeople(); await ask('get rid of raseen'); assert.equal(JSON.stringify(await readPeople()), JSON.stringify(before), 'a delete request changes nothing by itself');
    await toHome(); await approve(); await settle(async () => !(await names()).includes('Raseen'), 'delete saved');
    await undoLatest(); await settle(async () => (await names()).includes('Raseen'), 'delete undone'); assert.equal(JSON.stringify(await readPeople()), JSON.stringify(before), 'exactly the same people (same ids) are back');
  });
  await step('Calendar create/undo: "khuram is sick tomorrow" saves a leave day, Undo removes it', async () => {
    const person = (await readPeople()).find(p => p.name === 'Khuram'); await ask('khuram is sick tomorrow'); await toHome(); await approve();
    await settle(async () => { const s = await readDb('retail:state'); return (s.workSchedules?.[person.id]?.annualLeave || []).some(r => r.start === tomorrow); }, 'leave saved');
    await undoLatest(); await settle(async () => { const s = await readDb('retail:state'); return !(s.workSchedules?.[person.id]?.annualLeave || []).some(r => r.start === tomorrow); }, 'leave undone');
  });
  await step('Targets update/undo: "set khuram flagship 1 target to 12" saves 12, Undo removes it', async () => {
    const person = (await readPeople()).find(p => p.name === 'Khuram'); const line = async () => ((await readDb('retail:state')).targets?.[month]?.[person.id]?.lines || []).find(l => l.segment === 'flagship1')?.target || 0;
    await ask('set khuram flagship 1 target to 12'); await toHome(); await approve(); await settle(async () => (await line()) === 12, 'target saved'); await undoLatest(); await settle(async () => (await line()) === 0, 'target undone');
  });

  await step('Autopilot with every kind of change allowed: unsafe sentences start no task and change nothing', async () => {
    await setMode('autopilot'); const t0 = await tasks(); await checkUnsafe(['what if i give 4 fold6 to khuram', "don't remove carlou", 'delete everything', 'should i add a person called zed']); assert.equal(await tasks(), t0, 'no task was started');
  });
  await step('Autopilot applies a clear, allowed request by itself and the saved data shows it', async () => {
    await ask('add person zed'); await settle(async () => (await names()).includes('Zed'), 'Zed applied by Autopilot'); await reload(); assert.ok((await names()).includes('Zed'), 'Zed persisted after reload');
  });
  await step('Autopilot never deletes: "delete zed" waits for a person', async () => {
    await ask('delete zed'); await sleep(3500); assert.ok((await names()).includes('Zed'), 'Zed was not deleted by Autopilot');
  });
  await setMode(null);
  await step('mode switched back to Assistant; the held delete is approved by a person and Zed is removed', async () => {
    await run(`localStorage.removeItem('retaillens-auto-workflow-v1');window.dispatchEvent(new Event('retaillens-workflow-change'));true`); await sleep(500);
    await openChat(); await toHome().catch(async () => { await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`); }); await sleep(300);
    const hasCard = await run(`!!document.querySelector('.assistant-requests .assistant-request')`); if (!hasCard) { await ask('delete zed'); await toHome(); }
    await approve(); await settle(async () => !(await names()).includes('Zed'), 'Zed removed after approval');
  });
  await step('cleanup: remove the 3 test people so the app is as found', async () => {
    await ask('delete khuram, raseen and carlou'); await toHome(); await approve(); await settle(async () => (await names()).length === JSON.parse(originalPeople).length, 'people back to the start');
    assert.equal(JSON.stringify(await readPeople()), originalPeople, 'the same people as before the test');
  });
  await step('no JavaScript errors were thrown in the page during the whole run', async () => { assert.equal(pageErrors.length, 0, pageErrors.slice(0, 3).join(' | ')); });
} finally {
  try { await run(originalOptions === null ? `localStorage.removeItem('retaillens-auto-workflow-v1');true` : `localStorage.setItem('retaillens-auto-workflow-v1',${JSON.stringify(originalOptions)});true`); } catch { /* page gone */ }
  ws.close();
}
const failed = results.filter(r => !r[0]);
const avg = timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0;
console.log(`\n${results.length - failed.length} of ${results.length} emulator checks passed. Chat answers took ${avg} ms on average (slowest ${Math.max(0, ...timings)} ms) over ${timings.length} questions.`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' -', f[1]); process.exitCode = 1; }
