// Data check after flow 01: every synthetic label was read correctly, duplicates were not saved twice, IMEI 2 fallback is flagged.
import { nativeStore, truth, mask, check, finish } from './lib.mjs';
const [, , device, app] = process.argv;
const store = nativeStore(device, app), results = [];
const recs = store.records, imeis = recs.map(r => r.imei).filter(Boolean);
const byName = n => recs.filter(r => r.name === n);

// single-A and dup-of-A show the same label: photos are read in parallel, so either may hold the saved record; the other is reported as a duplicate.
const A = truth['E2E-single-A.jpg'];
const aRows = recs.filter(r => r.imei === A.imei1[0]);
check(results, `IMEI ${mask(A.imei1[0])} saved exactly once across single-A / dup-of-A`, aRows.length === 1, `${aRows.length} record(s) from ${aRows.map(r => r.name).join(',')}`);
check(results, 'its model SM-A376B', aRows.some(r => (r.model || '').startsWith(A.models[0])), aRows.map(r => r.model).join(','));
const dupEntries = (store.photos || []).filter(p => /^E2E-(single-A|dup-of-A)\.jpg$/.test(p.name));
check(results, 'scan report names the duplicate (one of the two photos lists a duplicate IMEI)', dupEntries.some(p => (p.duplicates || []).length >= 1), dupEntries.map(p => `${p.name}:dup=${(p.duplicates || []).length}`).join(' '));

for (const [name, t] of Object.entries(truth)) {
  if (t.expectFlag || /single-A|dup-of-A/.test(name)) continue;
  const rows = byName(name);
  check(results, `${name}: ${t.devices} record(s)`, rows.length === t.devices, `found ${rows.length}`);
  for (const imei of t.imei1) check(results, `${name}: IMEI ${mask(imei)} read`, rows.some(r => r.imei === imei));
  for (const model of t.models) check(results, `${name}: model ${model}`, rows.some(r => (r.model || '').startsWith(model)), rows.map(r => r.model).join(','));
}
check(results, 'no duplicate IMEI among saved records', new Set(imeis).size === imeis.length, `${imeis.length} records with IMEI, ${new Set(imeis).size} distinct`);
const fbRows = byName('E2E-imei2-only.jpg');
check(results, 'IMEI-2-only photo: one record', fbRows.length === 1);
check(results, 'IMEI-2-only photo: flagged imeiFallback (never a clean IMEI 1)', fbRows.some(r => r.imeiFallback === true), fbRows.map(r => `imei=${mask(r.imei)} fallback=${r.imeiFallback}`).join(';'));
check(results, 'ledger has one entry per photo', (store.photos || []).filter(p => /^E2E-/.test(p.name)).length === Object.keys(truth).length, `${(store.photos || []).length}`);
finish('01-scan-gallery', results);
