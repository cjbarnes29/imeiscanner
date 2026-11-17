// A WhatsApp report shared to RetailLens as TEXT: the app takes it (even when it was not running) and opens Retail > Reports with it filled in.
// Synthetic text only. Shared to the isolated test app (-p) with an ACTION_SEND text/plain intent, the way WhatsApp's Share does.
import { ctx, sleep, check, finish, adb, js } from './helpers.mjs';
import { requireShareAllowed } from '../scripts/lib.mjs';

const c = ctx(), results = [];
requireShareAllowed(c.device);
const share = text => adb(c.device, 'shell', `am start -a android.intent.action.SEND -t text/plain -p ${c.app} --es android.intent.extra.TEXT '${text}'`);
const reportsFilled = marker => js(c, `(()=>{const title=document.querySelector('.results .view-head h2');return title?.textContent.trim()==='Report'&&[...document.querySelectorAll('textarea')].some(t=>t.value.includes(${JSON.stringify(marker)}));})()`);
const waitFilled = async marker => { for (let i = 0; i < 40; i++) { try { if (await reportsFilled(marker)) return true; } catch { /* the page is still starting */ } await sleep(1500); } return false; };

// 1. cold start: the app is not running when the text arrives
adb(c.device, 'shell', 'pm', 'clear', c.app);
try { adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ }
adb(c.device, 'shell', 'am', 'force-stop', c.app);
share('Daily Report 15/11/2026 SYNTHETIC-COLD-START Sellout A17 5G 6/128 - 2');
check(results, 'cold start: the shared report text opens Retail > Reports with the text in the example box', await waitFilled('SYNTHETIC-COLD-START'));
// 2. the text is handed over once: a restart does not bring it back
adb(c.device, 'shell', 'am', 'force-stop', c.app);
adb(c.device, 'shell', 'am', 'start', '-n', `${c.app}/com.imeilens.scanner.MainActivity`);
await sleep(8000);
let again = false; try { again = await js(c, `[...document.querySelectorAll('textarea')].some(t=>t.value.includes('SYNTHETIC-COLD-START'))`); } catch { /* page not ready */ }
check(results, 'the text is taken once: after a restart it is not filled in again', !again);
// 3. warm: the app is already open
share('Daily Report 16/11/2026 SYNTHETIC-WARM Sellout A57 5G 8/256 - 1');
check(results, 'warm: a second shared report replaces the example', await waitFilled('SYNTHETIC-WARM'));
// 4. nothing else changed: the scan list is still empty and the shared text never became a record
const records = await js(c, `new Promise(res=>{const o=indexedDB.open('imei-lens-v2',1);o.onsuccess=()=>{const db=o.result;const q=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound('record:','record:\\uffff'));q.onsuccess=()=>{db.close();res(q.result.length);};};})`);
check(results, 'a shared report is text for Reports: it creates no scan record', records === 0, `${records} records`);
finish('20-shared-report-text', results);
