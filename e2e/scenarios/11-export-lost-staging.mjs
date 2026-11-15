// CSV export where the staged copy is also lost (cache cleared) while the Save dialog is open: no 0-byte file may remain, and the app must say so.
import { ctx, scanAll, clickText, js, adb, sleep, check, finish, waitForText } from './helpers.mjs';

const c = ctx(), results = [];
adb(c.device, 'shell', 'rm -f /sdcard/Download/imei-scanner-export*');
await scanAll(c);
await clickText(c, '^Export');
await sleep(800);
await js(c, `(()=>{const set=(sel,text)=>{const o=[...sel.options].find(o=>o.text.startsWith(text));const st=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;st.call(sel,o.value);sel.dispatchEvent(new Event('change',{bubbles:true}))};const s=[...document.querySelectorAll('select')];set(s.find(x=>[...x.options].some(o=>o.text.startsWith('IMEI and model only'))),'IMEI and model only');set(s.find(x=>[...x.options].some(o=>o.text.startsWith('CSV'))),'CSV');return 1})()`);
await sleep(500);
check(results, 'export started', await clickText(c, '^Export [0-9]+ records'));
await sleep(6000);
check(results, 'the system Save dialog is showing', adb(c.device, 'shell', 'dumpsys window | grep mCurrentFocus').includes('documentsui'));
adb(c.device, 'shell', 'am', 'kill', c.app); adb(c.device, 'shell', 'run-as', c.app, 'sh', '-c', "'rm -f cache/imei-export-*'");
await sleep(2000);
// tap Save (position from UI Automator)
const xml = adb(c.device, 'shell', 'uiautomator dump /sdcard/e2e-ui.xml >/dev/null 2>&1; cat /sdcard/e2e-ui.xml; rm -f /sdcard/e2e-ui.xml');
const m = xml.match(/text="Save"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || xml.match(/text="SAVE"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
check(results, 'Save button found', !!m);
if (m) adb(c.device, 'shell', 'input', 'tap', String((+m[1] + +m[3]) / 2 | 0), String((+m[2] + +m[4]) / 2 | 0));
check(results, 'the restarted app tells the user the export was interrupted', await waitForText(c, 'was interrupted', 30000));
const listing = adb(c.device, 'shell', 'ls -l /sdcard/Download');
const line = listing.split('\n').find(l => /imei-scanner-export/.test(l)) || '';
const size = Number((line.match(/\s(\d+)\s\d{4}-\d{2}-\d{2}/) || [])[1] ?? -1);
check(results, 'no empty (0-byte) export file is left behind', size !== 0, line ? `${size} bytes` : 'no file');
adb(c.device, 'shell', 'rm -f /sdcard/Download/imei-scanner-export*');
finish('11-export-lost-staging', results);
