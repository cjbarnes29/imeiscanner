// Excel-with-pictures export into a folder chosen with the system folder picker (FolderExport, picker mode):
// 1. normal export: complete folder (workbook + every picture, none empty, no temporary files);
// 2. Android ends the app while the picker is open, then the folder is chosen: the export is finished after the restart, nothing half-done.
import { ctx, scanAll, clickText, js, adb, sleep, check, finish, focusedWindow, pickFolder, listDir, listDirs, waitForText } from './helpers.mjs';

const c = ctx(), results = [];
const BASE = '/sdcard/Documents/E2E-fx';
adb(c.device, 'shell', `rm -rf ${BASE}; mkdir -p ${BASE}`);
await scanAll(c);

async function startExcelWithPictures() {
  await clickText(c, '^Export$');
  await sleep(800);
  await js(c, `(()=>{const st=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;for(const s of document.querySelectorAll('select')){const o=[...s.options].find(o=>/^Excel workbook|^IMEI \\+ picture/.test(o.text));if(o){st.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}))}}return 1})()`);
  await sleep(600);
  return clickText(c, '^Export [0-9]+ records');
}
function checkFolder(label, folders) {
  const made = listDirs(c, BASE).filter(d => !folders.includes(d));
  check(results, `${label}: one new folder`, made.length === 1, made.join(', ') || 'none');
  const files = made.length ? listDir(c, `${BASE}/${made[0]}`) : [];
  const pictures = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name));
  check(results, `${label}: workbook present`, files.some(f => f.name.endsWith('.xlsx') && f.size > 0), files.map(f => `${f.name}:${f.size}`).join(' '));
  check(results, `${label}: a picture for every record (5)`, pictures.length === 5, `${pictures.length}`);
  check(results, `${label}: no empty file`, files.length > 0 && files.every(f => f.size > 0));
  check(results, `${label}: no temporary .partial file`, !files.some(f => f.name.endsWith('.partial')));
  return made;
}

// 1. normal
check(results, 'export started', await startExcelWithPictures());
await sleep(6000);
check(results, 'folder picker is open', focusedWindow(c).includes('documentsui'));
check(results, 'folder chosen (Documents/E2E-fx)', await pickFolder(c, ['Documents', 'E2E-fx']));
check(results, 'the app confirms the save', await waitForText(c, 'saved to your phone', 30000));
const first = checkFolder('normal export', []);

// 2. the app is ended while the picker is open
adb(c.device, 'shell', 'pm', 'clear', 'com.google.android.documentsui');
check(results, 'second export started', await startExcelWithPictures());
await sleep(6000);
check(results, 'folder picker is open again', focusedWindow(c).includes('documentsui'));
adb(c.device, 'shell', 'am', 'kill', c.app);
await sleep(2000);
const alive = (() => { try { return adb(c.device, 'shell', 'pidof', c.app).trim() !== ''; } catch { return false; } })(); // pidof fails when there is none
check(results, 'test app process is gone while the picker is open', !alive);
check(results, 'folder chosen after the app was ended', await pickFolder(c, ['Documents', 'E2E-fx']));
// the restarted app copies in the background and announces it once its page has loaded (the toast is brief: watch for it at once)
check(results, 'the restarted app reports the finished save', await waitForText(c, 'saved to your phone|interrupted save was finished', 30000));
checkFolder('after the app was ended', first);

adb(c.device, 'shell', `rm -rf ${BASE}`);
finish('12-folder-export-picker', results);
