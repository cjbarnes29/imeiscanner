// RetailLens 1.38+ inside the real Android app (isolated test app, nothing scanned, no photos, no real data):
//  - the ⋯ More menu has Give and share as ONE entry, and its three tabs open (Suggested, By model, Send)
//  - the Store only switch is on the Scan screen and is remembered
//  - the phone's Back button goes to the screen before (and closes a popup first) instead of leaving the app
//  - Targets has the "Share summary" button (off while there are no targets)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ctx, sleep, check, finish, adb, js } from './helpers.mjs';

const c = ctx(), results = [];
const adbExe = join(process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', 'adb.exe');
const shot = name => { try { const dir = join('phase2-results', 'screens', 'v4'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `emulator-${name}.png`), execFileSync(adbExe, ['-s', c.device, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 })); } catch { /* a screenshot is a bonus */ } };
const waitJs = async (code, label, tries = 40) => { for (let i = 0; i < tries; i++) { try { if (await js(c, code)) return true; } catch { /* the page is starting or reloading */ } await sleep(1500); } throw new Error(`Timed out waiting for ${label}`); };
const eval_ = async (code, tries = 30) => { for (let i = 0; i < tries; i++) { try { return await js(c, code); } catch { await sleep(1500); } } throw new Error('the page did not answer'); };
const press = name => eval_(`(()=>{const b=[...document.querySelectorAll('.bottom-nav button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(name)}));if(!b)return false;b.click();return true;})()`);
const title = () => eval_(`(()=>{const h=[...document.querySelectorAll('.view-head h2')].find(e=>e.offsetParent!==null);return h?h.textContent.trim():''})()`);
const back = async () => { adb(c.device, 'shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1500); };
const foreground = () => adb(c.device, 'shell', 'dumpsys', 'activity', 'activities').split('\n').find(l => /topResumedActivity/.test(l)) || '';

adb(c.device, 'shell', 'pm', 'clear', c.app);
try { adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ }
adb(c.device, 'shell', 'am', 'start', '-n', `${c.app}/com.imeilens.scanner.MainActivity`);
await waitJs(`document.readyState==='complete'&&!!document.querySelector('.bottom-nav, .brand')`, 'the app to load');
await eval_(`localStorage.setItem('imei-lens-simple-view','false');true`);
try { await js(c, `location.reload();true`); } catch { /* the page went away while reloading */ }
await sleep(5000);
await waitJs(`!!document.querySelector('.bottom-nav')`, 'the app after the reload');
await eval_(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Got it|Close/.test(x.textContent));if(b)b.click();return true;})()`);
await sleep(800);

// ---- the More menu and Give and share ----
await eval_(`document.querySelector('button[aria-label="More"]').click();true`);
await waitJs(`!!document.querySelector('.more-list')`, 'the More menu');
const items = await eval_(`[...document.querySelectorAll('.more-list strong')].map(s=>s.textContent)`);
check(results, 'More has People, Give and share, Segments, Catalog, Backup and data, Settings', JSON.stringify(items) === JSON.stringify(['People', 'Give and share', 'Segments', 'Catalog', 'Backup and data', 'Settings']), JSON.stringify(items));
shot('more-menu');
await eval_(`(()=>{const b=[...document.querySelectorAll('.more-list button')].find(x=>x.textContent.trim().startsWith('Give and share'));b.click();return true;})()`);
await waitJs(`!!document.querySelector('.give-tabs')`, 'the Give and share tabs');
check(results, 'Give and share has its own title', (await title()) === 'Give and share', await title());
const tabs = await eval_(`[...document.querySelectorAll('.give-tabs button')].map(b=>b.textContent.trim())`);
check(results, 'the three tabs are Suggested, By model, Send', JSON.stringify(tabs) === JSON.stringify(['Suggested', 'By model', 'Send']), JSON.stringify(tabs));
for (const t of ['By model', 'Send', 'Suggested']) {
  await eval_(`(()=>{const b=[...document.querySelectorAll('.give-tabs button')].find(x=>x.textContent.trim()===${JSON.stringify(t)});b.click();return true;})()`);
  await sleep(700);
  check(results, `the ${t} tab opens and stays under the title Give and share`, (await title()) === 'Give and share' && await eval_(`!!document.querySelector('.give-tabs button.on')&&document.querySelector('.give-tabs button.on').textContent.trim()===${JSON.stringify(t)}`));
}
shot('give-and-share');

// ---- the Store only switch (Scan screen) ----
await press('Scan');
await waitJs(`!!document.querySelector('.store-only input')`, 'the Store only switch');
await eval_(`document.querySelector('.store-only input').click();true`);
await sleep(500);
check(results, 'Store only can be switched on and is remembered', await eval_(`localStorage.getItem('imeilens.storeOnly')==='on'&&document.querySelector('.store-only input').checked`));
shot('store-only-on');
await eval_(`document.querySelector('.store-only input').click();true`);
await sleep(500);
check(results, 'and switched off again', await eval_(`localStorage.getItem('imeilens.storeOnly')==='off'&&!document.querySelector('.store-only input').checked`));

// ---- Targets: the summary button is off with no targets ----
await press('Targets');
await waitJs(`!!document.querySelector('.retail-hub')`, 'Targets');
check(results, 'Targets has "Share summary: pieces per day", off while there are no targets', await eval_(`[...document.querySelectorAll('button')].some(b=>/^Share summary: pieces per day/.test(b.innerText)&&b.disabled)`));

// ---- the phone's Back button ----
await press('Home'); await sleep(700);
await press('Phones'); await sleep(700);
await press('Targets'); await sleep(700);
await press('Report'); await sleep(700);
await back();
check(results, 'Back from Report goes to Targets (the app stays open)', /MainActivity/.test(foreground()) && (await title()) === 'Targets', `${await title()} | ${foreground().slice(0, 90)}`);
await back();
check(results, 'Back again goes to Phones', /MainActivity/.test(foreground()) && /^Phones/.test(await title()), `${await title()} | ${foreground().slice(0, 90)}`);
await eval_(`document.querySelector('button[aria-label="More"]').click();true`);
await waitJs(`!!document.querySelector('.more-list')`, 'the More menu for the Back test');
await back();
check(results, 'Back closes the open More menu first and stays on the same screen', await eval_(`!document.querySelector('.more-list')`) && /^Phones/.test(await title()), await title());
const logcat = adb(c.device, 'logcat', '-d');
check(results, 'no crash and no "app not responding" of the test app in the log', !/FATAL EXCEPTION[\s\S]{0,200}Process: com\.imeilens\.scanner\.phonetest|ANR in com\.imeilens\.scanner\.phonetest/.test(logcat));
shot('after-back');
finish('23-give-share-store-only-back', results);
