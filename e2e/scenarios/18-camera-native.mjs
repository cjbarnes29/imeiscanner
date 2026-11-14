// The phone's OWN camera app is the only camera: "Take photo" opens it, the full-size photo is written straight into the app's private
// folder (never the gallery), and it is scanned by the same background scanner as chosen photos. Covers: permission refused (clear message,
// nothing created), a real photo, a cancelled camera (nothing left behind), "collect first" + Scan now, and Discard (only this app's own
// unscanned camera photos; a foreign file in the folder and the scanned photos are never deleted).
// EMULATOR ONLY: it drives the emulator's camera app (a virtual scene, so the scan finds no IMEI, which must be reported, not hidden).
// On a real phone the camera app looks different: use the manual camera cases in the phone checklist instead.
import { ctx, sleep, check, finish, adb, js, waitForText, focusedWindow, tapSystemText } from './helpers.mjs';
import { nativeStore } from '../scripts/lib.mjs';

const c = ctx(), results = [];
if (!c.device.startsWith('emulator-')) throw new Error('18-camera-native drives the emulator camera app: emulator only');

const dir = sub => { try { return adb(c.device, 'shell', `run-as ${c.app} ls files/native-scans/${sub}`).split(/\s+/).filter(Boolean); } catch { return []; } };
const inCamera = () => /com\.android\.camera2/.test(focusedWindow(c));
const inApp = () => new RegExp(c.app.replace(/\./g, '\\.')).test(focusedWindow(c));
const size = () => { const m = adb(c.device, 'shell', 'wm', 'size').match(/(\d+)x(\d+)/); return m ? [+m[1], +m[2]] : [1080, 2400]; };
const photosScanned = () => { try { return (nativeStore(c.device, c.app).photos || []).length; } catch { return 0; } };
async function waitUntil(fn, ms = 30000, step = 500) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* not ready */ } await sleep(step); } return false; }
const press = () => js(c, `(()=>{const re=/Take photo|Scan with camera/;const b=[...document.querySelectorAll('button')].filter(e=>re.test((e.innerText||'').trim())&&!e.disabled).find(e=>e.offsetParent!==null);if(!b)return false;b.click();return true})()`);
async function openCamera() { return waitUntil(async () => { if (!inCamera()) await press(); await sleep(1500); return inCamera(); }, 40000, 500); }
async function shootAndConfirm() {
  // The shutter and the "keep photo" tick are at the same spot: tap every few seconds until the app is back. A first tap that came
  // before the camera was ready is simply repeated (slow emulator), so the number of taps is never assumed.
  const [w, h] = size();
  await sleep(2500);
  for (let i = 0; i < 8; i++) {
    if (inApp()) return true;
    adb(c.device, 'shell', 'input', 'tap', String(w / 2 | 0), String(h * 0.93 | 0));
    await sleep(3500);
  }
  return waitUntil(() => inApp(), 10000);
}
async function setMode(mode) {
  await js(c, `(()=>{const s=document.querySelector('select[aria-label="After taking a photo"]');if(!s)return false;const st=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;st.call(s,${JSON.stringify(mode)});s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await sleep(500);
}
const click = text => js(c, `(()=>{const re=new RegExp(${JSON.stringify(text)});const b=[...document.querySelectorAll('button')].find(e=>re.test((e.innerText||'').trim())&&e.offsetParent!==null);if(!b)return false;b.click();return true})()`);

try {
// 1. Fresh test app, camera permission NOT granted yet.
adb(c.device, 'shell', 'pm', 'clear', c.app);
try { adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ }
// Android may still be removing the previous test's app task right after pm clear and kills a process started in that moment
// (seen in logcat: "Destroy timeout of remove-task"): wait, then start the app again until the page is there.
await sleep(3000);
let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
  adb(c.device, 'shell', 'am', 'start', '-n', `${c.app}/com.imeilens.scanner.MainActivity`);
  opened = await waitForText(c, 'Scan', 20000);
}
check(results, 'the app opens', opened, opened ? '' : focusedWindow(c).trim());
await sleep(3000);

// 2. Permission refused: a clear message, no photo, nothing created.
let asked = false;
await waitUntil(async () => { await press(); await sleep(1200); asked = tapSystemText(c, "Don’t allow") || tapSystemText(c, "Don't allow"); return asked; }, 30000, 300);
check(results, 'Android asked for the camera permission', asked);
check(results, 'a refused permission is explained (never silent)', await waitForText(c, 'Camera permission was not allowed', 10000));
check(results, 'a refused permission opens no camera and keeps no photo', !inCamera() && dir('camera-photos').length === 0 && dir('camera-waiting').length === 0);

// 3. Permission allowed: the phone's own camera opens, one photo is taken and scanned right away.
adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.CAMERA');
adb(c.device, 'logcat', '-c');
await setMode('now'); // the default is now "keep taking photos" (series); this part checks a single photo
check(results, 'the phone\'s own camera app opens from the button', await openCamera());
check(results, 'the photo is taken and the app comes back', await shootAndConfirm());
check(results, 'the photo was scanned (listed in the scan, nothing hidden)', await waitUntil(() => photosScanned() >= 1 && ['completed', 'idle'].includes(nativeStore(c.device, c.app).status), 120000, 1500), `ledger ${photosScanned()}`);
const scanned = dir('camera-photos');
check(results, 'the photo lives in the app\'s private folder with a camera-*.jpg name', scanned.length === 1 && /^camera-[0-9a-f-]{36}\.jpg$/.test(scanned[0] || ''), scanned.join(','));
check(results, 'nothing is left in the waiting folder', dir('camera-waiting').length === 0);
let bytes = 0;
try { if (scanned[0]) bytes = Number((adb(c.device, 'shell', `run-as ${c.app} stat -c %s files/native-scans/camera-photos/${scanned[0]}`) || '0').trim()); } catch { /* reported below */ }
check(results, 'the photo is a real, full-size file (not a thumbnail or empty)', bytes > 20000, `${bytes} bytes`);

// 4. A cancelled camera leaves nothing behind and says so.
const before = photosScanned();
check(results, 'the camera opens again', await openCamera());
await sleep(2000);
adb(c.device, 'shell', 'input', 'keyevent', 'KEYCODE_BACK');
check(results, 'back in the app after cancelling', await waitUntil(() => inApp(), 15000));
check(results, 'a cancelled camera says so', await waitForText(c, 'No photo was taken', 10000));
check(results, 'a cancelled camera leaves no file and scans nothing', dir('camera-waiting').length === 0 && dir('camera-photos').length === 1 && photosScanned() === before);

// 5. "Collect first": the photo waits (not scanned) until Scan now.
await setMode('collect');
check(results, 'the camera opens in collect mode', await openCamera());
check(results, 'the photo is taken in collect mode', await shootAndConfirm());
check(results, 'the page says one photo is waiting', await waitForText(c, '1 photo waiting', 10000));
check(results, 'the photo waits inside the app and is NOT scanned yet', dir('camera-waiting').length === 1 && photosScanned() === before, `waiting ${dir('camera-waiting').length}, ledger ${photosScanned()}`);
check(results, 'Scan now is offered', await waitForText(c, 'Scan now', 5000));
await click('^Scan now$');
check(results, 'Scan now scans it', await waitUntil(() => photosScanned() >= before + 1 && ['completed', 'idle'].includes(nativeStore(c.device, c.app).status), 120000, 1500), `ledger ${photosScanned()}`);
check(results, 'the scanned photo moved out of the waiting folder', dir('camera-waiting').length === 0 && dir('camera-photos').length === 2, `${dir('camera-photos').length} scanned`);

// 6. Discard removes only the unscanned camera photos.
adb(c.device, 'shell', `run-as ${c.app} sh -c 'echo keep > files/native-scans/camera-waiting/holiday.jpg'`); // a file that is not ours must survive
check(results, 'the camera opens for the discard test', await openCamera());
check(results, 'a photo is taken to be discarded', await shootAndConfirm());
check(results, 'it is waiting', await waitUntil(() => dir('camera-waiting').filter(n => /^camera-/.test(n)).length === 1, 10000));
await js(c, 'window.confirm=()=>true;true'); // the page asks first; the test answers OK
await click('Discard waiting photos');
await sleep(1500);
check(results, 'Discard removed the unscanned camera photo', dir('camera-waiting').filter(n => /^camera-/.test(n)).length === 0, dir('camera-waiting').join(','));
check(results, 'a file that is not ours was not deleted', dir('camera-waiting').includes('holiday.jpg'));
check(results, 'the scanned photos were not deleted', dir('camera-photos').length === 2, `${dir('camera-photos').length}`);
adb(c.device, 'shell', `run-as ${c.app} rm -f files/native-scans/camera-waiting/holiday.jpg`);


// 7. Series (the default): the photo is scanned while the camera opens again by itself; Back in the camera ends the series.
await setMode('series');
const photosBefore = dir('camera-photos').length, ledgerBefore = photosScanned();
check(results, 'the camera opens in series mode', await openCamera());
const [sw, sh] = size();
await sleep(2500);
for (let i = 0; i < 8 && dir('camera-photos').length === photosBefore; i++) { adb(c.device, 'shell', 'input', 'tap', String(sw / 2 | 0), String(sh * 0.93 | 0)); await sleep(3500); }
check(results, 'series: the photo was kept and sent to the scanner', dir('camera-photos').length === photosBefore + 1, `${dir('camera-photos').length} photos`);
check(results, 'series: the camera opened again by itself for the next photo', await waitUntil(() => inCamera(), 25000));
await sleep(1500);
adb(c.device, 'shell', 'input', 'keyevent', 'KEYCODE_BACK');
check(results, 'series: Back in the camera ends the series (back in the app)', await waitUntil(() => inApp(), 20000));
await sleep(3000);
check(results, 'series: the camera did not open a third time', !inCamera());
check(results, 'series: the photo taken while shooting is scanned', await waitUntil(() => photosScanned() >= ledgerBefore + 1 && ['completed', 'idle'].includes(nativeStore(c.device, c.app).status), 120000, 1500), `ledger ${photosScanned()}`);
check(results, 'series: nothing is left waiting and no empty file remains', dir('camera-waiting').filter(n => /^camera-/.test(n)).length === 0);
} catch (error) { check(results, 'the test stopped early: ' + String(error.message).split('\n')[0], false, focusedWindow(c).trim()); }
const log = adb(c.device, 'logcat', '-d', '-s', 'AndroidRuntime:E', 'IMEI-Lens:E');
check(results, 'no crash', !/FATAL EXCEPTION/.test(log));
finish('18-camera-native', results);
