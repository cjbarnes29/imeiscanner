// Duplicates: a second record with an existing IMEI is flagged; "Archive duplicates" archives (never deletes), Undo restores.
import { ctx, scanAll, clickText, waitForText, js, webState, sleep, check, finish } from './helpers.mjs';
import { truth } from '../scripts/lib.mjs';

const c = ctx(), results = [];
await scanAll(c);
const imeiA = truth['E2E-single-A.jpg'].imei1[0];
await clickText(c, '^Records');
await sleep(800);
// Give record B the IMEI of record A through its IMEI field (what a person can do by editing): this creates a duplicate.
const imeiB = truth['E2E-single-B.jpg'].imei1[0];
const set = await js(c, `(()=>{const inp=[...document.querySelectorAll('input')].find(i=>i.value===${JSON.stringify(imeiB)});if(!inp)return 'no field';const st=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;st.call(inp,${JSON.stringify(imeiA)});inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));inp.dispatchEvent(new Event('blur',{bubbles:true}));return 'set'})()`);
check(results, 'IMEI field of record B found and edited', set === 'set', set);
await sleep(1500);
const dup = await webState(c.device, c.app);
check(results, 'the two records with the same IMEI are flagged as duplicates', dup.duplicates >= 2, `duplicates=${dup.duplicates}`);
check(results, 'Archive duplicates button is offered', await waitForText(c, 'Archive duplicates', 8000));
await clickText(c, '^Archive duplicates');
check(results, 'confirmation says nothing is deleted', await waitForText(c, 'Nothing is deleted', 8000));
await clickText(c, '^Archive 1 duplicate', { within: "document.querySelector('[role=alertdialog]')" });
await sleep(2500);
const archived = await webState(c.device, c.app);
check(results, 'duplicate archived (record count -1)', archived.records === dup.records - 1, `${dup.records} -> ${archived.records}`);
check(results, 'archive entry reason duplicate-removal links to the kept record', archived.archive.some(a => a.reason === 'duplicate-removal' && a.duplicateOf));
check(results, 'the IMEI is still in the list once', archived.imeis.filter(i => i === imeiA).length === 1);
check(results, 'Undo is offered', await waitForText(c, 'Undo', 5000));
await clickText(c, '^Undo$');
await sleep(2500);
const undone = await webState(c.device, c.app);
check(results, 'Undo brings the duplicate back', undone.records === dup.records, `${undone.records} vs ${dup.records}`);
check(results, 'archive entry marked restored', undone.archive.some(a => a.reason === 'duplicate-removal' && a.restored));
finish('05-duplicates-archive-undo', results);
