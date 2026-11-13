// "Save to my phone" into the remembered folder (FolderExport, saved mode):
// 1. first save: folder chosen once, numbered pictures + numbers.txt, complete;
// 2. same save again (duplicate names): every file replaced in place, no "(1)" copies, no temporary files, nothing empty;
// 3. restart with an unfinished job in the journal (what Android leaves when it ends the app during a copy): finished at start, journal cleared.
import { ctx, scanAll, clickText, adb, sleep, check, finish, pickFolder, listDir, listDirs, waitForText } from './helpers.mjs';

const c = ctx(), results = [];
const BASE = '/sdcard/Documents/E2E-fx';
adb(c.device, 'shell', `rm -rf ${BASE}; mkdir -p ${BASE}`);
await scanAll(c);

const asApp = cmd => adb(c.device, 'shell', `run-as ${c.app} sh -c '${cmd}'`);
function reportFolder() {
  const dirs = listDirs(c, BASE).filter(d => d.startsWith('IMEI-') && d !== 'IMEI-E2E-resume');
  return dirs.length === 1 ? `${BASE}/${dirs[0]}` : null;
}
function checkReport(label) {
  const dir = reportFolder();
  check(results, `${label}: one report folder`, !!dir, listDirs(c, BASE).join(', '));
  const files = dir ? listDir(c, dir) : [];
  const pictures = files.filter(f => /^\d{3,4}-.+\.jpg$/.test(f.name));
  check(results, `${label}: 5 numbered pictures`, pictures.length === 5, files.map(f => `${f.name}:${f.size}`).join(' '));
  check(results, `${label}: numbers.txt`, files.some(f => f.name === 'numbers.txt' && f.size > 0));
  check(results, `${label}: nothing empty`, files.length > 0 && files.every(f => f.size > 0));
  check(results, `${label}: no temporary or duplicate-name files`, !files.some(f => f.name.endsWith('.partial') || /\(\d+\)/.test(f.name)));
  return files;
}

// 1. first save
// "Save to my phone" lives in the share view: Share tab > Share all
await clickText(c, '^Share$');
await sleep(800);
await clickText(c, '^Share all');
await sleep(1000);
check(results, '"Save to my phone" pressed', await clickText(c, '^Save to my phone$'));
await sleep(5000);
check(results, 'save folder chosen once (Documents/E2E-fx)', await pickFolder(c, ['Documents', 'E2E-fx']));
check(results, 'the app confirms the save', await waitForText(c, 'Saved [0-9]+ files', 30000));
const first = checkReport('first save');

// 2. same save again: same names
await sleep(2000);
check(results, '"Save to my phone" pressed again', await clickText(c, '^Save to my phone$'));
check(results, 'second save confirmed without asking for a folder', await waitForText(c, 'Saved [0-9]+ files', 30000));
const second = checkReport('second save');
check(results, 'same files after replacing (no additions, no losses)', JSON.stringify(first.map(f => f.name).sort()) === JSON.stringify(second.map(f => f.name).sort()));

// 3. restart with an unfinished job in the journal
const prefs = asApp('cat shared_prefs/app-state.xml');
const tree = ((prefs.match(/name="save-tree">([^<]+)</) || [])[1] || '').replace(/&amp;/g, '&');
check(results, 'remembered folder found in the app state', tree.includes('/tree/'), tree ? 'set' : 'missing');
const rootId = decodeURIComponent(tree.split('/tree/')[1] || '');
adb(c.device, 'shell', 'am', 'force-stop', c.app);
asApp('rm -rf cache/imei-folder-e2e; mkdir -p cache/imei-folder-e2e; for n in 001-resume-a.jpg 002-resume-b.jpg numbers.txt; do head -c 3000 /dev/urandom > cache/imei-folder-e2e/$n; done');
const staged = `/data/user/0/${c.app}/cache/imei-folder-e2e`;
const job = ['v1', 'saved', staged, rootId, 'IMEI-E2E-resume', '', 'E2E-fx', 'false', 'false', 'false', 'false', '', tree].join('\n');
const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="fx:imei-folder-e2e">${job.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '&#10;')}</string>\n</map>\n`;
asApp(`echo ${Buffer.from(xml).toString('base64')} | base64 -d > shared_prefs/folder-exports.xml`);
adb(c.device, 'shell', 'monkey', '-p', c.app, '-c', 'android.intent.category.LAUNCHER', '1');
check(results, 'the restarted app announces the finished save', await waitForText(c, 'interrupted save was finished', 30000));
const resumed = listDir(c, `${BASE}/IMEI-E2E-resume`);
check(results, 'the interrupted job was finished: 3 files of 3000 bytes', resumed.length === 3 && resumed.every(f => f.size === 3000), resumed.map(f => `${f.name}:${f.size}`).join(' '));
check(results, 'journal cleared', !asApp('cat shared_prefs/folder-exports.xml 2>/dev/null').includes('fx:imei-folder-e2e'));
check(results, 'staged copy removed', !asApp('ls cache 2>/dev/null').includes('imei-folder-e2e'));
checkReport('earlier report untouched by the resumed job');

adb(c.device, 'shell', `rm -rf ${BASE}`);
finish('13-folder-export-saved', results);
