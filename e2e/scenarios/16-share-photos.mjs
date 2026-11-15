// Picker-free photo input: the five synthetic photos are shared to IMEI Lens Test the way WhatsApp or Gallery would share them.
// No system picker, no gallery, no Download: the photos live only in the test app's own cache folder (see lib.mjs).
// Isolation evidence collected by this test (so the same test can later be approved for a real phone):
//   * the app starts with NO media/storage permission at all (pm clear resets them; only notifications are granted), so a pass proves the
//     photos did not need gallery access. Maestro is not used here: its clean-start grants "all" permissions, which this test must not;
//   * Android's app-ops record of storage access (last access time) is identical before and after the share and scan;
//   * every photo name in the scan file is a synthetic E2E-*.jpg (anything else = a personal file was reached: the test fails).
// The scan results are checked by scripts/verify-16-share-photos.mjs (same expectations as the gallery test 01).
import { ctx, sleep, check, finish, adb, webState } from './helpers.mjs';
import { nativeStore, truth, SYNTHETIC_NAME, stageSyntheticPhotos, sharePhoto, unstageSyntheticPhotos, requireShareAllowed, shareUri } from '../scripts/lib.mjs';

const c = ctx(), results = [];
requireShareAllowed(c.device);
const names = Object.keys(truth);

const STORAGE_PERMS = ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.ACCESS_MEDIA_LOCATION'];
const STORAGE_OPS = /^(READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|READ_MEDIA_AUDIO|READ_MEDIA_VISUAL_USER_SELECTED|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|ACCESS_MEDIA_LOCATION|LEGACY_STORAGE)\b/;
/** The storage-related lines of "appops get" (with their last access times): any change means the app touched shared storage. */
const storageOps = () => adb(c.device, 'shell', 'appops', 'get', c.app).split(/\r?\n/).map(l => l.trim()).filter(l => STORAGE_OPS.test(l)).sort().join('\n');

// 1. Fresh test app (pm clear: its own data and permission grants only; the phone guard refuses any other app) with no gallery permission.
adb(c.device, 'shell', 'pm', 'clear', c.app);
try { adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android: not needed */ }
for (const perm of STORAGE_PERMS) { try { adb(c.device, 'shell', 'pm', 'revoke', c.app, perm); } catch { /* not declared or not granted */ } }
const granted = adb(c.device, 'shell', 'dumpsys', 'package', c.app);
check(results, 'no media/storage permission is granted to the test app', !STORAGE_PERMS.some(p => new RegExp(`${p}: granted=true`).test(granted)));
const opsBefore = storageOps();

// 2. Stage the five synthetic photos in the app's own cache and share them, one intent per photo (am cannot build a list).
adb(c.device, 'logcat', '-c');
stageSyntheticPhotos(c.device, c.app, names);
const staged = adb(c.device, 'shell', `run-as ${c.app} ls cache`).split(/\s+/).filter(n => /^E2E-/.test(n));
check(results, 'the five synthetic photos are staged in the app\'s own cache only', staged.length === names.length, staged.join(','));
for (const name of names) {
  const out = sharePhoto(c.device, c.app, name);
  if (/Error|Exception/.test(out)) check(results, `share ${name}`, false, out.trim().split('\n')[0]);
  await sleep(1200);
}

// STOP IMMEDIATELY if the app reaches anything that is not one of our synthetic photos: a personal file name in the scan, or any attempt to
// read storage (app-ops). The app is stopped, the staged copies removed, and the test fails at once (checked on every poll, not only at the end).
function stopNow(reason) {
  try { adb(c.device, 'shell', 'am', 'force-stop', c.app); } catch { /* already stopped */ }
  try { unstageSyntheticPhotos(c.device, c.app); adb(c.device, 'shell', `run-as ${c.app} rm -f cache/Personal-selftest.jpg`); } catch { /* best effort */ }
  check(results, 'STOPPED: the test reached something that is not a synthetic photo', false, reason);
  finish('16-share-photos', results);
}

// Negative control for the stop above (EMULATOR ONLY, never on a phone): also share one file with a non-synthetic name. The test must then STOP.
if (process.env.E2E_SELFTEST_FOREIGN === '1') {
  if (!c.device.startsWith('emulator-')) throw new Error('E2E_SELFTEST_FOREIGN is for the emulator only');
  adb(c.device, 'shell', `run-as ${c.app} cp cache/${names[0]} cache/Personal-selftest.jpg`);
  adb(c.device, 'shell', 'am', 'start', '-a', 'android.intent.action.SEND', '-t', 'image/jpeg', '-p', c.app, '--eu', 'android.intent.extra.STREAM', shareUri(c.app, 'Personal-selftest.jpg'));
}

// 3. Wait until the scan has handled every photo (several jobs or a queue of pending photos: either way the ledger lists them all).
let store = null;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  if (/time=/i.test(storageOps())) stopNow('the app tried to read shared storage (app-ops shows an access or a rejected access)');
  try {
    store = nativeStore(c.device, c.app);
    const foreign = [...(store.photos || []).map(p => p.name), ...(store.records || []).map(r => r.name)].filter(n => !SYNTHETIC_NAME.test(n));
    if (foreign.length) stopNow(`the scan contains a photo that is not synthetic: ${[...new Set(foreign)].join(', ')}`);
    const done = (store.photos || []).length >= names.length && ['completed', 'idle'].includes(store.status) && !(store.pending || []).length;
    if (done) break;
  } catch { /* the file appears with the first photo */ }
  await sleep(1500);
}
check(results, 'the app received and scanned all five shared photos', store && (store.photos || []).length >= names.length, store ? `${(store.photos || []).length} in the ledger, status ${store.status}` : 'no scan file');
await sleep(2500); // let the page import the records
const ledgerNames = (store?.photos || []).map(p => p.name);
const recordNames = (store?.records || []).map(r => r.name);
check(results, 'the photos arrived with their real file names (not "Phone photo.jpg")', names.every(n => ledgerNames.includes(n)), ledgerNames.join(','));
check(results, 'every photo the app handled is a synthetic E2E-*.jpg (no personal photo reached)', [...ledgerNames, ...recordNames].every(n => SYNTHETIC_NAME.test(n)), [...new Set([...ledgerNames, ...recordNames])].filter(n => !SYNTHETIC_NAME.test(n)).join(','));
check(results, 'the shared URIs were the app\'s own provider (content://<test app>.files/shared/E2E-*)', names.every(n => shareUri(c.app, n).startsWith(`content://${c.app}.files/shared/E2E-`)));
const web = await webState(c.device, c.app);
check(results, 'the web list shows the scanned records', web && web.records === (store?.records || []).length && web.records > 0, `web ${web?.records}, scan file ${(store?.records || []).length}`);
check(results, 'the web list holds only synthetic photo names', (web?.names || []).every(n => SYNTHETIC_NAME.test(n)));

// 4. Isolation evidence and cleanup.
// With the permissions revoked each op reads "ignore"; any attempt to read the gallery or storage would add "time=" or "rejectTime=" to its line.
const opsAfter = storageOps();
check(results, 'the app never tried to read the gallery or shared storage (no access or rejected-access time in app-ops)', opsAfter === opsBefore && opsAfter.length > 0 && !/time=/i.test(opsAfter), opsAfter === opsBefore ? '' : `before:\n${opsBefore}\nafter:\n${opsAfter}`);
const log = adb(c.device, 'logcat', '-d', '-s', 'AndroidRuntime:E', 'IMEI-Lens:E');
check(results, 'no crash during the share', !/FATAL EXCEPTION/.test(log));
unstageSyntheticPhotos(c.device, c.app);
const left = adb(c.device, 'shell', `run-as ${c.app} ls cache`).split(/\s+/).filter(n => /^E2E-/.test(n));
check(results, 'the staged copies were removed again', left.length === 0, left.join(','));
finish('16-share-photos', results);
