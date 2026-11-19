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
const confirmRemoval = async () =>{const state=await run(`(()=>{const q=document.querySelector('.assistant-requests .assistant-request');const b=q&&q.querySelector('button[data-confirm="hold"]');if(b){b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 'hold';}const i=q&&q.querySelector('.confirm-typed input');if(i){const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'CONFIRM');i.dispatchEvent(new Event('input',{bubbles:true}));return 'typed';}return 'none';})()`);if(state==='hold')await sleep(1300);if(state==='typed'){await sleep(200);await click('.assistant-requests .assistant-request button','Approve removal');}return state;};
const setVal = (selector, value) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
const readDbRaw = key => run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>{o.transaction.abort();};o.onerror=()=>res(undefined);o.onsuccess=()=>{const db=o.result;try{const q=db.transaction('inventory').objectStore('inventory').get(${JSON.stringify(key)});q.onsuccess=()=>{db.close();res(q.result);};q.onerror=()=>{db.close();res(undefined);};}catch(e){db.close();res(undefined);}};})`);
// a freshly installed test app has no saved data yet: treat "nothing stored" as an empty record, not an error
const readDb = async key => { const v = await readDbRaw(key); return v === undefined || v === null ? (key.endsWith(':') ? [] : {}) : v; };
const readPeople = async () => JSON.parse(await run(`localStorage.getItem('imei-lens-people-v1')||'[]'`));
const names = async () => (await readPeople()).map(p => p.name);
const SKIP = ['assistantRequests', 'assistantTasks', 'audit', 'history'];
// compared as data: the order of the keys inside an object does not matter (the loader tidies it on the first save after a reload)
const stable = v => JSON.stringify(v, (k, val) => val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val);
const snap = async () => { const s = await readDb('retail:state'); for (const k of SKIP) delete s[k]; const ac = s.agentChat; if (ac && !ac.memoryOn && !(ac.memory || []).length && !Object.keys(ac.prefs || {}).length) delete s.agentChat; /* an empty default is not saved data */ return stable({ retail: s, people: await readPeople(), options: await run(`localStorage.getItem('retaillens-auto-workflow-v1')`) }); };
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
const approve = async () => { await run(`(()=>{const c=document.querySelector('.assistant-requests .assistant-request input[type=checkbox]');if(c&&!c.checked)c.click();return true;})()`); await sleep(200); if (await run(`!!document.querySelector('.assistant-requests .assistant-request button[data-confirm="hold"], .assistant-requests .assistant-request .confirm-typed')`)) await confirmRemoval(); else await click('.assistant-requests .assistant-request button', 'Approve changes'); await sleep(900); };
const undoLatest = async () => { await click('.assistant-requests button', 'Undo this action'); await sleep(900); };
const settle = async (check, label) => { const end = Date.now() + 8000; while (Date.now() < end) { if (await check()) return; await sleep(250); } throw new Error('not saved in time: ' + label); };
const lastStatus = async prefix => (await requests()).slice().reverse().find(r => r.text.startsWith(prefix))?.status;
const reload = async () => { await run('location.reload()').catch(() => {}); await sleep(2500); await waitFor(`document.readyState==='complete'&&!!document.querySelector('[aria-label="Open assistant"]')`, 'the app after reload', 60000); await sleep(800); };
const ALL = ['stock', 'give', 'report', 'calendar', 'targets', 'routine', 'whatsapp', 'settings', 'accessory', 'add-stock', 'people', 'remove'];
const setMode = async mode => { await run(`(()=>{localStorage.setItem('retaillens-auto-workflow-v1',JSON.stringify(${mode ? `{assistantMode:'${mode}',autopilotAllow:${JSON.stringify(ALL)},autopilotDailyCap:50}` : '{}'}));window.dispatchEvent(new Event('retaillens-workflow-change'));return true;})()`); await sleep(400); };

// a freshly installed test app shows its one-time welcome dialog: close it so the check starts from the normal screen
await run(`(()=>{const welcome=document.body.innerText.includes('Welcome to AI LENS');const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Close');if(welcome&&b)b.click();return true;})()`); await sleep(700);
// a brand-new app has not saved its data yet: do one harmless question so the first full save happens BEFORE the safety checks take their baseline
if (!('accessoryStock' in await readDb('retail:state'))) { await ask('what if i give 4 fold6 to person 1'); await sleep(3000); } // warm-up: this question makes the app's first full save, so the checks below compare like with like
// leftovers from an earlier run of this check (isolated test app only): reject waiting requests and remove the test people, so every run starts the same
{
  // held tasks from an earlier (possibly failed) run would hit the app's limit of 10 open tasks: reject them first
  if (await chatOpen()) await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`);
  await sleep(400); await clickText('.bottom-nav button', 'Home'); await sleep(600);
  for (let i = 0; i < 12 && await clickText('.assistant-tasks button', 'Reject the rest'); i++) await sleep(500);
  const waiting = await pendingCount();
  if (waiting) {
    if (await chatOpen()) await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`);
    await sleep(500); await clickText('.bottom-nav button', 'Home'); await sleep(600); await waitFor(`!!document.querySelector('.assistant-requests')`, 'the Home review area');
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
const quiet = async () => { let prev = await snap(); for (let i = 0; i < 8; i++) { await sleep(500); const cur = await snap(); if (cur === prev) return cur; prev = cur; } return prev; };
const diffKeys = (a, b) => { const x = JSON.parse(a), y = JSON.parse(b), out = [...new Set([...Object.keys(x.retail), ...Object.keys(y.retail)])].filter(k => JSON.stringify(x.retail[k]) !== JSON.stringify(y.retail[k])); if (JSON.stringify(x.people) !== JSON.stringify(y.people)) out.push('people'); if (x.options !== y.options) out.push('options'); return out; };
const checkUnsafe = async list => { for (const text of list) { const before = await quiet(), p0 = await pendingCount(); const r = await ask(text); const after = await snap(); assert.ok(after === before, `"${text}" changed saved data: ${diffKeys(before, after).join(', ')}` + (diffKeys(before, after).includes('agentLog') ? ' | log before ' + JSON.stringify(JSON.parse(before).retail.agentLog?.slice(-2)) + ' | log after ' + JSON.stringify(JSON.parse(after).retail.agentLog?.slice(-2)) : '')); assert.equal(await pendingCount(), p0, `"${text}" left a request waiting for approval`); assert.ok(!/saved for review/.test(r.status), `"${text}" was queued: ${r.status}`); } };

try {
  await step('real Android WebView with the native bridge, test app (not the main app)', async () => {
    const ua = await run('navigator.userAgent'); assert.match(ua, /; wv\)/, 'a WebView user agent'); assert.equal(await run('typeof AndroidScanner'), 'object');
    assert.match(await run('location.href'), /appassets\.androidplatform\.net/);
  });
  await step('Settings > About shows version 1.29.0 and the build commit', async () => {
    await run(`document.querySelector('[aria-label="Settings"]').click()`); await waitFor(`!!document.querySelector('.settings-about')`, 'Settings');
    const about = await run(`document.querySelector('.settings-about').innerText`); console.log('   About says:', about.replace(/\n/g, ' | ').slice(0, 160));
    assert.match(about, /Version 1.29.0 \([0-9a-f]{7}\)/); process.env.ABOUT = about; await reload();
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
    await settle(async () => (await requests()).slice().reverse().find(r => r.text.startsWith('add 3 person'))?.verify === 'verified', 'the approval was confirmed against the saved data');
    const entries = ((await readDb('retail:state')).agentLog || []).filter(e => e.tool === 'people.create').slice(-2);
    assert.ok(entries.some(e => e.verify === 'verified' && e.outcome === 'applied' && e.actor === 'you' && e.mode === 'assistant'), 'the audit log has the approval, confirmed by reading the data back');
    assert.ok(!JSON.stringify(entries).match(/\b\d{15}\b/), 'no full IMEI in the audit log');
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
    if (!(await pendingCount())) { await ask('delete zed'); await toHome(); }
    await approve(); await settle(async () => !(await names()).includes('Zed'), 'Zed removed after approval');
  });
  await step('cleanup: remove the 3 test people so the app is as found', async () => {
    await ask('delete khuram, raseen and carlou'); await toHome(); await approve(); await settle(async () => (await names()).length === JSON.parse(originalPeople).length, 'people back to the start');
    assert.equal(JSON.stringify(await readPeople()), originalPeople, 'the same people as before the test');
  });
  const chatButtons = () => run(`[...document.querySelectorAll('.assistant-panel .assistant-chat-actions button')].map(b=>b.textContent.trim())`);
  await step('in-chat Approve now: previewed, approved in the chat, saved and checked, then "undo that" removes it', async () => {
    const before = JSON.stringify(await names());
    const r = await ask('add person Qa'); assert.match(r.answer, /Not applied yet/); assert.equal(JSON.stringify(await names()), before, 'nothing is applied before Approve');
    assert.ok((await chatButtons()).includes('Approve now') && (await chatButtons()).includes('Reject'), 'Approve and Reject are offered in the chat');
    await click('.assistant-panel .assistant-chat-actions button', 'Approve now');
    await settle(async () => (await names()).includes('Qa'), 'Qa saved'); await settle(async () => /Approved and saved/.test(await outputText()), 'the chat says it was checked in the saved data');
    await settle(async () => ((await readDb('retail:state')).agentLog || []).slice(-1)[0]?.verify === 'verified', 'the audit log shows it was verified');
    await ask('undo that'); await settle(async () => !(await names()).includes('Qa'), 'undone by "undo that"'); assert.equal(JSON.stringify(await names()), before);
  });
  await step('follow-ups in the WebView: "rename qa to qb" then "yes" approves; "no" rejects; a delete is never approved from the chat', async () => {
    await ask('add person Qa'); await click('.assistant-panel .assistant-chat-actions button', 'Approve now'); await settle(async () => (await names()).includes('Qa'), 'Qa saved');
    await ask('rename qa to qb'); await ask('yes'); await settle(async () => (await names()).includes('Qb'), 'the rename was approved by "yes"');
    await ask('rename qb to qc'); await ask('no'); assert.ok((await names()).includes('Qb') && !(await names()).includes('Qc'), '"no" rejects it'); assert.match(await outputText(), /Rejected/);
    await ask('delete qb'); assert.ok(!(await chatButtons()).includes('Approve now'), 'a delete is only offered on Home'); await ask('yes'); assert.ok((await names()).includes('Qb'), '"yes" cannot approve a delete');
    await toHome(); await approve(); await settle(async () => !(await names()).includes('Qb'), 'the delete was approved on Home');
    assert.equal(JSON.stringify(await readPeople()), originalPeople, 'the same people as at the start');
  });
  await step('memory in the WebView: off by default, opt-in from Settings, visible, editable, deletable, never IMEIs', async () => {
    if (await chatOpen()) await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`); await sleep(500);
    await ask('remember that maya covers the north store'); assert.match(await outputText(), /Memory is off/, 'nothing is remembered while memory is off');
    assert.ok(!(await readDb('retail:state')).agentChat?.memory?.length, 'nothing was stored');
    await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`); await sleep(500);
    await run(`document.querySelector('[aria-label="Settings"]').click()`); await waitFor(`!!document.querySelector('.settings-local-ai button')`, 'Settings'); await click('.settings-local-ai button', 'Local AI');
    await waitFor(`!!document.querySelector('.assistant-backdrop .assistant-panel')&&!!document.querySelector('.assistant-memory')`, 'Memory & preferences opened from Settings');
    await run(`document.querySelector('.assistant-memory').open=true;document.querySelector('.assistant-memory input[type=checkbox]').click()`); await sleep(900);
    assert.equal((await readDb('retail:state')).agentChat.memoryOn, true, 'memory is on only after the switch');
    await ask('remember that maya covers the north store'); await settle(async () => /Remembered/.test(await outputText()), 'remembered'); await ask('what do you remember'); assert.match(await outputText(), /maya covers the north store/i);
    const fake = '49015420' + '000123' + '9'; await ask('remember that the phone is ' + fake); assert.match(await outputText(), /never remember IMEI/, 'IMEIs are refused'); assert.ok(!JSON.stringify(await readDb('retail:state')).includes(fake), 'the digits are nowhere in the saved data');
    await run(`(()=>{const el=document.querySelector('.assistant-memory .memory-note input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'maya covers the south store');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await click('.assistant-memory .memory-note button', 'Save'); await settle(async () => (await readDb('retail:state')).agentChat.memory[0]?.text === 'maya covers the south store', 'an edit is saved');
    await click('.assistant-memory .memory-note button', 'Delete'); await settle(async () => (await readDb('retail:state')).agentChat.memory.length === 0, 'a note can be deleted');
    await run(`document.querySelector('.assistant-memory input[type=checkbox]').click()`); await settle(async () => (await readDb('retail:state')).agentChat.memoryOn === false, 'memory is switched off again');
    await run(`document.querySelector('[aria-label="Close assistant"]')?.click()`);
  });
  await step('AI agent in the WebView (simulated provider): off = no calls; on = answer, plan waits for Approve, approve saves and checks it, Undo removes it; names and IMEIs never sent', async () => {
    const KEYS = ['imei-lens-ai-v1', 'imei-lens-ai-usage-v1', 'imei-lens-convo-v1'];
    await run(`(()=>{${JSON.stringify(KEYS)}.forEach(k=>localStorage.removeItem(k));window.__ai={calls:[],next:()=>({action:'reply',text:'ok'})};if(!window.__realFetch)window.__realFetch=window.fetch.bind(window);
      window.fetch=async(url,init)=>{if(String(url).includes('generativelanguage.googleapis.com')){const b=JSON.parse(init.body);window.__ai.calls.push({user:b.contents[b.contents.length-1].parts[0].text,key:(init.headers||{})['x-goog-api-key']});return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(window.__ai.next())}]}}]})};}return window.__realFetch(url,init);};return true;})()`);
    const calls = () => run('window.__ai.calls.length');
    const FAKE = 'AIzaSyFAKEKEYFORANDROIDTESTS0123456789';
    try {
      await ask('what is the daily target'); await sleep(800); assert.equal(await calls(), 0, 'AI agent off: nothing is sent');
      await run(`localStorage.setItem('imei-lens-ai-v1',JSON.stringify({enabled:true,provider:'gemini',model:'gemini-3.5-flash-lite',key:${JSON.stringify(FAKE)},shareNames:false,mode:'always',memory:true}));window.__ai.next=()=>({action:'reply',text:'Nothing is set yet.'})`);
      await ask('whats the daily targts'); await waitFor(`window.__ai.calls.length===1`, 'the agent was asked'); await sleep(800);
      const sent = await run('window.__ai.calls[0].user'); assert.ok(!/\b\d{15}\b/.test(sent), 'no IMEI sent'); assert.match(sent, /MESSAGE:\nwhats the daily targts/);
      assert.match(await outputText(), /Nothing is set yet\./, 'the answer is shown');
      const before = JSON.stringify(await readPeople());
      await run(`window.__ai.next=()=>({action:'plan',summary:'Add person Qz',steps:[{tool:'add_person',args:{name:'Qz'}}]})`);
      await ask('pls add a new persn called Qz'); await waitFor(`!!document.querySelector('.assistant-panel .agent-plan')`, 'the plan card'); await sleep(500);
      assert.equal(JSON.stringify(await readPeople()), before, 'the plan changed nothing by itself');
      assert.equal(await clickText('.assistant-panel .agent-plan button', 'Approve next step'), true); await settle(async () => (await names()).includes('Qz'), 'plan approved and saved');
      const st = await readDb('retail:state'); const last = st.agentLog.at(-1); assert.equal(last.tool, 'people.create'); assert.equal(last.verify, 'verified', 'checked in the saved data');
      assert.equal(await clickText('.assistant-panel .agent-plan button', 'Undo 1 saved step'), true); await settle(async () => !(await names()).includes('Qz'), 'plan undone');
      assert.ok(!JSON.stringify(await readDb('retail:state')).includes('AIzaSy'), 'the key is not in the saved data');
    } finally { await run(`(()=>{${JSON.stringify(KEYS)}.forEach(k=>localStorage.removeItem(k));if(window.__realFetch)window.fetch=window.__realFetch;delete window.__ai;return true;})()`); }
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
