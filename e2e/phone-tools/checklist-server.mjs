// Digital phone-test checklist for IMEI Lens Test. Runs on the computer; the phone opens it in its browser over the ADB cable/Wi-Fi link
// (adb reverse), so nothing is printed and nothing goes to the internet.
//
//   node e2e/phone-tools/checklist-server.mjs --device 192.168.1.232:38579
//   then on the phone, in Chrome:  http://localhost:8787/?t=<code printed here>
//
// For each test case the page has: Start (takes a masked baseline of the test app), you do the steps on the phone, Check (the computer compares
// the test app's records / archive / new export files with the baseline and says what changed), then you tick each new product "matches the label"
// or "wrong", and Pass / Fail. Everything is saved on the computer in e2e/reports/phone-checklist/<time>/ (RESULTS.json, FAILURES.csv, SUMMARY.md).
//
// Safety: reads only com.imeilens.scanner.phonetest, only its records/archive (masked in the page) and the NAMES/SIZES of export files. Never
// photos, never contents of Downloads or the gallery, never writes to the phone. Listens on 127.0.0.1 only, needs the random code, and refuses
// requests for any other host name. Full IMEIs are never shown, stored or written (masked as first 8 + last 4, and masked again here).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { adb, guardApp } from '../scripts/lib.mjs';
import { CASES } from './cases.mjs';
import { snapshot, exportListing, diffSnapshots, diffExports, assess, maskDeep } from './page-snapshot.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'com.imeilens.scanner.phonetest';
guardApp(APP);
process.env.E2E_REAL_PHONE = '1'; // the real-phone safety net in lib.mjs (no uninstall, no deleting in Download, no clearing other apps)

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const port = +(opt('--port') || 8787);
const allowEmulator = args.includes('--allow-emulator');
const expectLabel = opt('--build-label') || '';
const fail = message => { console.error(`\nSTOP: ${message}\n`); process.exit(2); };

// ---- which device -------------------------------------------------------------------------------------------------------------------
const adbExe = join(process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', 'adb.exe');
const listed = execFileSync(adbExe, ['devices'], { encoding: 'utf8' }).split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/)).filter(p => p[0] && p[1] === 'device').map(p => p[0]);
let candidates = allowEmulator ? listed : listed.filter(s => !s.startsWith('emulator-'));
// A wireless phone can be listed twice (mDNS name and ip:port): both are the same phone; prefer the ip:port form.
if (candidates.length === 2 && candidates.some(s => s.includes('_adb-tls-connect'))) candidates = candidates.filter(s => !s.includes('_adb-tls-connect'));
const device = opt('--device') || (candidates.length === 1 ? candidates[0] : null);
if (!device) fail(candidates.length ? `More than one device (${candidates.join(', ')}). Run again with --device <one of them>.` : 'No phone found. Connect it (USB or Wireless debugging) and run again.');
if (!listed.includes(device)) fail(`${device} is not connected.`);
if (device.startsWith('emulator-') && !allowEmulator) fail('This is for the real phone. (Add --allow-emulator only to test the tool.)');
if (!adb(device, 'shell', 'pm', 'list', 'packages').includes(`package:${APP}`)) fail('IMEI Lens Test is not installed on this phone.');

// ---- state --------------------------------------------------------------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = opt('--out') || join(here, '..', 'reports', 'phone-checklist', stamp);
mkdirSync(outDir, { recursive: true });
const token = randomBytes(9).toString('base64url');
const answers = {};   // caseId -> { result, note, products: {recordId: 'ok'|'wrong'}, auto, checkedAt }
const baselines = {}; // caseId -> { snap, exports, at }
const lastCheck = {}; // caseId -> { diff, auto, products }
const save = () => { writeFileSync(join(outDir, 'RESULTS.json'), JSON.stringify(maskDeep({ device, app: APP, stamp, answers }), null, 2)); writeReports(); };
const caseById = id => CASES.find(c => c.id === id);

function writeReports() {
  const rows = [['failure_id', 'case', 'photo_reference', 'what', 'expected', 'actual_masked', 'app_flagged_it', 'severity', 'steps_to_reproduce', 'note'].join(',')];
  const csv = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  let n = 0;
  for (const c of CASES) {
    const a = answers[c.id], lc = lastCheck[c.id];
    if (!a) continue;
    const steps = c.steps.join(' > ');
    const describe = r => `${r.flags.fallback ? `IMEI 1 not read (the app shows IMEI 2 ${r.imeiShown})` : `IMEI 1 ${r.imei1 || '(none)'}${r.imei2 ? ' · IMEI 2 ' + r.imei2 : ''}`} · model ${r.model || '(none)'} · ${r.needsReview ? 'marked Needs review' : 'shown as fine'}${r.note ? ' · ' + r.note : ''}`;
    const reference = r => r.source === 'camera' ? `${r.name} (in-app camera ${r.createdAt}; reference photo = your Camera-app photo taken just before)` : `${r.name}${r.fromCropOf ? ' (crop)' : ''}`;
    for (const [id, verdict] of Object.entries(a.products || {})) {
      if (verdict !== 'wrong') continue;
      const r = (lc?.products || []).find(p => p.id === id); if (!r) continue;
      rows.push([`${c.id}#${++n}`, c.id, reference(r), 'product does not match the label', c.expect, describe(r), r.needsReview ? 'yes' : 'NO (silent)', r.needsReview ? 'review' : 'failure', steps, a.note].map(csv).join(','));
    }
    if (a.result === 'fail' && !Object.values(a.products || {}).includes('wrong')) rows.push([`${c.id}#${++n}`, c.id, '(see note)', 'test case failed', c.expect, a.note || '(no note)', '', 'failure', steps, ''].map(csv).join(','));
    for (const f of (a.auto?.findings || []).filter(f => f.startsWith('CHECK:'))) rows.push([`${c.id}#${++n}`, c.id, '(computer check)', 'automatic check', c.expect, f.slice(6).trim(), 'n/a', 'check', steps, ''].map(csv).join(','));
  }
  writeFileSync(join(outDir, 'FAILURES.csv'), rows.join('\n') + '\n');
  const count = r => Object.values(answers).filter(a => a.result === r).length;
  const lines = ['# IMEI Lens Test: phone checklist results (masked)', '', `Phone: ${device} · test app ${APP} · ${new Date().toISOString()}`, '',
    `Answered ${Object.keys(answers).length} of ${CASES.length} cases: ${count('pass')} pass · ${count('fail')} fail · ${count('skip')} skipped.`,
    `Problems in FAILURES.csv: ${rows.length - 1} (rows marked "NO (silent)" are the dangerous ones: wrong or incomplete and not flagged by the app).`, '',
    '| Case | Result | Computer check | Note |', '|---|---|---|---|'];
  for (const c of CASES) { const a = answers[c.id]; if (a) lines.push(`| ${c.id} ${c.title} | ${a.result} | ${a.auto?.verdict || ''} | ${(a.note || '').replace(/\|/g, '/')} |`); }
  lines.push('', 'Not answered: ' + (CASES.filter(c => !answers[c.id]).map(c => c.id).join(', ') || 'none'), '', 'Camera, crop and review results are read from the app page; export results are file names and sizes only.');
  writeFileSync(join(outDir, 'SUMMARY.md'), lines.join('\n') + '\n');
}

// ---- device status ------------------------------------------------------------------------------------------------------------------
function status() {
  let running = false, apk = '';
  try { running = !!adb(device, 'shell', 'pidof', APP).trim(); } catch { /* not running */ }
  try {
    const path = adb(device, 'shell', 'pm', 'path', APP).trim().replace(/^package:/, '').split(/\r?\n/)[0];
    apk = adb(device, 'shell', 'sha256sum', path).split(/\s+/)[0].slice(0, 12); // the test app's own APK file, not user data
  } catch { /* unknown */ }
  return { device, app: APP, appRunning: running, apkSha: apk, expectLabel };
}

// ---- API ----------------------------------------------------------------------------------------------------------------------------
async function handle(method, path, body) {
  if (method === 'GET' && path === '/api/state') return { cases: CASES, answers, started: Object.keys(baselines), status: status(), outDir: outDir.split(/[\\/]/).slice(-3).join('/') };
  if (method === 'GET' && path === '/api/status') return status();
  if (method === 'POST' && path === '/api/start') {
    const c = caseById(body.id); if (!c) throw new Error('unknown case');
    if (['manual'].includes(c.kind)) { baselines[c.id] = { at: Date.now() }; return { ok: true, manual: true }; }
    baselines[c.id] = { snap: await snapshot(device, APP), exports: c.kind === 'export' ? exportListing(device) : [], at: Date.now() };
    return { ok: true, records: baselines[c.id].snap.records.length };
  }
  if (method === 'POST' && path === '/api/check') {
    const c = caseById(body.id); if (!c) throw new Error('unknown case');
    const base = baselines[c.id];
    if (!base && c.kind !== 'check-all') throw new Error('Press Start first, then do the steps, then Check.');
    const after = await snapshot(device, APP);
    const diff = diffSnapshots(base?.snap || { records: [], archive: [] }, after);
    const newFiles = c.kind === 'export' ? diffExports(base.exports, exportListing(device)) : [];
    const auto = assess(c.kind, diff, { after, newFiles });
    const products = c.products ? diff.added : [];
    lastCheck[c.id] = { diff, auto, products };
    answers[c.id] = { ...(answers[c.id] || {}), auto, checkedAt: new Date().toISOString() };
    save();
    return maskDeep({ auto, products, changed: diff.changed, archiveAdded: diff.archiveAdded, newFiles, total: after.records.length });
  }
  if (method === 'POST' && path === '/api/answer') {
    const c = caseById(body.id); if (!c) throw new Error('unknown case');
    if (!['pass', 'fail', 'skip'].includes(body.result)) throw new Error('bad result');
    answers[c.id] = { ...(answers[c.id] || {}), result: body.result, note: maskDeep(String(body.note || '').slice(0, 500)), products: body.products || {}, answeredAt: new Date().toISOString() };
    save();
    return { ok: true, answered: Object.keys(answers).length };
  }
  throw Object.assign(new Error('not found'), { code: 404 });
}

const page = readFileSync(join(here, 'checklist-page.html'), 'utf8');
const server = createServer(async (req, res) => {
  const send = (code, type, text) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(text); };
  try {
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return send(403, 'text/plain', 'forbidden');
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/') return send(url.searchParams.get('t') === token ? 200 : 403, 'text/html; charset=utf-8', url.searchParams.get('t') === token ? page : 'Open the address with the code printed on the computer.');
    if (req.headers['x-token'] !== token) return send(403, 'text/plain', 'forbidden');
    let body = {};
    if (req.method === 'POST') {
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100000) throw new Error('too big'); }
      body = text ? JSON.parse(text) : {};
    }
    send(200, 'application/json', JSON.stringify(await handle(req.method, url.pathname, body)));
  } catch (error) { send(error.code === 404 ? 404 : 500, 'application/json', JSON.stringify({ error: maskDeep(String(error.message || error)) })); }
});
server.listen(port, '127.0.0.1', () => {
  try { adb(device, 'reverse', `tcp:${port}`, `tcp:${port}`); } catch (error) { fail(`adb reverse failed: ${error.message}`); }
  save();
  console.log(`\nChecklist ready for ${device} (test app ${APP}).\n\n  On the phone, open Chrome and go to:\n\n      http://localhost:${port}/?t=${token}\n\nResults are saved in ${outDir}\nPress Ctrl+C here when you are done.\n`);
});
const stop = () => { try { adb(device, 'reverse', '--remove', `tcp:${port}`); } catch { /* already gone */ } writeReports(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (opt('--exit-after')) setTimeout(stop, +opt('--exit-after') * 1000); // for tests
