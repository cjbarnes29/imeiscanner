// Background crop queue: Bulk crop on photo B, two boxes, Save all (cuts in the background), press Home, wait, come back: the original is archived (reason queue), crops are linked.
import { ctx, scanAll, openStudioAndDrawTwoBoxes, clickText, webState, adb, sleep, check, finish } from './helpers.mjs';

const c = ctx(), results = [];
await scanAll(c);
const before = await webState(c.device, c.app);
await openStudioAndDrawTwoBoxes(c, { bulk: true });
check(results, 'Save all in the bulk crop is accepted and cuts in the background', await clickText(c, '^Save all'));
await sleep(1500);
adb(c.device, 'shell', 'input', 'keyevent', 'KEYCODE_HOME');
let state, waited = 0;
for (; waited < 120; waited += 6) {
  await sleep(6000);
  // return briefly to read the page state (the queue runs in the page; the foreground service keeps it alive)
  adb(c.device, 'shell', 'am', 'start', '-n', `${c.app}/com.imeilens.scanner.MainActivity`);
  await sleep(1500);
  state = await webState(c.device, c.app);
  if (state.archive.some(a => a.name === 'E2E-single-B.jpg')) break;
  adb(c.device, 'shell', 'input', 'keyevent', 'KEYCODE_HOME');
}
check(results, 'the queued photo was processed', state.archive.some(a => a.name === 'E2E-single-B.jpg'), `${waited}s`);
const entry = state.archive.find(a => a.name === 'E2E-single-B.jpg');
check(results, 'original archived with reason queue (never deleted)', !!entry && entry.reason === 'queue' && !entry.restored, JSON.stringify(entry));
check(results, 'two crops saved', state.names.filter(n => n === 'E2E-single-B.jpg').length === 2, `${state.names.filter(n => n === 'E2E-single-B.jpg').length}`);
check(results, 'no IMEI lost', before.imeis.filter(Boolean).every(i => state.imeis.includes(i) || state.archive.some(a => a.name === 'E2E-single-B.jpg')));
finish('10-background-queue', results);
