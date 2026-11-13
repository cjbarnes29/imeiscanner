// READ-ONLY analysis of emulator/phone data copies. Never touches the app, never writes next to the data.
// Usage: node scripts/dry-run-records.mjs <extracted-backup-dir (base)> <extracted-backup-dir (now)> <web-records.json> <out-dir>
// Produces masked reports (IMEIs shown as first8***last4) about (a) the empty duplicate records and (b) the web list vs the native store.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [, , baseDir, nowDir, webFile, outDir] = process.argv;
if (!baseDir || !nowDir || !webFile || !outDir) { console.error('usage: dry-run-records.mjs <base> <now> <web.json> <out>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const mask = imei => /^\d{15}$/.test(imei || '') ? `${imei.slice(0, 8)}***${imei.slice(-4)}` : (imei || '(none)');
const load = dir => JSON.parse(readFileSync(join(dir, 'files/native-scans/current.json'), 'utf8')).records;
const base = load(baseDir), now = load(nowDir), web = JSON.parse(readFileSync(webFile, 'utf8'));
const hashOf = (dir, row) => { const file = join(dir, 'files/native-scans/images', row.imageName || ''); return row.imageName && existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) : ''; };
const luhn = s => { let sum = 0; for (let i = 0; i < 15; i++) { let d = +s[14 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; };
const isImei = s => /^\d{15}$/.test(s || '');

// ---- A. empty duplicates ----------------------------------------------------------------------------------------------
// Where does each photo stand? "covered" = some record anywhere (native now, web list) with a valid IMEI came from the same photo (uri).
const coveredUris = new Set([...now, ...web].filter(r => isImei(r.imei) && r.sourceUri).map(r => r.sourceUri));
const imeiRecordsByUri = new Map();
for (const r of [...now, ...web]) if (isImei(r.imei) && r.sourceUri) imeiRecordsByUri.set(r.sourceUri, [...(imeiRecordsByUri.get(r.sourceUri) || []), r.imei]);
const empties = now.filter(r => !r.imei).map(r => ({ r, hasPicture: !!hashOf(nowDir, r), hash: hashOf(nowDir, r) }));
const coveredHashes = new Set(now.filter(r => isImei(r.imei)).map(r => hashOf(nowDir, r)).filter(Boolean));
const byPhoto = new Map();
for (const e of empties) { const key = e.r.sourceUri || e.r.name; byPhoto.set(key, [...(byPhoto.get(key) || []), e]); }
const baseEmptyIds = new Set(base.filter(r => !r.imei).map(r => r.id));
const rows = [];
for (const [key, list] of byPhoto) {
  list.sort((a, b) => a.r.createdAt < b.r.createdAt ? -1 : 1);
  const covered = coveredUris.has(key) || list.some(e => e.hash && coveredHashes.has(e.hash));
  list.forEach((e, index) => {
    let cls;
    if (!e.hasPicture) cls = 'C-orphan: no picture file';
    else if (covered) cls = 'A-superseded: the photo now has IMEI records (kept as evidence unless you approve archiving)';
    else cls = index === 0 ? 'B-keep: first record of a photo that still has no IMEI' : 'B-repeat: extra empty copy of a photo that still has no IMEI';
    rows.push({ id: e.r.id, name: e.r.name, number: e.r.number, created: e.r.createdAt, preExisting: baseEmptyIds.has(e.r.id), hash: e.hash, cls, imeisOfPhoto: (imeiRecordsByUri.get(key) || []).filter((v, i, a) => a.indexOf(v) === i).map(mask).join(' ') });
  });
}
const tally = {}; for (const row of rows) { const k = row.cls.split(':')[0]; tally[k] = (tally[k] || 0) + 1; }
const preTally = {}; for (const row of rows.filter(x => x.preExisting)) { const k = row.cls.split(':')[0]; preTally[k] = (preTally[k] || 0) + 1; }
const sameHashAcrossUris = new Map(); for (const e of empties) if (e.hash) sameHashAcrossUris.set(e.hash, new Set([...(sameHashAcrossUris.get(e.hash) || []), e.r.sourceUri]));
const crossUri = [...sameHashAcrossUris.values()].filter(s => s.size > 1).length;
writeFileSync(join(outDir, 'empty-duplicates.csv'), ['id,name,number,created,preExisting,pictureHash,class,imeisOfThisPhotoElsewhere', ...rows.map(r => [r.id, r.name, r.number, r.created, r.preExisting, r.hash, `"${r.cls}"`, `"${r.imeisOfPhoto}"`].join(','))].join('\n'));

// ---- B. web list vs native store --------------------------------------------------------------------------------------
const webIds = new Set(web.map(r => r.id));
const webBySource = new Map(); for (const r of web) if (r.sourceUri) webBySource.set(r.sourceUri, [...(webBySource.get(r.sourceUri) || []), r]);
const report = [];
let asIs = 0, replaced = 0, lost = 0, replacedBadIdentifier = 0;
for (const r of base) {
  if (webIds.has(r.id)) { asIs++; report.push({ id: r.id, name: r.name, nativeImei: mask(r.imei), state: 'A-in web list as itself', crops: '' }); continue; }
  const crops = (webBySource.get(r.sourceUri) || []).filter(x => x.id !== r.id);
  if (crops.length) {
    replaced++;
    const bad = crops.filter(c => !isImei(c.imei) || !luhn(c.imei)).length;
    if (bad) replacedBadIdentifier++;
    report.push({ id: r.id, name: r.name, nativeImei: mask(r.imei), state: 'B-replaced by crops in web list (original intact in native store)', crops: crops.map(c => `#${c.number}:${mask(c.imei)}${c.cropNeedsReview ? '(review)' : ''}`).join(' ') });
  } else { lost++; report.push({ id: r.id, name: r.name, nativeImei: mask(r.imei), state: 'C-NOT in web list, no crops found', crops: '' }); }
}
const baseImeis = base.filter(r => isImei(r.imei)).map(r => r.imei);
const imeiMissingFromWeb = baseImeis.filter(i => !web.some(w => w.imei === i || w.imei2 === i));
const webImeis = web.map(r => r.imei).filter(isImei);
const distinct = new Set(webImeis);
const nativeNowImeis = new Set(now.map(r => r.imei).filter(isImei));
const nativeNotInWeb = [...nativeNowImeis].filter(i => !web.some(w => w.imei === i || w.imei2 === i));
writeFileSync(join(outDir, 'weblist-vs-native.csv'), ['id,name,nativeImei,state,webCrops', ...report.map(r => [r.id, r.name, r.nativeImei, `"${r.state}"`, `"${r.crops}"`].join(','))].join('\n'));

const md = `# Dry-run report (read-only; nothing was changed, restored, merged or deleted)

Inputs: baseline backup (${base.length} native records), backup taken before Phase 2 (${now.length} native records), live web list dump (${web.length} records, no pictures).
All IMEIs are masked (first 8 + last 4).

## 1. The empty duplicate records (native store, ${empties.length} without IMEI now; ${baseEmptyIds.size} existed at baseline)
${Object.entries(tally).map(([k, v]) => `* class ${k}: ${v}`).join('\n')}

Of the ${baseEmptyIds.size} pre-existing ones: ${Object.entries(preTally).map(([k, v]) => `${k}: ${v}`).join(', ')}.
Distinct source photos among the empty records: ${byPhoto.size}. Pictures that are byte-identical but came from different uris: ${crossUri}.
Classes: A = the photo has since produced records with IMEIs (the empty record is redundant but is the only copy of that picture state); B = the photo still has no IMEI anywhere (one is kept, the rest are repeats); C = no picture file.
Full list: empty-duplicates.csv.

## 2. Web list vs native store (the "12 of 69" question)
* Baseline originals still in the web list as themselves: ${asIs}
* Replaced by crops in the web list (original untouched in the native store): ${replaced}${replacedBadIdentifier ? ` (${replacedBadIdentifier} of them have a crop without a checksum-valid IMEI)` : ''}
* Missing from the web list with no crops found: ${lost}
* Baseline IMEIs (${baseImeis.length}) not found anywhere in the web list: ${imeiMissingFromWeb.length}
* Current native IMEIs (${nativeNowImeis.size}) not found in the web list: ${nativeNotInWeb.length}
* Web list: ${web.length} records, ${distinct.size} distinct valid IMEIs, ${webImeis.length - distinct.size} records repeat an IMEI already listed (what the app marks as Duplicate).
Full list: weblist-vs-native.csv.
`;
writeFileSync(join(outDir, 'DRY-RUN-REPORT.md'), md);
console.log(md);
