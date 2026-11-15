// The installed test app must serve the web page that was just built (dist/). A local build once kept an old page in the APK's (git-ignored)
// assets, so page changes silently did not reach the tested app. This check fails when the APK's page differs from dist/.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ctx, js, adb, sleep, check, finish } from './helpers.mjs';

const c = ctx(), results = [];
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'assets');
const built = readdirSync(dist).filter(name => /^index-.+\.js$/.test(name));
adb(c.device, 'shell', 'monkey', '-p', c.app, '-c', 'android.intent.category.LAUNCHER', '1');
let served = null;
for (let i = 0; i < 30 && !served; i++) {
  try { served = await js(c, `[...document.scripts].map(s=>s.src).find(s=>/index-.+\\.js/.test(s)) || ''`); } catch { /* starting */ }
  if (!served) await sleep(1000);
}
check(results, 'the app page loaded', !!served);
check(results, 'the installed APK serves the current web build (dist/)', built.some(name => (served || '').endsWith(name)), `served ${String(served).split('/').pop()}, built ${built.join(', ')}`);
finish('14-build-freshness', results);
