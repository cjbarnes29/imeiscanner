// Helpers for the hybrid scenarios: Maestro for system UI, DevTools (CDP) for the WebView, adb input for exact gestures.
// Everything is limited to the isolated test app (guardApp).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, guardApp, check, finish, isEmulator } from '../scripts/lib.mjs';
import { evaluate, webState } from '../scripts/cdp-state.mjs';

export { check, finish, webState, adb };
const here = dirname(fileURLToPath(import.meta.url));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const ctx = () => { const [, , device = 'emulator-5554', app = 'com.imeilens.scanner.phonetest'] = process.argv; guardApp(app); return { device, app }; };

/** Runs a Maestro flow file (relative to e2e/flows) with the current session environment. Throws when it fails. */
export function maestro(device, flow) {
  const file = join(here, '..', 'flows', flow);
  if (!isEmulator(device) && /pick-photos|scan-all|start-scan-then-home|scan-real/.test(flow + readFileSync(file, 'utf8'))) throw new Error(`refused on a real phone: ${flow} selects photos in the system picker`);
  // Same session-only environment as scripts/env.ps1 when the caller did not set it up.
  const home = process.env.USERPROFILE || '';
  const mh = process.env.MAESTRO_HOME || join(home, 'tools', 'maestro-2.12.1', 'maestro');
  const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_NO_UPDATE_CHECK: '1', ANDROID_HOME: process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') };
  if (!env.JAVA_HOME) env.JAVA_HOME = join(home, '.jdks', 'temurin-25.0.4');
  // The PATH variable is called PATH or Path depending on the shell that started Node: keep one entry only.
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'Path';
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env[pathKey] = `${join(env.JAVA_HOME, 'bin')};${join(mh, 'bin')};${env.ANDROID_HOME}\\platform-tools;${process.env[pathKey] || ''}`;
  try { execFileSync('cmd', ['/c', `maestro --udid ${device} test ${file}`], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 28, env }); }
  catch (error) {
    const text = String(error.stdout || '') + String(error.stderr || '');
    throw new Error(`Maestro flow ${flow} failed:\n${text.split('\n').filter(l => /FAILED|Assertion|not found|not recognized|Exception/.test(l)).slice(0, 5).join('\n')}`);
  }
}

export const js = (c, expression) => evaluate(c.device, c.app, expression);
/** Clicks the first visible button/link whose text matches (string or RegExp source). Returns false when none. */
export async function clickText(c, text, { within = 'document', tag = 'button' } = {}) {
  return js(c, `(()=>{const re=new RegExp(${JSON.stringify(text)});const root=${within};const els=[...root.querySelectorAll('${tag}')].filter(e=>re.test((e.innerText||'').trim()));const el=els.find(e=>e.offsetParent!==null)||els[0];if(!el)return false;el.scrollIntoView({block:'center'});el.click();return true})()`);
}
export async function waitForText(c, text, timeoutMs = 20000, selector = 'body') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    // While the app is (re)starting there is no process or page yet: keep trying until the time limit instead of failing at once.
    try { if (await js(c, `new RegExp(${JSON.stringify(text)}).test(document.querySelector('${selector}').innerText)`)) return true; }
    catch { /* not running or not loaded yet */ }
    await sleep(500);
  }
  return false;
}
export async function bodyText(c) { return js(c, 'document.body.innerText'); }
export async function screen(c) { return JSON.parse(adb(c.device, 'shell', 'wm', 'size').match(/(\d+)x(\d+)/) ? JSON.stringify(adb(c.device, 'shell', 'wm', 'size').match(/(\d+)x(\d+)/).slice(1).map(Number)) : '[1080,2400]'); }
/** Real finger swipe through adb input (what a person does), in screen pixels. */
export function swipe(c, x1, y1, x2, y2, ms = 450) { adb(c.device, 'shell', 'input', 'swipe', String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(ms)); }
/** Where the WebView starts on the screen (below the status bar), read from UI Automator, in screen pixels. */
export function webViewOrigin(c) {
  const xml = adb(c.device, 'shell', 'uiautomator dump /sdcard/e2e-ui.xml >/dev/null 2>&1; cat /sdcard/e2e-ui.xml; rm -f /sdcard/e2e-ui.xml');
  const m = xml.match(/class="android\.webkit\.WebView"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
}
/** The drawing surface of Crop Studio in screen pixels. */
export async function canvasRect(c) {
  const r = await js(c, `(()=>{const k=document.querySelector('.studio-stage');if(!k)return null;const r=k.getBoundingClientRect(),d=window.devicePixelRatio;return {x:r.left*d,y:r.top*d,w:r.width*d,h:r.height*d}})()`);
  if (!r) return null;
  const o = webViewOrigin(c);
  return { x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h };
}
export function pressBack(c) { adb(c.device, 'shell', 'input', 'keyevent', 'KEYCODE_BACK'); }

/** Fresh state: scan the five synthetic photos through the real picker (Maestro), then wait until the web list shows them. */
export async function scanAll(c) {
  if (!isEmulator(c.device)) throw new Error('refused on a real phone: selecting photos in the system picker is not safe there');
  adb(c.device, 'shell', 'pm', 'clear', 'com.google.android.documentsui');
  maestro(c.device, '_common/scan-all.yaml');
  await sleep(1500);
}
/** Opens Crop Studio on the single-label photo B and draws two side-by-side boxes. */
export async function openStudioAndDrawTwoBoxes(c) {
  await clickText(c, '^Records');
  await sleep(800);
  const opened = await js(c, `(()=>{const name=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&(e.innerText||'').trim()==='E2E-single-B.jpg');if(!name)return 'no record';let e=name;for(let i=0;i<8&&e;i++){const b=[...e.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='Edit photo');if(b){b.click();return 'opened'}e=e.parentElement}return 'no edit button'})()`);
  if (opened !== 'opened') throw new Error('could not open the record: ' + opened);
  await sleep(2500);
  await clickText(c, '^Crop / edit photo');
  await sleep(2500);
  const r = await canvasRect(c);
  if (!r) throw new Error('crop canvas not found');
  // the drawing surface is the photo itself (.studio-stage)
  const top = r.y + r.h * 0.06, bottom = r.y + r.h * 0.94, left = r.x + r.w * 0.13, right = r.x + r.w * 0.87;
  // two side-by-side boxes (a drag that starts inside an existing box would move it instead of drawing a new one); every swipe is verified and retried if dropped
  const w = right - left, end1 = left + w * 0.40, start2 = left + w * 0.62;
  const count = async () => Number(((await js(c, "(document.querySelector('.studio-head')||{innerText:''}).innerText")).match(/(\d+) label/) || [])[1] || 0);
  for (let attempt = 0; attempt < 3 && await count() < 1; attempt++) { swipe(c, left, top, end1, bottom); await sleep(900); }
  for (let attempt = 0; attempt < 3 && await count() < 2; attempt++) { swipe(c, start2, top, right, bottom); await sleep(900); }
  if (await count() !== 2) throw new Error('could not draw two boxes (labels counted: ' + await count() + ')');
  return r;
}
/** Save all, check the result screen, apply: the original is archived. */
export async function saveAndArchive(c) {
  if (!await clickText(c, '^Save all')) throw new Error('Save all not found');
  if (!await waitForText(c, 'archive the original', 120000)) throw new Error('result screen did not appear');
  await clickText(c, 'archive the original');
  if (!await waitForText(c, 'archived', 30000)) throw new Error('archive confirmation did not appear');
  await sleep(2500); // the app saves to IndexedDB about 350 ms after a change
}

/** Taps a system-UI element (dialog button) found by its text through UI Automator. Returns false when it is not on screen. */
export function tapSystemText(c, text) {
  const xml = adb(c.device, 'shell', 'uiautomator dump /sdcard/e2e-ui.xml >/dev/null 2>&1; cat /sdcard/e2e-ui.xml; rm -f /sdcard/e2e-ui.xml');
  const nodes = [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  const hit = nodes.find(n => n[1].toLowerCase() === text.toLowerCase());
  if (!hit) return false;
  adb(c.device, 'shell', 'input', 'tap', String(((+hit[2] + +hit[4]) / 2) | 0), String(((+hit[3] + +hit[5]) / 2) | 0));
  return true;
}
/** Export tab: choose "IMEI and model only" + CSV through the page, then press the Export button (opens the system Save dialog). */
export async function startCsvExport(c) {
  await clickText(c, '^Export$');
  await sleep(800);
  await js(c, `(()=>{const set=(sel,text)=>{const o=[...sel.options].find(o=>o.text.startsWith(text));const st=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;st.call(sel,o.value);sel.dispatchEvent(new Event('change',{bubbles:true}))};const s=[...document.querySelectorAll('select')];set(s.find(x=>[...x.options].some(o=>o.text.startsWith('IMEI and model only'))),'IMEI and model only');set(s.find(x=>[...x.options].some(o=>o.text.startsWith('CSV'))),'CSV');return 1})()`);
  await sleep(500);
  return clickText(c, '^Export [0-9]+ records');
}
export function focusedWindow(c) { return adb(c.device, 'shell', 'dumpsys window | grep mCurrentFocus'); }

/** In the system folder picker: open each folder of the path in turn, then "Use this folder" and "Allow". Returns false when a step is missing. */
export async function pickFolder(c, path) {
  if (!isEmulator(c.device)) throw new Error('refused on a real phone: choosing a folder in the system picker is not safe there');
  for (const name of path) { if (!tapSystemText(c, name)) return false; await sleep(1500); }
  if (!tapSystemText(c, 'USE THIS FOLDER') && !tapSystemText(c, 'Use this folder')) return false;
  await sleep(1500);
  if (!tapSystemText(c, 'ALLOW') && !tapSystemText(c, 'Allow')) return false;
  await sleep(1500);
  return true;
}
/** Files in a shared-storage folder: [{name, size}] (directories excluded). */
export function listDir(c, dir) {
  const out = adb(c.device, 'shell', `ls -l "${dir}" 2>/dev/null; true`);
  return out.split(/\r?\n/).filter(l => l.startsWith('-')).map(l => { const m = l.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/); return m ? { name: m[2].trim(), size: +m[1] } : null; }).filter(Boolean);
}
/** Sub-folders of a shared-storage folder. */
export function listDirs(c, dir) {
  return adb(c.device, 'shell', `ls -l "${dir}" 2>/dev/null; true`).split(/\r?\n/).filter(l => l.startsWith('d')).map(l => l.replace(/^(\S+\s+){7}/, '').trim());
}
