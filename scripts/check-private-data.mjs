// Guard against real device data in Git.
//   node scripts/check-private-data.mjs         local check (needs the private folders): npm run check:private
//   node scripts/check-private-data.mjs --ci    CI check (no private data on the runner): npm run check:private:ci
//
// Local mode:
//   1. The private folders (real label photos, backups, evidence) must be ignored by Git and not tracked.
//   2. No file that Git would newly add (modified or untracked, not ignored) may contain a real IMEI.
//   3. Real IMEIs that are ALREADY committed in unchanged files are reported as a warning (they need a separate decision).
//   "Real" = any 15-digit number found in the local private data (test-photos and the phase*-results folders).
// CI mode (works without the private data):
//   Every checksum-valid 15-digit number in a tracked text file must be listed in scripts/synthetic-imeis.allow
//   (one per line). A new test value therefore has to be added on purpose, and a real IMEI cannot slip in unnoticed.
// Exit code 1 when something new would leak. IMEIs are never printed in full.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CI = process.argv.includes('--ci');
const PRIVATE = ['test-photos', 'phase1-results', 'phase2-results'];
const sh = command => execSync(command, { encoding: 'utf8', maxBuffer: 1 << 28 });
const lines = text => text.split('\n').filter(Boolean);
const number = /(?<![0-9])[0-9]{15}(?![0-9])/g;
const luhn = value => { let sum = 0; for (let i = 0; i < 15; i++) { let n = +value[14 - i]; if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; };
const textFile = file => /\.(ts|tsx|js|mjs|cjs|java|kt|md|json|yml|yaml|csv|txt|xml|gradle|ps1|html|css)$/i.test(file);
const mask = value => `${value.slice(0, 8)}***${value.slice(-4)}`;
let failed = false;

if (CI) {
  const allow = new Set(readFileSync('scripts/synthetic-imeis.allow', 'utf8').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean));
  const files = lines(sh('git ls-files')).filter(file => existsSync(file) && statSync(file).isFile() && textFile(file) && statSync(file).size < 8 << 20 && file !== 'scripts/synthetic-imeis.allow' && !file.startsWith('package-lock'));
  let unknown = 0;
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(number)) {
      if (luhn(match[0]) && !allow.has(match[0])) { unknown++; console.error(`UNLISTED checksum-valid 15-digit number in ${file}: ${mask(match[0])} (real IMEI? if synthetic, add it to scripts/synthetic-imeis.allow)`); }
    }
  }
  console.log(`CI check: ${files.length} tracked files, ${allow.size} allowed synthetic numbers, ${unknown} unlisted.`);
  if (unknown) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
  process.exit(0);
}

for (const folder of PRIVATE) {
  if (!existsSync(folder)) continue;
  try { sh(`git check-ignore -q ${folder}`); } catch { console.error(`NOT IGNORED: ${folder}/ holds private data and must be in .gitignore`); failed = true; }
  if (sh(`git ls-files ${folder}`).trim()) { console.error(`TRACKED: files under ${folder}/ are already tracked by Git`); failed = true; }
}

const real = new Set();
const collect = path => {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) { for (const name of readdirSync(path)) collect(join(path, name)); return; }
  if (!/\.(json|txt|csv|md)$/i.test(path) || statSync(path).size > 20 << 20) return;
  for (const match of readFileSync(path, 'utf8').matchAll(number)) real.add(match[0]);
};
for (const folder of PRIVATE) collect(folder);

const changed = new Set(lines(sh('git ls-files -m -o --exclude-standard')));
const files = [...new Set([...lines(sh('git ls-files')), ...changed])].filter(file => existsSync(file) && statSync(file).isFile());
let hits = 0, committed = 0;
const committedFiles = new Map();
for (const file of files) {
  if (statSync(file).size > 8 << 20) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const match of text.matchAll(number)) {
    if (!real.has(match[0])) continue;
    if (changed.has(file)) { hits++; console.error(`REAL IMEI in ${file} (would be committed): ${mask(match[0])}`); }
    else { committed++; committedFiles.set(file, (committedFiles.get(file) || 0) + 1); }
  }
}
console.log(`${real.size} private numbers known, ${files.length} files checked, ${hits} hit(s) in files that would be committed.`);
if (committed) console.warn(`WARNING: ${committed} real IMEI occurrence(s) are ALREADY committed in unchanged files: ${[...committedFiles].map(([f, n]) => `${f} (${n})`).join(', ')}. Removing them from Git history is a separate, explicit decision.`);
if (hits) failed = true;
if (failed) { console.error('FAILED: do not commit until this is fixed.'); process.exit(1); }
console.log('OK: private folders are ignored and nothing new with a real IMEI would be committed.');
