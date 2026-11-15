// "View / restore" must bring an archived original back. The restore button asks window.confirm(); the Android WebView shows a native OK / Cancel
// dialog for it, which this test answers like a person would (tap OK), and records what the dialog looks like.
import { ctx, scanAll, openStudioAndDrawTwoBoxes, saveAndArchive, clickText, waitForText, webState, adb, sleep, check, finish } from './helpers.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const c = ctx(), results = [];
const shots = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'scenario-shots');
mkdirSync(shots, { recursive: true });
const dump = () => adb(c.device, 'shell', 'uiautomator dump /sdcard/e2e-ui.xml >/dev/null 2>&1; cat /sdcard/e2e-ui.xml; rm -f /sdcard/e2e-ui.xml');

await scanAll(c);
const before = await webState(c.device, c.app);
await openStudioAndDrawTwoBoxes(c);
await saveAndArchive(c);
await clickText(c, '^Dismiss');            // close the Undo bar: restore through the archive list instead
check(results, 'archive banner offers View / restore', await waitForText(c, 'View / restore', 8000));
await clickText(c, '^View / restore');
check(results, 'archive list opens and names the original', await waitForText(c, 'Archived original photos', 8000) && await waitForText(c, 'E2E-single-B.jpg', 3000));

// The click does not return until the dialog is answered, so it is started without waiting.
const clicking = clickText(c, '^Restore original').catch(error => `click error: ${error.message}`);
await sleep(3500);
const xml = dump();
const ok = xml.match(/text="OK"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
const message = (xml.match(/text="([^"]*[Rr]estore[^"]*)"/) || [])[1] || '';
writeFileSync(join(shots, '04-confirm-dialog.xml.txt'), xml.replace(/text="[^"]*[0-9]{15}[^"]*"/g, 'text="(number removed)"').slice(0, 4000));
check(results, 'a native confirmation dialog with an OK button appears', !!ok, message.slice(0, 80));
if (ok) adb(c.device, 'shell', 'input', 'tap', String((+ok[1] + +ok[3]) / 2 | 0), String((+ok[2] + +ok[4]) / 2 | 0));
const outcome = await Promise.race([clicking, sleep(20000).then(() => 'timeout')]);
check(results, 'the page keeps responding after the dialog is answered', outcome !== 'timeout' && !String(outcome).startsWith('click error'), String(outcome).slice(0, 100));
await sleep(2500);
const after = await webState(c.device, c.app);
const entry = after.archive.find(a => a.name === 'E2E-single-B.jpg');
check(results, 'Restore original restores the record', !!entry && entry.restored === true, `restored=${entry ? entry.restored : 'no entry'}; records ${before.records} -> ${after.records}`);
check(results, 'the two crops are kept in the archive entry (nothing lost)', !!entry && entry.removedCrops === 2);
finish('04-restore-from-archive-list', results);
