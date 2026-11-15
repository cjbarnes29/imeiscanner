// Shared helpers for the data verification scripts. Reads the isolated test app's own data with adb run-as (debuggable build only).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The generated fixtures (git-ignored) may not exist yet (a fresh checkout, CI unit tests): then there is no truth and nothing can be staged or shared.
const truthFile = join(here, '..', 'fixtures', 'out', 'truth.json');
const truthData = existsSync(truthFile) ? JSON.parse(readFileSync(truthFile, 'utf8')) : {};
export const truth = truthData.photos || {};
/** Extra synthetic photos for single tests (EDGE-*.jpg): not part of the five-photo set. */
export const extras = truthData.extras || {};
const isFixture = name => Object.hasOwn(truth, name) || Object.hasOwn(extras, name);
export const mask = d => (d && /^\d{15}$/.test(d)) ? `${d.slice(0, 8)}***${d.slice(-4)}` : (d || '(none)');
const adbPath = () => join(process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', 'adb.exe');

// The host adb daemon sometimes drops for a moment (seen once in 36 suite runs). A connection failure means the command never ran:
// restart the server and try again (up to 3 times) instead of failing a test for an infrastructure reason.
// Safety net for real phones (anything that is not an emulator): a person's phone. Whatever a test asks for,
// - clearing another app's data (for example the system folder picker) is skipped,
// - uninstalling is refused,
// - deleting in the shared Download folder is refused (it may hold the owner's real exports).
const emulatorCache = new Map();
export function isEmulator(device) {
  if (!emulatorCache.has(device)) {
    let qemu = '';
    try { qemu = execFileSync(adbPath(), ['-s', device, 'shell', 'getprop', 'ro.kernel.qemu'], { encoding: 'utf8' }).trim(); } catch { /* unknown: treat as a phone */ }
    emulatorCache.set(device, qemu === '1' || device.startsWith('emulator-'));
  }
  return emulatorCache.get(device) && process.env.E2E_REAL_PHONE !== '1';
}
function phoneGuard(device, args) {
  if (isEmulator(device)) return 'run';
  const line = args.join(' ');
  if (/\bpm\s+clear\b/.test(line) && !/\bpm\s+clear\s+com\.imeilens\.scanner\.phonetest\b/.test(line)) return 'skip';
  if (args[0] === 'uninstall' || /\bpm\s+uninstall\b/.test(line)) throw new Error('refused on a real phone: uninstall');
  if (/\brm\b[^;|&]*\/sdcard\/Download/.test(line)) throw new Error('refused on a real phone: deleting in Download');
  return 'run';
}

export function adb(device, ...args) {
  if (phoneGuard(device, args) === 'skip') return '';
  for (let attempt = 1; ; attempt++) {
    try { return execFileSync(adbPath(), ['-s', device, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }); }
    catch (error) {
      const text = String(error.stderr || '') + String(error.message || '');
      if (attempt >= 3 || !/cannot connect to daemon|daemon still not running|daemon not running/i.test(text)) throw error;
      try { execFileSync(adbPath(), ['start-server'], { encoding: 'utf8' }); } catch { /* retry anyway */ }
    }
  }
}
export function guardApp(app) { if (app !== 'com.imeilens.scanner.phonetest') throw new Error(`refusing to read ${app}: only the isolated test app is allowed`); }

// ---- Picker-free photo input: share the synthetic photos to the test app --------------------------------------------------------
// The photos never touch shared storage (no Pictures, DCIM, Download, MediaStore, gallery). They are copied into the TEST APP'S OWN cache
// folder (run-as) and handed over as ACTION_SEND intents with a content URI of the app's own FileProvider (the same path WhatsApp or Gallery
// shares take). Only fixture files named E2E-*.jpg from e2e/fixtures/out are ever staged.
const SHARE_TMP = '/data/local/tmp/imei-lens-e2e-share'; // shell-owned scratch folder: not user storage, not indexed by the gallery
export const SYNTHETIC_NAME = /^(E2E|EDGE)-[A-Za-z0-9-]+\.jpg$/;
const fixturesDir = join(here, '..', 'fixtures', 'out');
export const shareUri = (app, name) => `content://${app}.files/shared/${name}`;

/** Real phones need an explicit opt-in (environment variable), set by the owner after the isolation was verified on the emulator. */
export function requireShareAllowed(device) {
  if (device.startsWith('emulator-') || process.env.E2E_ALLOW_SYNTHETIC_SHARE === '1') return; // the device itself, not the safe-mode switch
  throw new Error('refused on a real phone: the synthetic share test needs the owner\'s approval (E2E_ALLOW_SYNTHETIC_SHARE=1)');
}
export function stageSyntheticPhotos(device, app, names) {
  guardApp(app); requireShareAllowed(device);
  for (const name of names) {
    if (!SYNTHETIC_NAME.test(name)) throw new Error(`refusing to stage ${name}: only synthetic E2E-*.jpg fixtures are allowed`);
    if (!isFixture(name)) throw new Error(`refusing to stage ${name}: not a known synthetic fixture`);
  }
  adb(device, 'shell', `rm -rf ${SHARE_TMP}; mkdir -p ${SHARE_TMP}`);
  adb(device, 'shell', `run-as ${app} mkdir -p cache`); // a freshly cleared app has no cache folder yet
  try {
    for (const name of names) {
      adb(device, 'push', join(fixturesDir, name), `${SHARE_TMP}/${name}`);
      adb(device, 'shell', `run-as ${app} cp ${SHARE_TMP}/${name} cache/${name}`);
    }
  } finally { adb(device, 'shell', `rm -rf ${SHARE_TMP}`); }
}
/** Sends one photo to the test app only (-p), as another app would share it. */
export function sharePhoto(device, app, name) {
  guardApp(app); requireShareAllowed(device);
  if (!SYNTHETIC_NAME.test(name) || !isFixture(name)) throw new Error(`refusing to share ${name}: not a synthetic fixture`);
  return adb(device, 'shell', 'am', 'start', '-a', 'android.intent.action.SEND', '-t', 'image/jpeg', '-p', app, '--eu', 'android.intent.extra.STREAM', shareUri(app, name));
}
/** Removes the staged copies (only E2E-*.jpg in the test app's own cache folder). */
export function unstageSyntheticPhotos(device, app) {
  guardApp(app);
  adb(device, 'shell', `run-as ${app} sh -c 'rm -f cache/E2E-*.jpg cache/EDGE-*.jpg'`);
}
export function nativeStore(device, app) {
  guardApp(app);
  return JSON.parse(adb(device, 'exec-out', 'run-as', app, 'cat', 'files/native-scans/current.json'));
}
export function check(results, name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); }
export function finish(title, results) {
  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' - ' + r.detail : ''}`);
  console.log(`${title}: ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
