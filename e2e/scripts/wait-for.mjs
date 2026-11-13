// Waits for a marker file written by a background run, but never forever.
//   node e2e/scripts/wait-for.mjs <done-file> [--timeout-min 90] [--pid <producer pid>] [--failed <failed-file>] [--poll-sec 15]
// Exit codes: 0 done marker found | 2 failed marker found | 3 producer process is gone without a done marker | 4 timeout
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (!file) { console.error('usage: wait-for.mjs <done-file> [--timeout-min N] [--pid PID] [--failed FILE] [--poll-sec N]'); process.exit(64); }
const timeoutMs = Number(opt('--timeout-min', 90)) * 60_000, pollMs = Number(opt('--poll-sec', 15)) * 1000;
const pid = opt('--pid') ? Number(opt('--pid')) : null, failedFile = opt('--failed', file.replace(/done(\.txt)?$/, 'failed$1'));
const alive = p => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

const t0 = Date.now();
for (;;) {
  if (existsSync(file)) { console.log(`done after ${Math.round((Date.now() - t0) / 1000)} s`); process.exit(0); }
  if (existsSync(failedFile)) { console.error(`producer reported failure: ${readFileSync(failedFile, 'utf8').trim().slice(0, 300)}`); process.exit(2); }
  if (pid && !alive(pid)) {
    // one last look: the producer may have finished just now
    if (existsSync(file)) process.exit(0);
    console.error(`producer ${pid} is gone and ${file} was never written`); process.exit(3);
  }
  if (Date.now() - t0 > timeoutMs) { console.error(`timeout after ${Math.round(timeoutMs / 60000)} min waiting for ${file}`); process.exit(4); }
  await new Promise(r => setTimeout(r, pollMs));
}
