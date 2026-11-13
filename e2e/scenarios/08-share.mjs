// Sharing: the Share dialog lists every record with picture and number text and offers the share actions.
// The Android share sheet itself and the receiving apps (WhatsApp, Bluetooth) need a real phone and are not checked here.
import { ctx, scanAll, clickText, waitForText, bodyText, sleep, check, finish } from './helpers.mjs';
import { truth } from '../scripts/lib.mjs';

const c = ctx(), results = [];
await scanAll(c);
check(results, 'Share tab opens', await clickText(c, '^Share$'));
await sleep(1000);
check(results, 'Share all button is offered', await clickText(c, '^Share all'));
check(results, 'the dialog says "Share 5 records"', await waitForText(c, 'Share 5 records', 8000));
const text = await bodyText(c);
check(results, 'Share all numbers and Copy numbers are offered', text.includes('Share all numbers') && text.includes('Copy numbers'));
const A = truth['E2E-single-A.jpg'].imei1[0];
check(results, 'the numbers message lists the synthetic IMEIs', text.includes(A));
check(results, 'the dialog can be closed', await clickText(c, '^Close sharing'));
await sleep(800);
check(results, 'back on the records after closing', !(await bodyText(c)).includes('Share 5 records'));
finish('08-share', results);
