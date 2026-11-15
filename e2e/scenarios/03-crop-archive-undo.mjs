// Crop Studio: two boxes on photo B -> two crops, the original is ARCHIVED (not deleted), crops link to it, Undo brings the original back.
import { ctx, scanAll, openStudioAndDrawTwoBoxes, saveAndArchive, clickText, waitForText, webState, sleep, check, finish } from './helpers.mjs';

const c = ctx(), results = [];
await scanAll(c);
const before = await webState(c.device, c.app);
await openStudioAndDrawTwoBoxes(c);
await saveAndArchive(c);
const split = await webState(c.device, c.app);
check(results, 'original B archived, not deleted', split.archive.some(a => a.name === 'E2E-single-B.jpg' && !a.restored), JSON.stringify(split.archive));
check(results, 'two crops created from B', split.names.filter(n => n === 'E2E-single-B.jpg').length === 2, `${split.names.filter(n => n === 'E2E-single-B.jpg').length}`);
check(results, 'record count = before - 1 original + 2 crops', split.records === before.records + 1, `${before.records} -> ${split.records}`);
check(results, 'Undo bar is offered', await waitForText(c, 'Undo', 5000));
await clickText(c, '^Undo$');
await sleep(2500);
const undone = await webState(c.device, c.app);
check(results, 'Undo restores the original (record count back)', undone.records === before.records, `${undone.records} vs ${before.records}`);
const entry = undone.archive.find(a => a.name === 'E2E-single-B.jpg');
check(results, 'archive entry marked restored and keeps the 2 crops', !!entry && entry.restored && entry.removedCrops === 2, JSON.stringify(entry));
check(results, 'no IMEI lost by split + Undo', before.imeis.filter(Boolean).every(i => undone.imeis.includes(i)));
finish('03-crop-archive-undo', results);
