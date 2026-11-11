// Real-photo regression check: runs the same scanner the laptop/cloud server uses
// over every photo in a folder and compares with expected.json when present.
//
//   node scripts/scan-real-photos.mjs [folder] [--write-expected]
//
// The default folder is test-photos/. It is git-ignored because label photos contain
// real IMEIs and this repository is public. expected.json maps a file name to
// { "devices": 2, "imeis": ["…"], "serials": ["…"] }. Use --write-expected once
// after checking the output by hand, then edit anything that is wrong.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createScanner } from '../server/scan.mjs';

const args = process.argv.slice(2);
const folder = args.find(arg => !arg.startsWith('--')) || 'test-photos';
const writeExpected = args.includes('--write-expected');
const files = (await readdir(folder)).filter(name => /^\.(jpe?g|png|webp)$/i.test(extname(name))).sort();
if (!files.length) { console.log(`No photos in ${folder}/. Add label photos there and run again.`); process.exit(0); }
let expected = {};
try { expected = JSON.parse(await readFile(join(folder, 'expected.json'), 'utf8')); } catch {}

const scanner = await createScanner();
const actual = {};
let failures = 0;
try {
  for (const name of files) {
    const started = Date.now();
    const rows = await scanner.scan(join(folder, name), name, 'standard');
    const imeis = rows.map(row => row.imei).filter(Boolean).sort();
    const serials = rows.map(row => row.serial).filter(Boolean).sort();
    const imei2s = rows.map(row => row.imei2).filter(Boolean).sort();
    const review = rows.filter(row => row.cropNeedsReview || !row.imei && !row.serial).length;
    actual[name] = { devices: rows.length, imeis, imei2s, serials };
    const want = expected[name];
    const problems = [];
    if (want) {
      if (want.devices !== undefined && want.devices !== rows.length) problems.push(`devices ${rows.length}, expected ${want.devices}`);
      for (const imei of want.imeis || []) if (!imeis.includes(imei)) problems.push(`missing IMEI ${imei}`);
      for (const serial of want.serials || []) if (!serials.includes(serial)) problems.push(`missing serial ${serial}`);
      for (const imei2 of want.imei2s || []) if (!imei2s.includes(imei2)) problems.push(`missing IMEI 2 ${imei2}`);
    }
    if (problems.length) failures++;
    console.log(`${problems.length ? 'FAIL' : want ? 'PASS' : 'INFO'}  ${name}  ${rows.length} record(s), ${review} need review, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`      IMEI 1: ${imeis.join(', ') || '—'}   IMEI 2: ${imei2s.join(', ') || '—'}   Serials: ${serials.join(', ') || '—'}`);
    for (const problem of problems) console.log(`      ✗ ${problem}`);
  }
} finally { await scanner.close(); }
if (writeExpected) { await writeFile(join(folder, 'expected.json'), JSON.stringify(actual, null, 2)); console.log(`Wrote ${folder}/expected.json — check it by hand.`); }
if (failures) { console.log(`${failures} photo(s) did not match expected.json.`); process.exitCode = 1; }
