// Guard to run before any commit: node scripts/check-private-data.mjs   (npm run check:private)
// 1. The private folders (real label photos, backups, evidence) must be ignored by Git and not tracked.
// 2. No file that Git would newly add (modified or untracked, not ignored) may contain a real IMEI.
// 3. Real IMEIs that are ALREADY committed in unchanged files are reported as a warning (they need a separate decision).
// "Real" = any 15-digit number found in the local private data (test-photos and the phase*-results folders).
// Exit code 1 when something new would leak. IMEIs are never printed in full.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PRIVATE = ['test-photos', 'phase1-results', 'phase2-results'];
const sh = command => execSync(command, { encoding: 'utf8', maxBuffer: 1 << 28 });
const lines = text => text.split('\n').filter(Boolean);
const number = /(?<![0-9])[0-9]{15}(?![0-9])/g;
let failed = false;

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
    if (changed.has(file)) { hits++; console.error(`REAL IMEI in ${file} (would be committed): ${match[0].slice(0, 8)}***${match[0].slice(-4)}`); }
    else { committed++; committedFiles.set(file, (committedFiles.get(file) || 0) + 1); }
  }
}
console.log(`${real.size} private numbers known, ${files.length} files checked, ${hits} hit(s) in files that would be committed.`);
if (committed) console.warn(`WARNING: ${committed} real IMEI occurrence(s) are ALREADY committed in unchanged files: ${[...committedFiles].map(([f, n]) => `${f} (${n})`).join(', ')}. Removing them from Git history is a separate, explicit decision.`);
if (hits) failed = true;
if (failed) { console.error('FAILED: do not commit until this is fixed.'); process.exit(1); }
console.log('OK: private folders are ignored and nothing new with a real IMEI would be committed.');
