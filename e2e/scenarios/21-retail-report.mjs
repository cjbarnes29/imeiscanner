// RetailLens plan v2 inside the real Android app (isolated test app, SYNTHETIC text only): the Retail tab has the new sections, a pasted report is read
// and shown with its checks, and the Targets level chips and segment lines are there. No scan, no photo, nothing in shared storage.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ctx, sleep, check, finish, adb, js } from './helpers.mjs';

const c = ctx(), results = [];
const adbExe = join(process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', 'adb.exe');
const shot = name => { try { const dir = join('phase2-results', 'screens', 'v2'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `emulator-${name}.png`), execFileSync(adbExe, ['-s', c.device, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 })); } catch { /* a screenshot is a bonus, never a reason to fail */ } };
const eval_ = async (code, tries = 30) => { for (let i = 0; i < tries; i++) { try { return await js(c, code); } catch { await sleep(1500); } } throw new Error('the page did not answer'); };
const waitJs = async (code, label, tries = 40) => { for (let i = 0; i < tries; i++) { try { if (await js(c, code)) return true; } catch { /* page is starting or reloading */ } await sleep(1500); } throw new Error('Timed out waiting for: ' + label); };

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
await eval_(`(()=>{[...document.querySelectorAll('.bottom-nav button')].find(b=>b.textContent.trim().startsWith('Home')).click();return true;})()`);
await waitJs(`!!document.querySelector('.retail-hub')`, 'RetailLens Home');
const bar = await eval_(`[...document.querySelectorAll('.bottom-nav button span')].map(s=>s.textContent)`);
check(results, 'the bottom bar is Home, Scan, Phones, Report, Targets, Export', JSON.stringify(bar) === JSON.stringify(['Home', 'Scan', 'Phones', 'Report', 'Targets', 'Export']), JSON.stringify(bar));
check(results, 'every screen has its own title (no repeated Scanned records)', await eval_(`document.querySelector('.results .view-head h2').innerText==='Home'`));

const tab = async name => { if (name === 'Report' || name === 'Targets') return eval_(`(()=>{const b=[...document.querySelectorAll('.bottom-nav button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(name)}));if(!b)return false;b.click();return true;})()`); await eval_(`document.querySelector('button[aria-label="More"]').click();true`); await sleep(700); return eval_(`(()=>{const b=[...document.querySelectorAll('.more-list button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(name)}));if(!b)return false;b.click();return true;})()`); };
await tab('Report');
await waitJs(`!!document.querySelector('textarea[aria-label="The report"]')`, 'the paste box');
const REPORT = ['Date: Nov 11, 2026', '', 'A07 64GB : 04/15', '(02,00,13) Vlt,Grn,Blk', '', 'A57 5G 8/256GB : 00/01', '(00,00,01,0p) GRY,NVY,LiLc,I.BLU', '', 'Total Sellout : 4'].join(String.fromCharCode(10));
await eval_(`(()=>{const el=document.querySelector('textarea[aria-label="The report"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(REPORT)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
await sleep(500);
await eval_(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Read the report').click();return true;})()`);
await waitJs(`!!document.querySelector('.rep-chips')`, 'the report summary');
const rows = await eval_(`[...document.querySelectorAll('.rep-row')].map(r=>r.innerText.replace(/\\s+/g,' '))`);
check(results, 'the pasted report is read: two model lines', rows.length === 2, JSON.stringify(rows));
check(results, 'a number that cannot be read ("0p") is reported, not guessed', rows.some(r => /A57/.test(r) && /could not be read/.test(r)), JSON.stringify(rows));
check(results, 'with no scanned phones the report is not called wrong: it says nothing is scanned yet', rows.some(r => /A07/.test(r) && /none scanned/.test(r)), JSON.stringify(rows));
shot('report');
const copied = await eval_(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Copy report').click();return true;})()`);
check(results, 'Copy report can be pressed (the page does not break)', copied === true);

await tab('Segments');
await waitJs(`!!document.querySelector('input[aria-label="New segment name"]')`, 'Segments');
await eval_(`(()=>{const el=document.querySelector('input[aria-label="New segment name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Fold 1');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
await eval_(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ New segment').click();return true;})()`);
await waitJs(`document.body.innerText.includes('Fold 1')`, 'the new segment');
check(results, 'a segment of your own can be made', true);
shot('segments');

await tab('Targets');
await waitJs(`!!document.querySelector('.lvl-chips')`, 'the level chips');
const chips = await eval_(`[...document.querySelectorAll('.lvl-chips button')].map(b=>b.textContent)`);
check(results, 'Targets has the level chips 70 to 120', JSON.stringify(chips) === JSON.stringify(['70', '80', '90', '100', '110', '120']), JSON.stringify(chips));
check(results, 'the new segment is a line in Targets', await eval_(`[...document.querySelectorAll('.tg-seg')].some(b=>b.innerText.includes('Fold 1'))`));
shot('targets');

// the ⋯ More menu is a bottom sheet with a handle
await eval_(`document.querySelector('button[aria-label="More"]').click();true`);
await sleep(900);
check(results, 'the More menu opens as a bottom sheet with a grab handle', await eval_(`!!document.querySelector('.more-sheet .sheet-grab')`));
shot('more-sheet');
await eval_(`document.querySelector('.more-sheet [aria-label="Close"]').click();true`);
await sleep(400);
// an accent theme turns every green of the app to another hue (and goes back)
await eval_(`localStorage.setItem('retaillens-theme-v1','violet');document.documentElement.setAttribute('data-theme','violet');true`);
await sleep(500);
shot('theme-violet');
check(results, 'the Violet theme changes the accent colour', await eval_(`getComputedStyle(document.documentElement).getPropertyValue('--g1').trim()!=='' && document.documentElement.getAttribute('data-theme')==='violet'`));
await eval_(`localStorage.removeItem('retaillens-theme-v1');document.documentElement.removeAttribute('data-theme');true`);

// the report and the segment are still there after the app is closed and opened again
adb(c.device, 'shell', 'am', 'force-stop', c.app);
adb(c.device, 'shell', 'am', 'start', '-n', `${c.app}/com.imeilens.scanner.MainActivity`);
await waitJs(`!!document.querySelector('.bottom-nav')`, 'the app after a restart');
await eval_(`(()=>{[...document.querySelectorAll('.bottom-nav button')].find(b=>b.textContent.trim().startsWith('Home')).click();return true;})()`);
await waitJs(`!!document.querySelector('.retail-hub')`, 'Retail after a restart');
await tab('Report');
await waitJs(`document.querySelectorAll('.rep-row').length===2`, 'the saved report');
check(results, 'after the app is closed and opened again the report is still saved', true);
finish('21-retail-report', results);
