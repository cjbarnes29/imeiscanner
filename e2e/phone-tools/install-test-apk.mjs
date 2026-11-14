// Safe, in-place update of IMEI Lens Test ONLY.
//   node e2e/phone-tools/install-test-apk.mjs --device <serial> --apk <file> [--sha256 <expected>] [--dry-run]
// Refuses unless ALL hold: the file's SHA-256 matches (when given or a .sha256 file sits next to it); the package id is
// com.imeilens.scanner.phonetest; it is signed (apksigner verify) and, when the app is already installed, its signer equals the installed one
// (a different signer would force an uninstall = data loss: never done). Uses `adb install -r` only: no -d, no uninstall, no pm clear,
// no other package touched. The production app (com.imeilens.scanner) is never read or changed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'com.imeilens.scanner.phonetest';
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const stop = m => { console.error(`\nSTOP: ${m}\n`); process.exit(2); };
const sdk = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adbExe = join(sdk, 'platform-tools', 'adb.exe');
const device = opt('--device'), apk = opt('--apk');
if (!device || !apk || !existsSync(apk)) stop('usage: --device <serial> --apk <file> [--sha256 <hex>] [--dry-run]');
const jdks = join(process.env.USERPROFILE || '', '.jdks');
const JAVA = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java.exe') : existsSync(jdks) ? join(jdks, readdirSync(jdks).filter(d => /^temurin-/.test(d)).sort().pop() || '', 'bin', 'java.exe') : 'java';
const run = (file, a, o = {}) => execFileSync(file, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });

const sha = createHash('sha256').update(readFileSync(apk)).digest('hex');
let expected = opt('--sha256');
if (!expected && existsSync(apk + '.sha256')) expected = readFileSync(apk + '.sha256', 'utf8').trim().split(/\s+/)[0];
if (!expected) stop('no expected SHA-256 (pass --sha256 or keep the .sha256 file next to the APK).');
if (sha.toLowerCase() !== expected.toLowerCase()) stop(`checksum mismatch: file ${sha}, expected ${expected}`);
console.log(`checksum OK  ${sha}`);

const bt = join(sdk, 'build-tools'), ver = existsSync(bt) ? readdirSync(bt).sort().pop() : null;
if (!ver) stop('Android build-tools not found (needed for aapt and apksigner).');
const aapt = join(bt, ver, 'aapt.exe'), signer = join(bt, ver, 'lib', 'apksigner.jar');
const badging = run(aapt, ['dump', 'badging', apk]);
const pkg = (badging.match(/package: name='([^']+)'/) || [])[1];
if (pkg !== APP) stop(`package id is ${pkg}, not ${APP}`);
console.log(`package OK   ${pkg} (${(badging.match(/versionName='([^']+)'/) || [])[1]})`);
const certs = run(JAVA, ['-jar', signer, 'verify', '--print-certs', apk]);
const newCert = (certs.match(/Signer #1 certificate SHA-256 digest: (\w+)/) || [])[1];
if (!newCert) stop('the APK is not validly signed.');
console.log(`signature OK ${newCert.slice(0, 16)}…`);

if (!run(adbExe, ['devices']).split(/\r?\n/).some(l => l.startsWith(device + '\t') && /\tdevice$/.test(l))) stop(`${device} is not connected.`);
const adb = (...a) => run(adbExe, ['-s', device, ...a]);
const installed = adb('shell', 'pm', 'list', 'packages').includes(`package:${APP}`);
if (installed) {
  // Signer of the installed copy: a mismatch would make Android refuse the update and tempt an uninstall (data loss).
  const dump = adb('shell', 'dumpsys', 'package', APP);
  const have = (dump.match(/signatures=\[([0-9a-f]+)/i) || dump.match(/Signing\s+certificates?[\s\S]*?\[([0-9a-f]{8,})\]/i) || [])[1];
  console.log(`installed copy found (signer id ${have || 'unknown'}); update in place keeps its data`);
  const oldPath = adb('shell', 'pm', 'path', APP).trim().replace(/^package:/, '').split(/\r?\n/)[0];
  const tmp = join(process.env.TEMP || '.', 'installed-test-app.apk');
  run(adbExe, ['-s', device, 'pull', oldPath, tmp]);
  const oldCert = (run(JAVA, ['-jar', signer, 'verify', '--print-certs', tmp]).match(/Signer #1 certificate SHA-256 digest: (\w+)/) || [])[1];
  if (oldCert !== newCert) stop('the installed copy is signed with a different key: an update would need an uninstall (data loss). Not doing that; ask the owner.');
  console.log('signer equals the installed copy: OK');
} else console.log('IMEI Lens Test is not installed yet: a fresh install (no data to lose).');
if (args.includes('--dry-run')) { console.log('\nDRY RUN: nothing installed.'); process.exit(0); }
console.log(adb('install', '-r', apk).trim());
console.log(`installed. Package list still has the production app untouched: ${adb('shell', 'pm', 'list', 'packages').includes('package:com.imeilens.scanner\r') || adb('shell', 'pm', 'list', 'packages').includes('package:com.imeilens.scanner\n') ? 'yes (not touched)' : 'not installed on this device'}`);
