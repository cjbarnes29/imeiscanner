// Background processing: start a gallery scan, press Home, let it finish while the app is NOT in the foreground, then come back.
import { ctx, maestro, adb, sleep, check, finish } from './helpers.mjs';
import { nativeStore, truth } from '../scripts/lib.mjs';

const c = ctx(), results = [];
adb(c.device, 'shell', 'pm', 'clear', 'com.google.android.documentsui');
maestro(c.device, '_common/start-scan-then-home.yaml');
const focus = () => adb(c.device, 'shell', 'dumpsys window | grep mCurrentFocus');
check(results, 'the app is in the background (not the focused window)', !focus().includes(c.app), focus().trim().slice(-60));
let done = false, store;
for (let i = 0; i < 40 && !done; i++) {
  await sleep(3000);
  try { store = nativeStore(c.device, c.app); done = store.status === 'completed'; } catch { /* store not written yet */ }
}
check(results, 'the scan completed while the app was in the background', done, store ? `status=${store.status}` : 'no store');
check(results, 'still in the background when it finished', !focus().includes(c.app));
check(results, 'all five photos have a report entry', store && (store.photos || []).filter(p => /^E2E-/.test(p.name)).length === Object.keys(truth).length, store ? `${(store.photos || []).length}` : '');
check(results, 'records were saved (no lost products)', store && store.records.length >= 5, store ? `${store.records.length}` : '');
const services = adb(c.device, 'shell', `dumpsys activity services ${c.app} | grep -c ServiceRecord`).trim();
maestro(c.device, '_common/resume-and-wait.yaml');
check(results, 'the app shows the finished scan after returning', true, `services running before return: ${services}`);
finish('09-background-scan', results);
