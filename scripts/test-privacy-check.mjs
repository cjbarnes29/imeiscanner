// The CI privacy check: an unlisted checksum-valid 15-digit number fails, a listed or checksum-invalid one passes (runs in a throw-away git repo).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/check-private-data.mjs');
const dir = mkdtempSync(join(tmpdir(), 'imei-privacy-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
git('init', '-q');
mkdirSync(join(dir, 'scripts'));
copyFileSync(script, join(dir, 'scripts', 'check-private-data.mjs'));
const run = () => spawnSync('node', ['scripts/check-private-data.mjs', '--ci'], { cwd: dir, encoding: 'utf8' });

const VALID = '490154203237518';   // checksum-valid synthetic test number
const INVALID = '490154203237519'; // fails the checksum: not an IMEI
writeFileSync(join(dir, 'scripts', 'synthetic-imeis.allow'), '# none yet\n');
writeFileSync(join(dir, 'a.txt'), `value ${INVALID}\n`);
git('add', '-A');
assert.equal(run().status, 0, 'a checksum-invalid number is not flagged');

writeFileSync(join(dir, 'a.txt'), `value ${VALID}\n`);
git('add', '-A');
const bad = run();
assert.equal(bad.status, 1, 'an unlisted valid number fails the check');
assert.match(bad.stderr, /49015420\*\*\*7518/, 'the number is reported masked');
assert.ok(!bad.stderr.includes(VALID), 'the full number is never printed');

writeFileSync(join(dir, 'scripts', 'synthetic-imeis.allow'), `# allowed\n${VALID}\n`);
git('add', '-A');
assert.equal(run().status, 0, 'a listed synthetic number passes');
console.log('PASS: privacy check (CI mode): unlisted valid number fails and is masked, invalid and listed numbers pass.');
