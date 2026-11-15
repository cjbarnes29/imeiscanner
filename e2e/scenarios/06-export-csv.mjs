// CSV export through the system "Save as" dialog: cancel first (no file, clear message, next export works), then save (non-empty, right rows, synthetic IMEIs).
import { ctx, scanAll, startCsvExport, tapSystemText, focusedWindow, pressBack, waitForText, adb, sleep, check, finish } from './helpers.mjs';
import { truth } from '../scripts/lib.mjs';

const c = ctx(), results = [];
const sizeOfExport = () => {
  const line = adb(c.device, 'shell', 'ls -l /sdcard/Download').split('\n').find(l => l.includes('imei-scanner-export')) || '';
  return line ? Number((line.match(/\s(\d+)\s\d{4}-\d{2}-\d{2}/) || [])[1] ?? -1) : -1;
};
adb(c.device, 'shell', 'rm -f /sdcard/Download/imei-scanner-export*');
await scanAll(c);

// 1. cancel
check(results, 'export button pressed', await startCsvExport(c));
await sleep(5000);
check(results, 'the system Save dialog opens', focusedWindow(c).includes('documentsui'));
pressBack(c);
check(results, 'cancelling is announced ("cancelled")', await waitForText(c, 'cancelled', 8000));
check(results, 'cancelling leaves no file behind', sizeOfExport() === -1, `size ${sizeOfExport()}`);

// 2. save
check(results, 'the next export works after a cancel', await startCsvExport(c));
await sleep(5000);
check(results, 'Save dialog proposes imei-scanner-export.csv', tapSystemText(c, 'Save'));
check(results, 'the app confirms the save', await waitForText(c, 'saved to your phone', 25000));
const size = sizeOfExport();
check(results, 'the CSV file is not empty (0 bytes is the interrupted-export bug)', size > 0, `${size} bytes`);
if (size > 0) {
  const text = adb(c.device, 'shell', 'cat /sdcard/Download/imei-scanner-export.csv');
  const rows = text.split(/\r?\n/).filter(Boolean);
  check(results, 'header plus 5 records', rows.length === 6, `${rows.length} lines`);
  const wanted = [...truth['E2E-single-A.jpg'].imei1, ...truth['E2E-single-B.jpg'].imei1, ...truth['E2E-two-box-CD.jpg'].imei1];
  for (const imei of wanted) check(results, `contains synthetic IMEI ${imei.slice(0, 8)}***${imei.slice(-4)}`, text.includes(imei));
}
adb(c.device, 'shell', 'rm -f /sdcard/Download/imei-scanner-export*');
finish('06-export-csv', results);
