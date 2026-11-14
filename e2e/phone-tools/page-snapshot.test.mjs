// node --test e2e/phone-tools   (no phone needed: the logic that judges snapshots)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskDeep, diffSnapshots, diffExports, silentProblems, assess } from './page-snapshot.mjs';
import { CASES } from './cases.mjs';

const flags = (over = {}) => ({ crop: false, serial: false, model: false, imei: false, fallback: false, fallbackChecked: false, ...over });
const rec = (id, over = {}) => ({ id, name: `${id}.jpg`, source: 'gallery', createdAt: '', imei1: '49015420***7518', imei2: '', imeiShown: '49015420***7518', imeiOk: true, model: 'SM-A376B', status: 'Valid', duplicate: false, deviceCount: 0, cropped: false, fromCropOf: '', needsReview: false, note: '', ...over, flags: flags(over.flags) });
const snap = (records = [], archive = []) => ({ records, archive });

test('maskDeep masks every 15-digit run, in nested data, and leaves other numbers alone', () => {
  const out = maskDeep({ a: 'IMEI 490154203237518 ok', b: ['356938035643809', 12345678901234], c: { d: 'serial R58M1234567 and 1234567890123456' } });
  assert.equal(out.a, 'IMEI 49015420***7518 ok');
  assert.equal(out.b[0], '35693803***3809');
  assert.equal(out.b[1], 12345678901234);
  assert.equal(out.c.d, 'serial R58M1234567 and 1234567890123456'); // 16 digits: not an IMEI, untouched
  assert.ok(!JSON.stringify(out).includes('490154203237518'));
});

test('diffSnapshots finds added, removed, changed records and archive entries', () => {
  const before = snap([rec('a'), rec('b', { needsReview: true, flags: { imei: true } })], [{ id: 'x', restoredAt: '' }]);
  const after = snap([rec('b', { needsReview: false, model: 'SM-A165F' }), rec('c')], [{ id: 'x', restoredAt: '2026-11-14' }, { id: 'y', restoredAt: '' }]);
  const d = diffSnapshots(before, after);
  assert.deepEqual(d.added.map(r => r.id), ['c']);
  assert.deepEqual(d.removed.map(r => r.id), ['a']);
  assert.deepEqual(d.changed[0].changes.map(c => c.field).sort(), ['flag:imei', 'model', 'needsReview']);
  assert.deepEqual(d.archiveAdded.map(a => a.id), ['y']);
  assert.deepEqual(d.archiveRestored.map(a => a.id), ['x']);
});

test('silentProblems: wrong or incomplete AND not marked is the dangerous case', () => {
  const found = silentProblems([
    rec('ok'),
    rec('noimei', { imei1: '', imeiShown: '', imeiOk: false }),
    rec('badsum', { imeiOk: false }),
    rec('nomodel', { model: '' }),
    rec('marked-nomodel', { model: '', needsReview: true, flags: { model: true } }),
    rec('marked-bad', { imeiOk: false, needsReview: true }),
  ]);
  assert.deepEqual(found.map(f => f.id).sort(), ['badsum', 'nomodel', 'noimei'].sort());
});

test('assess scan: new products are counted, nothing new is a warning, silent problems are warned', () => {
  const none = assess('scan', diffSnapshots(snap(), snap()));
  assert.equal(none.verdict, 'attention');
  const fine = assess('scan', diffSnapshots(snap(), snap([rec('a'), rec('b', { needsReview: true })])));
  assert.equal(fine.verdict, 'ok');
  assert.match(fine.findings[0], /2 new product\(s\): 1 marked Needs review, 1 shown as fine/);
  const bad = assess('scan', diffSnapshots(snap(), snap([rec('a', { imeiOk: false })])));
  assert.equal(bad.verdict, 'attention');
  assert.ok(bad.findings.some(f => /fails the checksum but is not marked/.test(f)));
});

test('assess camera: every new product must come from the camera', () => {
  const diff = diffSnapshots(snap(), snap([rec('a', { source: 'camera', name: 'camera-1.jpg' }), rec('b')]));
  assert.equal(assess('camera', diff).verdict, 'attention');
  assert.equal(assess('camera', diffSnapshots(snap(), snap([rec('a', { source: 'camera' })]))).verdict, 'ok');
});

test('assess crop and undo use the archive', () => {
  const before = snap([rec('orig')], []);
  const afterCrop = snap([rec('c1', { source: 'crop', fromCropOf: 'orig' }), rec('c2', { source: 'crop', fromCropOf: 'orig' })], [{ id: 'orig', restoredAt: '' }]);
  const crop = assess('crop', diffSnapshots(before, afterCrop));
  assert.equal(crop.verdict, 'ok');
  assert.equal(assess('crop', diffSnapshots(before, before)).verdict, 'attention');
  const restored = snap([rec('orig')], [{ id: 'orig', restoredAt: '2026-11-14' }]);
  assert.equal(assess('undo', diffSnapshots(afterCrop, restored)).verdict, 'ok');
  assert.equal(assess('undo', diffSnapshots(afterCrop, afterCrop)).verdict, 'attention');
});

test('assess review lists what changed and notes a cleared mark', () => {
  const before = snap([rec('a', { needsReview: true, flags: { imei: true } })]);
  const after = snap([rec('a', { needsReview: false })]);
  const result = assess('review', diffSnapshots(before, after), { after });
  assert.equal(result.verdict, 'ok');
  assert.ok(result.findings.some(f => /Needs review mark was cleared/.test(f)));
  assert.equal(assess('review', diffSnapshots(before, before), { after: before }).verdict, 'attention');
});

test('assess check-all flags silent problems anywhere in the list', () => {
  assert.equal(assess('check-all', diffSnapshots(snap(), snap()), { after: snap([rec('a'), rec('b', { model: '' })]) }).verdict, 'attention');
  assert.equal(assess('check-all', diffSnapshots(snap(), snap()), { after: snap([rec('a')]) }).verdict, 'ok');
});

test('assess export: new files, an empty file is a failure, no file is a warning', () => {
  const diff = diffSnapshots(snap(), snap());
  assert.equal(assess('export', diff, { newFiles: [] }).verdict, 'attention');
  assert.equal(assess('export', diff, { newFiles: [{ path: '/sdcard/Download/imei-scanner-export.csv', name: 'imei-scanner-export.csv', size: 0 }] }).verdict, 'attention');
  assert.equal(assess('export', diff, { newFiles: [{ path: '/sdcard/Download/imei-scanner-export.csv', name: 'imei-scanner-export.csv', size: 2048 }] }).verdict, 'ok');
});

test('diffExports reports only files that are new or changed', () => {
  const old = [{ path: '/sdcard/Download/imei-a.csv', size: 10, mtime: 1 }];
  const now = [...old, { path: '/sdcard/Download/imei-b.csv', size: 20, mtime: 2 }, { path: '/sdcard/Download/imei-a.csv', size: 11, mtime: 3 }];
  assert.deepEqual(diffExports(old, now).map(f => `${f.path}:${f.size}`), ['/sdcard/Download/imei-b.csv:20', '/sdcard/Download/imei-a.csv:11']);
});

test('every case has an id, steps, an expectation and a known kind; ids are unique', () => {
  const kinds = new Set(['manual', 'scan', 'camera', 'crop', 'undo', 'review', 'check-all', 'export']);
  assert.equal(new Set(CASES.map(c => c.id)).size, CASES.length);
  for (const c of CASES) { assert.ok(c.steps.length && c.expect && c.title, c.id); assert.ok(kinds.has(c.kind), `${c.id}: ${c.kind}`); }
  for (const id of ['G1', 'G7', 'C1', 'C2', 'K1', 'K3', 'R1', 'R5', 'E1', 'E7']) assert.ok(CASES.some(c => c.id === id), id);
});
