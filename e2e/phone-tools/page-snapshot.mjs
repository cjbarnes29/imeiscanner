// Reads the TEST app's records, archive and export files, masked, for the phone checklist (checklist-server.mjs).
//   * Records and archive come from the app's own page (IndexedDB, through the WebView DevTools socket): camera photos, crops and review
//     changes live there, not in the native scan file. IMEIs are masked INSIDE the page (first 8 + last 4): a full IMEI never leaves the phone.
//   * Photos, crops (image data) and OCR text are never read. Only the fields below.
//   * Export files: names, sizes and times of new export-looking files (imei / export in the name) in Download and Documents. Never contents.
// Only com.imeilens.scanner.phonetest is ever touched (guardApp).
import { adb, guardApp } from '../scripts/lib.mjs';
import { evaluate } from '../scripts/cdp-state.mjs';

/** Runs INSIDE the page. Returns masked records and archive entries only (no images, no OCR text, no full numbers). */
async function pageCollect() {
  const db = await new Promise((resolve, reject) => { const q = indexedDB.open('imei-lens-v2', 1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  if (!db.objectStoreNames.contains('inventory')) { db.close(); return { records: [], archive: [] }; }
  const get = prefix => new Promise((resolve, reject) => {
    const q = db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound(prefix, prefix + '￿'));
    q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
  });
  const rec = await get('record:'), arc = await get('archive:');
  db.close();
  const luhn = s => { if (!/^\d{15}$/.test(s || '')) return false; let t = 0; for (let i = 0; i < 15; i++) { let d = +s[14 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; } return t % 10 === 0; };
  const mask = d => /^\d{15}$/.test(d || '') ? d.slice(0, 8) + '***' + d.slice(-4) : (d ? 'unreadable' : '');
  const row = r => {
    const imei2 = r.imei2 || '';
    const fallback = !!r.imei && !r.imeiFallbackChecked && (r.imeiFallback === true || (!!imei2 && r.imei === imei2));
    const serialOnly = !r.imei && !!r.serial;
    const needsReview = !!(r.cropNeedsReview || r.serialNeedsReview || r.modelNeedsReview || r.imeiNeedsReview || fallback || (!serialOnly && r.status !== 'Valid'));
    return {
      id: r.id, name: r.name || '', source: /^camera-/.test(r.name || '') ? 'camera' : r.sourceRecordId ? 'crop' : 'gallery', createdAt: r.createdAt || '',
      imei1: fallback ? '' : mask(r.imei), imei2: mask(imei2), imeiShown: mask(r.imei), imeiOk: luhn(r.imei), model: r.model || '', status: r.status || '',
      duplicate: !!r.duplicate, deviceCount: r.deviceCount || 0, cropped: !!r.cropDataUrl, fromCropOf: r.sourceRecordId || '',
      flags: { crop: !!r.cropNeedsReview, serial: !!r.serialNeedsReview, model: !!r.modelNeedsReview, imei: !!r.imeiNeedsReview, fallback, fallbackChecked: !!r.imeiFallbackChecked },
      needsReview, note: [r.imeiNeedsReview && r.imeiNote, r.modelNeedsReview && r.modelNote].filter(Boolean).join(' '),
    };
  };
  return {
    records: rec.map(row),
    archive: arc.map(a => ({ id: a.id, name: (a.record && a.record.name) || '', reason: a.reason || '', archivedAt: a.archivedAt || '', restoredAt: a.restoredAt || '', crops: (a.cropIds || []).length, duplicateOf: !!a.duplicateOf })),
  };
}

/** Second line of defence on the computer: any 15-digit run in any string is masked again before it is stored, shown or written. */
export function maskDeep(value) {
  if (typeof value === 'string') return value.replace(/(?<!\d)(\d{8})\d{3}(\d{4})(?!\d)/g, '$1***$2');
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  return value;
}

let queue = Promise.resolve(); // the DevTools forward uses one local port: calls run one at a time
export function snapshot(device, app) {
  guardApp(app);
  const run = queue.then(async () => {
    const data = await evaluate(device, app, `(${pageCollect.toString()})()`);
    if (!data || !Array.isArray(data.records)) throw new Error('The test app did not answer. Open IMEI Lens Test on the phone (not the real app) and try again.');
    return { takenAt: new Date().toISOString(), ...maskDeep(data) };
  });
  queue = run.catch(() => {});
  return run;
}

// ---- export files (names, sizes, times) ---------------------------------------------------------------------------------------------
const EXPORT_NAME = /imei|export/i;
export function exportListing(device) {
  // maxdepth 3: Download/<file>, Documents/<folder>/<file>, Documents/<folder>/<sub>/<file>. Metadata only (stat), contents are never opened.
  const out = adb(device, 'shell', `find /sdcard/Download /sdcard/Documents -maxdepth 3 -type f 2>/dev/null | while read f; do stat -c '%n|%s|%Y' "$f"; done`);
  return maskDeep(out.split(/\r?\n/).filter(Boolean).map(line => {
    const [path, size, mtime] = line.split('|');
    return { path, name: path.split('/').pop(), size: +size, mtime: +mtime };
  }).filter(f => EXPORT_NAME.test(f.name) || EXPORT_NAME.test(f.path)));
}

// ---- comparing two snapshots ----------------------------------------------------------------------------------------------------------
const TRACKED = ['imei1', 'imei2', 'model', 'status', 'needsReview', 'duplicate', 'deviceCount', 'cropped'];
export function diffSnapshots(before, after) {
  const was = new Map(before.records.map(r => [r.id, r])), now = new Map(after.records.map(r => [r.id, r]));
  const changed = [];
  for (const [id, r] of now) {
    const old = was.get(id);
    if (!old) continue;
    const changes = [];
    for (const field of TRACKED) if (old[field] !== r[field]) changes.push({ field, from: old[field], to: r[field] });
    for (const flag of Object.keys(r.flags)) if (old.flags[flag] !== r.flags[flag]) changes.push({ field: `flag:${flag}`, from: old.flags[flag], to: r.flags[flag] });
    if (changes.length) changed.push({ id, name: r.name, changes });
  }
  const oldArc = new Map(before.archive.map(a => [a.id, a]));
  return {
    added: after.records.filter(r => !was.has(r.id)),
    removed: before.records.filter(r => !now.has(r.id)),
    changed,
    archiveAdded: after.archive.filter(a => !oldArc.has(a.id)),
    archiveRestored: after.archive.filter(a => a.restoredAt && oldArc.has(a.id) && !oldArc.get(a.id).restoredAt),
  };
}
export function diffExports(before, after) {
  const known = new Set(before.map(f => `${f.path}|${f.size}|${f.mtime}`));
  return after.filter(f => !known.has(`${f.path}|${f.size}|${f.mtime}`));
}

// ---- what the computer can tell without a person: "silent" problems ----------------------------------------------------------------------
/** A record that is wrong or incomplete but NOT marked for review: the dangerous kind (the person would trust it). */
export function silentProblems(records) {
  const found = [];
  for (const r of records) {
    if (r.needsReview) continue;
    if (!r.imei1 && !r.imei2) found.push({ id: r.id, name: r.name, what: 'no IMEI and not marked for review' });
    else if (r.imei1 && !r.imeiOk) found.push({ id: r.id, name: r.name, what: 'IMEI 1 fails the checksum but is not marked for review' });
    if (!r.model && !r.flags.model) found.push({ id: r.id, name: r.name, what: 'no model code and not marked for review' });
  }
  return found;
}

/** Advice for one checklist case (kind comes from cases.mjs). The person's own tap still decides pass or fail. */
export function assess(kind, diff, ctx = {}) {
  const findings = [];
  let attention = false;
  const flag = text => { attention = true; findings.push(`CHECK: ${text}`); };
  const info = text => findings.push(text);
  const silent = silentProblems([...diff.added, ...diff.changed.map(c => ctx.after?.records.find(r => r.id === c.id)).filter(Boolean)]);
  if (kind === 'scan' || kind === 'camera') {
    if (!diff.added.length) flag('no new product was found since you pressed Start. Did the scan finish ("photos scanned · completed")?');
    else info(`${diff.added.length} new product(s): ${diff.added.filter(r => r.needsReview).length} marked Needs review, ${diff.added.filter(r => !r.needsReview).length} shown as fine.`);
    if (kind === 'camera' && diff.added.some(r => r.source !== 'camera')) flag('some new products did not come from the in-app camera.');
    for (const r of diff.added) if (r.duplicate) info(`${r.name}: marked as duplicate IMEI.`);
  } else if (kind === 'crop') {
    if (!diff.archiveAdded.length) flag('no original was archived. Did you save the crop?');
    if (!diff.added.length) flag('no new crop product appeared.'); else info(`${diff.added.length} crop product(s) now; the original is kept in the archive (${diff.archiveAdded.length}).`);
    if (diff.added.some(r => !r.fromCropOf)) info('some new products are not linked to an original photo.');
  } else if (kind === 'undo') {
    if (!diff.archiveRestored.length) flag('no archived original was restored.'); else info(`${diff.archiveRestored.length} original(s) restored; ${diff.removed.length} crop product(s) taken out (kept in the archive).`);
  } else if (kind === 'review') {
    if (!diff.changed.length) flag('no product changed since you pressed Start.');
    for (const c of diff.changed) {
      const desc = c.changes.map(x => `${x.field}: ${x.from === '' ? '(empty)' : x.from} -> ${x.to === '' ? '(empty)' : x.to}`).join('; ');
      info(`${c.name}: ${desc}`);
      const imeiChanged = c.changes.some(x => x.field === 'imei1');
      const cleared = c.changes.some(x => x.field === 'needsReview' && x.from === true && x.to === false);
      if (cleared && !imeiChanged && !c.changes.some(x => x.field === 'flag:model')) info('  (the Needs review mark was cleared: right only if you compared it with the label and saved)');
    }
  } else if (kind === 'check-all') {
    const all = silentProblems(ctx.after?.records || []);
    if (all.length) all.forEach(p => flag(`${p.name}: ${p.what}`));
    else info(`${(ctx.after?.records || []).length} product(s): none is wrong or incomplete without a mark.`);
    return { verdict: attention ? 'attention' : 'ok', findings };
  } else if (kind === 'export') {
    const files = ctx.newFiles || [];
    if (!files.length) flag('no new export file was found in Download or Documents.');
    for (const f of files) { if (f.size === 0) flag(`${f.name} is EMPTY (0 bytes).`); else info(`${f.path} (${f.size} bytes)`); }
  }
  for (const p of silent) flag(`${p.name}: ${p.what}`);
  return { verdict: attention ? 'attention' : 'ok', findings };
}
