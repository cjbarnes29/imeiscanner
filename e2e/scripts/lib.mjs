// Shared helpers for the data verification scripts. Reads the isolated test app's own data with adb run-as (debuggable build only).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const truth = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'out', 'truth.json'), 'utf8')).photos;
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
