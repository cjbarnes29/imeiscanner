// Shared helpers for the data verification scripts. Reads the isolated test app's own data with adb run-as (debuggable build only).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const truth = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'out', 'truth.json'), 'utf8')).photos;
export const mask = d => (d && /^\d{15}$/.test(d)) ? `${d.slice(0, 8)}***${d.slice(-4)}` : (d || '(none)');
const adbPath = () => join(process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', 'adb.exe');

export function adb(device, ...args) { return execFileSync(adbPath(), ['-s', device, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }); }
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
