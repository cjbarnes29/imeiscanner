// LIVE check of the AI agent INSIDE the real app on the Android EMULATOR, with your own free keys (read from environment variables or --keys-file, never printed).
// It proves what a desktop test cannot: that the web view is allowed to call each provider (CORS), that the answer comes back through the app's own chat, and that a plan shows,
// waits for Approve, saves and checks, and can be undone. Synthetic data only; it removes the key and the conversation from the emulator when it finishes.
//   1. start the isolated test app on the emulator and forward its devtools port:  adb -s emulator-5554 forward tcp:9229 localabstract:webview_devtools_remote_<pid>
//   2. $env:GEMINI_API_KEY='...'; $env:GROQ_API_KEY='...'; $env:OPENROUTER_API_KEY='...'; $env:ADB_SERIAL='emulator-5554'; node scripts/live-ai-webview.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SERIAL = process.env.ADB_SERIAL || '';
assert.ok(/^emulator-\d+$/.test(SERIAL), 'Set ADB_SERIAL to an emulator serial. This check never runs on a real phone.');
const args = process.argv.slice(2), opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : ''; };
const keys = { gemini: process.env.GEMINI_API_KEY || '', groq: process.env.GROQ_API_KEY || '', openrouter: process.env.OPENROUTER_API_KEY || '' };
if (opt('keys-file')) for (const line of readFileSync(opt('keys-file'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*(GEMINI|GROQ|OPENROUTER)_API_KEY\s*=\s*(\S+)\s*$/); if (m) keys[m[1].toLowerCase()] = m[2]; }
const providers = ['gemini', 'groq', 'openrouter'].filter(p => keys[p] && (!opt('only') || opt('only') === p));
if (!providers.length) { console.log('No keys found. Set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY (or use --keys-file). Nothing was run.'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pages = await fetch('http://127.0.0.1:9229/json').then(r => r.json());
const page = pages.find(p => p.type === 'page' && p.url.includes('appassets.androidplatform.net')); assert.ok(page, 'the isolated app WebView must be forwarded to port 9229');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
const waitFor = async (expression, label, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(expression)) return true; } catch { /* page busy */ } await sleep(400); } throw new Error('Timed out waiting for: ' + label); };
const clickText = (selector, text) => run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true;})()`);
const setVal = (selector, value) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set;set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
const readDb = key => run(`new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onupgradeneeded=()=>{o.transaction.abort();};o.onerror=()=>res({});o.onsuccess=()=>{const db=o.result;try{const q=db.transaction('inventory').objectStore('inventory').get(${JSON.stringify(key)});q.onsuccess=()=>{db.close();res(q.result||{});};}catch(e){db.close();res({});}};})`);
const names = async () => JSON.parse(await run(`localStorage.getItem('imei-lens-people-v1')||'[]'`)).map(p => p.name);
const openChat = async () => { if (!(await run(`!!document.querySelector('.assistant-panel')`))) { await run(`document.querySelector('[aria-label="Open assistant"]')?.click()`); await waitFor(`!!document.querySelector('.assistant-panel [aria-label="Ask local assistant"]')`, 'the assistant opens'); } };
const ask = async text => { await openChat(); await setVal('.assistant-panel [aria-label="Ask local assistant"]', text); await sleep(200); assert.equal(await clickText('.assistant-panel button', 'Get answer'), true); };
const answerText = () => run(`document.querySelector('.assistant-panel .plan-ai-output')?.innerText||''`);
const statusText = () => run(`document.querySelector('.assistant-panel .plan-ai-status')?.innerText||''`);
const URLS = { gemini: ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=5', k => ({ 'x-goog-api-key': k })], groq: ['https://api.groq.com/openai/v1/models', k => ({ authorization: 'Bearer ' + k })], openrouter: ['https://openrouter.ai/api/v1/models', k => ({ authorization: 'Bearer ' + k })] };
const closeWelcome = async () => { await run(`(()=>{const w=document.body.innerText.includes('Welcome to AI LENS');const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Close');if(w&&b)b.click();return true;})()`); await sleep(500); };

let failures = 0; const report = (ok, name, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + extra}`); if (!ok) failures++; };
await closeWelcome();
for (const provider of providers) {
  console.log(`\n=== ${provider} (in the Android WebView) ===`); const key = keys[provider];
  try {
    // 1. can the web view reach the provider at all (CORS)?
    const [url, headers] = URLS[provider];
    const reach = await run(`fetch(${JSON.stringify(url)},{headers:${JSON.stringify(headers(key))}}).then(r=>({ok:r.ok,status:r.status})).catch(e=>({ok:false,error:String(e.name)}))`);
    report(reach.ok, 'the web view can call the provider (CORS) and the key is accepted', JSON.stringify(reach)); if (!reach.ok) continue;
    if (provider === 'gemini') { const inter = await run(`fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':${JSON.stringify(key)},'content-type':'application/json'},body:JSON.stringify({model:'x',input:'hi'})}).then(r=>({status:r.status})).catch(e=>({error:String(e.name)}))`); console.log(`  info  Interactions API from the web view: ${JSON.stringify(inter)} (a 400/404 reply means it is reachable; an error means the browser blocked it and the app uses the older route)`); }
    // 2. save the settings the way "Test & save key" would (override the model with MODEL_GEMINI / MODEL_GROQ / MODEL_OPENROUTER if a default is not available to your key)
    await run(`localStorage.setItem('imei-lens-ai-v1',JSON.stringify({enabled:true,provider:${JSON.stringify(provider)},key:${JSON.stringify(key)},model:${JSON.stringify(process.env['MODEL_' + provider.toUpperCase()] || { gemini: 'gemini-3.5-flash-lite', groq: 'llama-3.3-70b-versatile', openrouter: 'meta-llama/llama-3.3-70b-instruct:free' }[provider])},shareNames:false,mode:'always',memory:true}));localStorage.removeItem('imei-lens-convo-v1');localStorage.removeItem('imei-lens-ai-usage-v1');`);
    const before = await names();
    await ask('hw many phnes are in stock rite now'); await waitFor(`/Answered by the AI agent|key was not accepted|used the built-in|allowance|could not reach/.test(document.querySelector('.assistant-panel .plan-ai-status')?.innerText||'')`, 'an answer', 90000);
    const st = await statusText(); report(/Answered by the AI agent/.test(st), 'a typo question is answered by the AI through the app chat', st.slice(0, 160));
    await sleep(5000);
    await ask('pls add a new persn called Qzlive'); await waitFor(`!!document.querySelector('.assistant-panel .agent-plan')||/key was not accepted|built-in|allowance|could not reach/.test(document.querySelector('.assistant-panel .plan-ai-status')?.innerText||'')`, 'a plan card', 90000);
    const hasPlan = await run(`!!document.querySelector('.assistant-panel .agent-plan')`); report(hasPlan, 'a typo request becomes a plan card that waits for Approve', (await statusText()).slice(0, 160));
    if (hasPlan) {
      assert.deepEqual((await names()).filter(n => /Qzlive/.test(n)), [], 'the plan changed nothing by itself');
      report(await clickText('.assistant-panel .agent-plan button', 'Approve next step'), 'Approve next step is available');
      await waitFor(`(JSON.parse(localStorage.getItem('imei-lens-people-v1')||'[]')).some(p=>/Qzlive/.test(p.name))`, 'the person saved', 30000); report(true, 'approving the plan saved the person');
      const st2 = await readDb('retail:state'); report(st2.agentLog?.at(-1)?.verify === 'verified', 'the save was checked in the stored data', JSON.stringify(st2.agentLog?.at(-1)));
      report(await clickText('.assistant-panel .agent-plan button', 'Undo 1 saved step'), 'Undo is offered'); await waitFor(`!(JSON.parse(localStorage.getItem('imei-lens-people-v1')||'[]')).some(p=>/Qzlive/.test(p.name))`, 'undone', 30000); report(true, 'undo removed the person again');
    }
    await sleep(5000);
    await ask('what if i add a person called Nope'); await waitFor(`/Answered by the AI agent|question or a maybe|built-in|allowance/.test(document.querySelector('.assistant-panel .plan-ai-status')?.innerText||'')||/question or a maybe/.test(document.querySelector('.assistant-panel .plan-ai-output')?.innerText||'')`, 'the what-if answer', 90000);
    report(!(await run(`!!document.querySelector('.assistant-panel .agent-plan')`)) && !(await names()).includes('Nope'), 'a what-if is explained and never becomes a plan');
    report(JSON.stringify(before) === JSON.stringify((await names()).filter(n => !/Qzlive/.test(n))), 'no other data changed');
  } catch (e) { report(false, 'run completed', String(e.message).slice(0, 200)); }
  finally { await run(`localStorage.removeItem('imei-lens-ai-v1');localStorage.removeItem('imei-lens-convo-v1');localStorage.removeItem('imei-lens-ai-usage-v1');true`); }
}
console.log(`\n${failures ? failures + ' check(s) FAILED' : 'All live WebView checks passed'} for: ${providers.join(', ')}. The keys were removed from the emulator.`);
ws.close(); process.exit(failures ? 1 : 0);
