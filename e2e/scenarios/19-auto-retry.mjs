// The automatic retry after a scan (failure reasons, the phone's own second read, IMEI 1 recovered from its barcode, strict rules, one retry only).
// Synthetic photos RETRY-*.jpg shared to the test app (no picker, nothing in shared storage): see 16-share-photos.mjs for the isolation rules.
//   RETRY-small-barcode.jpg  IMEI 1 digits worn off, real Code 128 barcode too small for the normal decode size: recovered by the retry from the barcode
//   RETRY-conflict.jpg       the readable printed digits belong to another number than the barcode: IMEI 1 must NOT be taken
//   RETRY-blank.jpg          a gray table, nothing to read: unresolved after its one retry, not added twice, never retried again
import { ctx, sleep, check, finish, adb, js, clickText, waitForText, webState } from './helpers.mjs';
import { nativeStore, stageSyntheticPhotos, sharePhoto, unstageSyntheticPhotos, requireShareAllowed, retryTruth, mask } from '../scripts/lib.mjs';

const c = ctx(), results = [];
requireShareAllowed(c.device);
const SMALL = 'RETRY-small-barcode.jpg', CONFLICT = 'RETRY-conflict.jpg', BLANK = 'RETRY-blank.jpg';
const PHOTOS = [SMALL, CONFLICT, BLANK];
const t = retryTruth;
if (!t[SMALL]) throw new Error('run: node e2e/fixtures/make-retry-fixtures.mjs');

adb(c.device, 'shell', 'pm', 'clear', c.app);
try { adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ } // else a permission dialog covers the app and shared photos can be missed
stageSyntheticPhotos(c.device, c.app, PHOTOS);
// One photo at a time: a share that arrives while the app is still starting can be missed (a known cold-start timing issue of rapid intents, unrelated
// to what is tested here), so each photo is sent again once if the app has not registered it within 20 s.
const registered = name => {
  try { const s = nativeStore(c.device, c.app); return [...(s.queue || []), ...(s.pending || []), ...(s.photos || [])].some(p => p.name === name); } catch { return false; }
};
for (const name of PHOTOS) {
  for (let attempt = 0; attempt < 2 && !registered(name); attempt++) {
    sharePhoto(c.device, c.app, name);
    for (let i = 0; i < 10 && !registered(name); i++) await sleep(2000);
  }
}

// The scan, then the one automatic retry the phone starts by itself: wait until every photo has been tried again and nothing is waiting or running.
let store = null;
const settled = s => (s.photos || []).length >= 3 && ['completed', 'idle'].includes(s.status) && !(s.pending || []).length
  && (s.photos || []).every(p => p.autoRetry !== 'pending' && p.autoRetry === 'done');
for (let i = 0; i < 240; i++) {
  try { store = nativeStore(c.device, c.app); if (settled(store)) break; } catch { /* starting */ }
  await sleep(2000);
}
unstageSyntheticPhotos(c.device, c.app);
await sleep(2500);
store = nativeStore(c.device, c.app);

const entry = name => (store.photos || []).find(p => p.name === name);
const rowsOf = name => (store.records || []).filter(r => r.name === name);
check(results, 'every photo was tried again once, by the phone itself (retry job, scanned twice, marked done)',
  PHOTOS.every(n => entry(n)?.autoRetry === 'done' && entry(n)?.retryJob === true && entry(n)?.scans === 2), JSON.stringify(PHOTOS.map(n => [entry(n)?.autoRetry, entry(n)?.scans])));
check(results, 'the retry reported under the scan it followed (one report, not a new one)', new Set((store.photos || []).map(p => p.jobId)).size === 1);

// 1. recovered from the barcode
const smallRows = rowsOf(SMALL);
const smallOld = smallRows[0], smallNew = smallRows.find(r => r.imei === t[SMALL].imei1);
check(results, 'small barcode: the first scan could not read IMEI 1 (only IMEI 2, flagged)', !!smallOld && smallOld.imei === t[SMALL].imei2 && smallOld.imeiFallback === true, `old: ${mask(smallOld?.imei)} fallback=${smallOld?.imeiFallback}`);
check(results, 'small barcode: the retry recovered IMEI 1 from the barcode, not flagged', !!smallNew && smallNew.recoveredBy === 'barcode' && !smallNew.imeiFallback && !smallNew.imeiNeedsReview, `new: ${mask(smallNew?.imei)} by=${smallNew?.recoveredBy}`);
check(results, 'small barcode: the new record names the earlier one it replaces (so the app archives it, no pair left behind)', !!smallNew && smallNew.replaces === smallOld?.id);
check(results, 'small barcode: the report entry counts it as recovered', entry(SMALL)?.recovered === 1 && entry(SMALL)?.retryWorthy === false, JSON.stringify({ recovered: entry(SMALL)?.recovered, worthy: entry(SMALL)?.retryWorthy }));

// 2. strict: a contradiction is never accepted
const conflictRows = rowsOf(CONFLICT);
check(results, 'conflict: IMEI 1 is NOT taken from a barcode that disagrees with the printed digits', conflictRows.length >= 1 && conflictRows.every(r => r.imei !== t[CONFLICT].imei1), conflictRows.map(r => mask(r.imei)).join(','));
check(results, 'conflict: the record stays IMEI 2 only and is flagged (never presented as a clean IMEI 1)', conflictRows.some(r => r.imei === t[CONFLICT].imei2 && r.imeiFallback === true));
check(results, 'conflict: no second record was added for the same label', conflictRows.length === 1, `${conflictRows.length} record(s)`);

// 3. nothing to read: one retry, no second empty copy
const blankRows = rowsOf(BLANK);
check(results, 'blank: one record without an IMEI, with its reason in words', blankRows.length === 1 && !blankRows[0].imei && blankRows[0].failReason === 'no-text', `${blankRows.length} record(s), reason=${blankRows[0]?.failReason}`);
check(results, 'blank: the retry added no second empty copy (the earlier record stays)', (entry(BLANK)?.emptyRepeats || []).length === 1 && entry(BLANK)?.saved === 0, JSON.stringify(entry(BLANK)?.emptyRepeats));
const reasons = entry(BLANK)?.reasons || {};
check(results, 'blank: the report entry counts the reason', reasons['no-text'] === 1, JSON.stringify(reasons));

// 4. never an infinite loop: wait, then nothing has run again
await sleep(30000);
const later = nativeStore(c.device, c.app);
check(results, 'no endless retries: 30 s later nothing was scanned again and nothing is running', PHOTOS.every(n => (later.photos || []).find(p => p.name === n)?.scans === 2) && ['completed', 'idle'].includes(later.status), `${later.status}`);

// 5. the page: one record per label, the replaced one archived, nothing duplicated
let web = null;
for (let i = 0; i < 40; i++) { try { web = await webState(c.device, c.app); if (web.records >= 3 && web.archive.length >= 1) break; } catch { /* starting */ } await sleep(1500); }
check(results, 'page: three records (one per label), IMEI 1 of the small-barcode photo is there', web?.records === 3 && (web?.imeis || []).includes(t[SMALL].imei1), `${web?.records} records`);
check(results, 'page: the earlier unreadable record was archived by the rescan (restorable), not deleted', (web?.archive || []).some(a => a.name === SMALL && a.reason === 'rescan' && !a.restored), JSON.stringify(web?.archive));
check(results, 'page: no duplicate flags', web?.duplicates === 0);
// The second-stage retry (the page's own reader) leaves what is still unreadable alone for a moment; give it time, then it must not have invented anything.
await sleep(20000);
web = await webState(c.device, c.app);
check(results, 'page: nothing was invented later (no IMEI 1 for the conflict or blank photos, still three records)', web.records === 3 && !(web.imeis || []).includes(t[CONFLICT].imei1), `${web.records} records`);

// 6. the scan report in words
await waitForText(c, 'Scan', 20000);
await clickText(c, '^Scan');
await sleep(1200);
const shown = await clickText(c, 'Show scan report');
await sleep(1500);
const report = await js(c, 'document.body.innerText');
check(results, 'the report says why a label was not read and that the retry could not help (the summary covers the latest scan; the retry counts are checked on the ledger above)', shown && /tried again: nothing more could be read/.test(report) && /1 without an IMEI/.test(report), report.split('\n').filter(l => /retried|without an IMEI|only IMEI 2/.test(l)).join(' | ').slice(0, 300));
check(results, 'the report names the reason of the blank photo in words', /no label text found/.test(report));
finish('19-auto-retry', results);
