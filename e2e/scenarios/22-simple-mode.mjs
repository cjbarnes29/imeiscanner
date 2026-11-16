// Simple mode inside the real Android app (isolated test app, nothing scanned, no photos): three screens, Scan, Phones, Send.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ctx, sleep, check, finish, adb, js } from './helpers.mjs';

const c = ctx(), results = [];
const adbExe = join(process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', 'adb.exe');
const shot = name => { try { const dir = join('phase2-results', 'screens', 'v3'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `emulator-${name}.png`), execFileSync(adbExe, ['-s', c.device, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 })); } catch { /* a screenshot is a bonus */ } };
const waitJs = async (code, label, tries = 40) => { for (let i = 0; i < tries; i++) { try { if (await js(c, code)) return true; } catch { /* the page is starting or reloading */ } await sleep(1500); } throw new Error('Timed out waiting for: ' + label); };

adb(c.device, 'shell', 'pm', 'clear', c.app);
try { adb(c.device, 'shell', 'pm', 'grant', c.app, 'android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ }
adb(c.device, 'shell', 'am', 'start', '-n', `${c.app}/com.imeilens.scanner.MainActivity`);
await waitJs(`document.readyState==='complete'&&!!document.querySelector('.bottom-nav, .brand')`, 'the app to load');
await waitJs(`(localStorage.setItem('imei-lens-simple-view','true'),true)`, 'the page to accept the setting');
try { await js(c, `location.reload();true`); } catch { /* the page went away while reloading */ }
await sleep(5000);
await waitJs(`!!document.querySelector('.bottom-nav')`, 'the app in Simple mode');
await waitJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Got it|Close/.test(x.textContent));if(b)b.click();return true;})()`, 'the welcome note to close');
await sleep(800);

const bar = await js(c, `[...document.querySelectorAll('.bottom-nav button span')].map(s=>s.textContent)`);
check(results, 'Simple mode has the bottom bar Scan, Phones, Send', JSON.stringify(bar) === JSON.stringify(['Scan', 'Phones', 'Send']), JSON.stringify(bar));
check(results, 'there is no ⋯ More button in Simple mode', !(await js(c, `!!document.querySelector('button[aria-label="More"]')`)));
check(results, 'with nothing scanned the Scan screen is shown first', await js(c, `!!document.querySelector('#upload:not([hidden])')`));
check(results, 'the Scan screen does not also show the phone list', !(await js(c, `!!document.querySelector('#records:not([hidden])')`)));
shot('simple-scan');
const go = name => js(c, `(()=>{const b=[...document.querySelectorAll('.bottom-nav button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(name)}));if(!b)return false;b.click();return true;})()`);
await go('Phones');
await waitJs(`!!document.querySelector('#records:not([hidden])')`, 'the Phones screen');
check(results, 'Phones has its own title', await js(c, `document.querySelector('.results .view-head h2').innerText.startsWith('Phones')`));
check(results, 'with nothing scanned Phones says what to do', await js(c, `/Your scanned devices will appear here/.test(document.querySelector('.results').innerText)`));
shot('simple-phones');
await go('Send');
await waitJs(`!!document.querySelector('#send:not([hidden])')`, 'the Send screen');
const buttons = await js(c, `[...document.querySelectorAll('#send .send-list button')].map(b=>b.innerText.trim())`);
check(results, 'Send has Export Excel, Share phones, Send numbers and Download pictures', buttons.length >= 4 && /^Export Excel/.test(buttons[0]), JSON.stringify(buttons));
check(results, 'with nothing scanned the Send buttons are off (nothing to send)', await js(c, `[...document.querySelectorAll('#send .send-list button')].every(b=>b.disabled)`));
shot('simple-send');
finish('22-simple-mode', results);
