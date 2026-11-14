// A label that runs off the edge of the photo: the app says WHY it could not be read and what to do (retake, crop, or keep), never guesses an
// IMEI, keeps the original photo and the records, and lists the photo in the scan report. Synthetic photo EDGE-cut-bottom.jpg, shared to the app
// (no picker): see 16-share-photos.mjs for the isolation rules.
import { ctx, sleep, check, finish, adb, js, clickText, waitForText, webState } from './helpers.mjs';
import { nativeStore, stageSyntheticPhotos, sharePhoto, unstageSyntheticPhotos, requireShareAllowed } from '../scripts/lib.mjs';

const c = ctx(), results = [];
requireShareAllowed(c.device);
const PHOTO = 'EDGE-cut-bottom.jpg';

adb(c.device, 'shell', 'pm', 'clear', c.app);
stageSyntheticPhotos(c.device, c.app, [PHOTO]);
sharePhoto(c.device, c.app, PHOTO);
let store = null;
for (let i = 0; i < 80; i++) {
  try { store = nativeStore(c.device, c.app); if ((store.photos || []).length >= 1 && ['completed', 'idle'].includes(store.status) && !(store.pending || []).length) break; } catch { /* starting */ }
  await sleep(1500);
}
unstageSyntheticPhotos(c.device, c.app);
await sleep(2500);

const rows = (store?.records || []).filter(r => r.name === PHOTO);
const cut = rows.find(r => !r.imei);
check(results, 'the photo gave two products: one read, one without an IMEI', rows.length === 2 && !!cut, `${rows.length} record(s)`);
check(results, 'the scanner says the label is cut off at the bottom edge', cut?.labelIssue === 'cut-edge' && cut?.labelIssueSide === 'bottom', `${cut?.labelIssue}/${cut?.labelIssueSide}`);
check(results, 'the record that was read has no issue (nothing is claimed about it)', rows.filter(r => r.imei).every(r => !r.labelIssue));
const entry = (store?.photos || []).find(p => p.name === PHOTO);
check(results, 'the scan report entry asks for a retake', entry?.retake === true && entry?.retakeKind === 'cut-edge', JSON.stringify({ retake: entry?.retake, kind: entry?.retakeKind }));

// the review dialog of the unreadable record
await waitForText(c, 'Records', 20000);
await clickText(c, '^Records');
await sleep(1200);
// The NEEDS REVIEW tile filters the list to the record that needs a look; its photo opens the review dialog.
await js(c, `(()=>{const b=document.querySelector('button[aria-label="Show records that need review"]');if(b)b.click();return !!b})()`);
await sleep(1200);
const opened = await js(c, `(()=>{const b=document.querySelector('button.photo-cell');if(!b)return false;b.click();return true})()`);
check(results, 'the record without an IMEI is marked "Needs review" (not "Serial only") and opens', opened);
check(results, 'the retake prompt appears', await waitForText(c, 'Retake this photo', 15000));
const body = await js(c, 'document.body.innerText');
check(results, 'it explains the reason in words', /appears to be cut off at the bottom edge of the photo/.test(body));
check(results, 'it tells the person what to do', /Retake the photo with the whole label inside the frame/.test(body));
check(results, 'it offers Retake photo, Crop manually and Keep as is', ['Retake photo', 'Crop manually', 'Keep as is'].every(t => body.includes(t)));
check(results, 'it says nothing is filled in and the original is kept', /Nothing is filled in for you, and your original photo is kept/.test(body));

// never guessed, never lost
let web = await webState(c.device, c.app);
check(results, 'no IMEI was invented for the cut label; both records are still there', web.records === 2 && web.imeis.filter(Boolean).length === 1, `${web.records} records, ${web.imeis.filter(Boolean).length} with an IMEI`);

// Keep as is: the prompt goes away, the record still needs review
await clickText(c, '^Keep as is');
await sleep(1000);
const after = await js(c, 'document.body.innerText');
check(results, '"Keep as is" hides the retake prompt', !after.includes('Retake this photo'));
web = await webState(c.device, c.app);
check(results, 'the record is still without an IMEI and still listed (nothing accepted)', web.records === 2 && web.imeis.filter(Boolean).length === 1);

// the scan report lists the photo
await js(c, `(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^(Close|Done|Back)$/.test((e.innerText||'').trim()));if(b)b.click();return !!b})()`);
await sleep(800);
await clickText(c, '^Scan');
await sleep(1200);
const shown = await clickText(c, 'Show scan report');
await sleep(1500);
const report = await js(c, 'document.body.innerText');
check(results, 'the scan report has a "Retake" section naming the photo and the reason', shown && /Retake this photo/.test(report) && report.includes(PHOTO) && /cut off at the bottom edge/.test(report), shown ? '' : 'report button not found');
finish('17-retake-prompt', results);
