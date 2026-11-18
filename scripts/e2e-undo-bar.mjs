// The Undo popup (SwipeUndoBar in src/SwipeNotice.tsx), the real component in headless Edge/Chrome (bundled with esbuild). Not part of `npm test`:
//   node scripts/e2e-undo-bar.mjs
// It must leave by itself after 2 seconds, wait while a finger is on it, go away when swiped sideways (not when scrolled up/down), keep the Undo button
// working, start its clock again for a new message, and obey the test override "imei-lens-undo-ms". Synthetic text only.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const PORT = 4205, CDP = 9365;
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!browser) throw new Error('No Edge/Chrome found.');

const harness = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SwipeUndoBar } from './src/SwipeNotice';
function Host() {
  const [n, setN] = useState(0), [shown, setShown] = useState(false), [undone, setUndone] = useState(0), [dismissed, setDismissed] = useState(0);
  return <div>
    <button id="show" onClick={() => { setShown(true); setN(v => v + 1); }}>show</button>
    <span id="undone">{undone}</span><span id="dismissed">{dismissed}</span>
    {shown && <SwipeUndoBar key={n} onDismiss={() => { setShown(false); setDismissed(d => d + 1); }}>
      <span>carlou deleted.</span><button className="subtle-btn" onClick={() => { setUndone(u => u + 1); setShown(false); }}>Undo</button>
    </SwipeUndoBar>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Host />);
`;
const bundled = await build({ stdin: { contents: harness, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'harness.tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
const js = bundled.outputFiles[0].text;
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.undo-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:80px;display:flex;gap:12px;padding:8px 8px 8px 16px;background:#123;color:#fff;border-radius:12px}</style><div id="root"></div><script>${js.replace(/<\/script>/g, '<\\/script>')}</script>`;
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); }).listen(PORT);

if (await fetch(`http://127.0.0.1:${CDP}/json`).then(() => true, () => false)) throw new Error(`Port ${CDP} is used by an old browser: stop the leftover headless msedge (profile imei-undo-*) first.`);
const profile = await mkdtemp(join(tmpdir(), 'imei-undo-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=420,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const stopBrowsersOf = dir => { const tag = dir.split(/[\\/]/).pop(); spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch { /* the browser is starting */ } await sleep(500); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
const waitFor = async (expr, label, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(expr)) return Date.now(); } catch { /* not there yet */ } await sleep(50); } throw new Error('Timed out waiting for: ' + label); };
const results = []; const ok = name => { results.push(name); console.log('PASS:', name); };
const bar = `document.querySelector('.undo-bar')`;
const show = async () => { await run(`document.querySelector('#show').click()`); await waitFor(`!!${bar}`, 'the popup'); return Date.now(); };
const touch = (type, x, y) => run(`${bar}.dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,clientX:${x},clientY:${y},pointerId:1,pointerType:'touch',isPrimary:true}))`);
const gone = (label, ms) => waitFor(`!${bar}`, label, ms);
const count = id => run(`Number(document.querySelector('#${id}').textContent)`);

try {
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await waitFor(`!!document.querySelector('#show')`, 'the page');

  // 1. leaves by itself after 2 seconds
  let t0 = await show();
  await sleep(1200);
  assert.equal(await run(`!!${bar}`), true, 'still there after 1.2 s');
  const t1 = await gone('the popup leaves by itself', 4000);
  assert.ok(t1 - t0 >= 1700 && t1 - t0 <= 2800, `it left after ${t1 - t0} ms (about 2 seconds)`);
  assert.equal(await count('dismissed'), 1);
  ok(`the Undo popup leaves by itself after 2 seconds (${t1 - t0} ms)`);

  // 2. a finger on it stops the clock; letting go starts it again
  t0 = await show();
  await touch('pointerdown', 200, 300);
  await sleep(3000);
  assert.equal(await run(`!!${bar}`), true, 'still there after 3 s while it is held');
  await touch('pointerup', 200, 300);
  const t2 = await gone('it leaves after the finger is lifted', 4500);
  ok(`while a finger is on the popup it stays; after letting go it leaves in 2 seconds (${Date.now() - t0} ms in all)`);

  // 3. a sideways swipe takes it away at once, and it follows the finger
  t0 = await show();
  await touch('pointerdown', 250, 300);
  await touch('pointermove', 200, 302);
  assert.match(await run(`${bar}.style.translate`), /^-50px/, 'it follows the finger');
  assert.ok(Number(await run(`${bar}.style.opacity`)) < 1, 'and fades a little');
  await touch('pointermove', 120, 304);
  await touch('pointerup', 120, 304);
  const t3 = await gone('a swipe takes it away', 1000);
  assert.ok(t3 - t0 < 1000, `swiped away at once (${t3 - t0} ms)`);
  assert.equal(await count('undone'), 0, 'swiping away is not Undo');
  ok('a sideways swipe takes the popup away at once (and is not Undo)');

  // 4. a short nudge or an up/down scroll does not
  await show();
  await touch('pointerdown', 250, 300); await touch('pointermove', 232, 300); await touch('pointerup', 232, 300);
  assert.equal(await run(`!!${bar}`), true, 'a 18 px nudge stays'); assert.match(await run(`${bar}.style.translate`), /^0px/, 'and springs back');
  await gone('it still leaves by the clock', 4500);
  await show();
  await touch('pointerdown', 250, 300); await touch('pointermove', 140, 380); await touch('pointerup', 140, 380);
  assert.equal(await run(`!!${bar}`), true, 'an up/down scroll is not a swipe');
  await gone('and it leaves by the clock', 4500);
  ok('a small nudge or an up/down scroll does not dismiss it; the clock still does');

  // 5. Undo still works
  await show();
  await touch('pointerdown', 300, 300); await touch('pointerup', 300, 300);
  await run(`${bar}.querySelector('button').click()`);
  await waitFor(`!${bar}`, 'Undo closes the popup', 1500);
  assert.equal(await count('undone'), 1, 'Undo ran once');
  ok('the Undo button works');

  // 6. a new message starts the clock again
  t0 = await show();
  await sleep(1500);
  await run(`document.querySelector('#show').click()`);
  await sleep(1000);
  assert.equal(await run(`!!${bar}`), true, 'the new message is still there 2.5 s after the first one');
  const t6 = await gone('the new message leaves', 4000);
  assert.ok(t6 - t0 >= 3300, `the second message had its own 2 seconds (${t6 - t0} ms in all)`);
  ok('a new message gets its own 2 seconds');

  // 7. the test override
  await run(`localStorage.setItem('imei-lens-undo-ms','600')`);
  t0 = await show();
  const t7 = await gone('the override is used', 3000);
  assert.ok(t7 - t0 < 1500, `override 600 ms: left after ${t7 - t0} ms`);
  await run(`localStorage.removeItem('imei-lens-undo-ms')`);
  ok('a test can shorten the clock with "imei-lens-undo-ms"');
} catch (error) {
  console.log('FAIL:', error.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { /* closed */ }
  proc.kill();
  stopBrowsersOf(profile);
  server.close();
}
console.log(process.exitCode ? 'FAILED' : `${results.length} checks passed`);
