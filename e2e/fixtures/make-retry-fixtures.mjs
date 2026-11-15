// SYNTHETIC photos for the automatic-retry tests (no real device data): a big photo with a small label whose barcodes are real Code 128, too small
// to decode at the scanner's normal decode size but readable at full resolution (the retry decodes larger and re-reads the strip above "IMEI 1").
//   node e2e/fixtures/make-retry-fixtures.mjs        writes e2e/fixtures/out/RETRY-*.jpg and retry-truth.json
// Prefix RETRY- (not E2E-) so the picker tests that search for "E2E-" still select exactly five photos.
// Uses sharp and zxing-wasm, both already dependencies of the project (zxing-wasm also writes barcodes).
import sharp from 'sharp';
import { writeBarcode } from 'zxing-wasm/writer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
await mkdir(out, { recursive: true });

const luhnCheck = body14 => { let sum = 0; for (let i = 0; i < 14; i++) { let n = +body14[13 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return (10 - (sum % 10)) % 10; };
const imei = (tac, serial6) => { const body = `${tac}${serial6}`; return body + luhnCheck(body); };

const W = 1200, H = 520;
export const device = { model: 'SM-A376B', imei1: imei('49015420', '424107'), imei2: imei('35693803', '424108'), serial: 'RSYN60HB06T' };
// A second, different device for the conflict photo (a different IMEI 2 would otherwise make it a duplicate of the first photo).
export const device2 = { model: 'SM-A376B', imei1: imei('49015420', '424301'), imei2: imei('35693803', '424302'), serial: 'RSYN61HB06U' };
const other = imei('86000000', '991001'); // a number from some other label (printed on the conflict photo instead of its own)

/** A real Code 128 barcode as a PNG, drawn width x height pixels with crisp (nearest-neighbour) modules. */
async function barcode(value, width, height) {
  const written = await writeBarcode(value, { format: 'Code128', scale: 1, withQuietZones: false, height: 10 });
  if (written.error) throw new Error(written.error);
  const png = Buffer.from(await written.image.arrayBuffer());
  return sharp(png).resize({ width, height, fit: 'fill', kernel: 'nearest' }).png().toBuffer();
}

/** The label at design size (same layout as the other fixtures: each barcode sits just above its own text line). */
async function label({ dev, printedImei1, barcodeWidth }) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#d9d9d9"/>
    <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="14" fill="#ffffff" stroke="#222" stroke-width="3"/>
    <text x="60" y="90" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="bold" fill="#000">Model : ${dev.model}/DS</text>
    <text x="60" y="150" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">6GB | 128GB</text>
    <text x="60" y="215" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">S/N : ${dev.serial}</text>
    <text x="60" y="360" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">IMEI 1 : ${printedImei1}</text>
    <text x="60" y="485" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">IMEI 2 : ${dev.imei2}</text></svg>`);
  return sharp(svg).composite([
    { input: await barcode(dev.imei1, barcodeWidth, 70), left: 60, top: 245 },
    { input: await barcode(dev.imei2, barcodeWidth, 60), left: 60, top: 385 }
  ]).png().toBuffer();
}

/** The label small in a big photo (the way a label looks from a step away). */
async function photo(name, { dev, printedImei1, barcodeWidth, labelWidth = 1000, size = [4000, 3000] }) {
  const small = await sharp(await label({ dev, printedImei1, barcodeWidth })).resize({ width: labelWidth }).png().toBuffer();
  const meta = await sharp(small).metadata();
  const [pw, ph] = size;
  await sharp({ create: { width: pw, height: ph, channels: 3, background: '#8a8d90' } })
    .composite([{ input: small, left: Math.round((pw - meta.width) / 2), top: Math.round((ph - meta.height) / 2) }])
    .jpeg({ quality: 92 }).toFile(join(out, name));
}

const BARCODE_WIDTH = Number(process.env.RETRY_BARCODE_WIDTH || 260); // design pixels; at this size the barcode is ~1 px per module at half resolution
const partial = `${device.imei1.slice(0, 8)} - - - - - - -`; // the first 8 digits are printed clearly, the rest is worn off
// 1. IMEI 1 digits mostly unreadable, barcode small but real, printed digits (what is readable) agree with the barcode: recoverable
await photo('RETRY-small-barcode.jpg', { dev: device, printedImei1: partial, barcodeWidth: BARCODE_WIDTH });
// 2. the readable printed digits belong to ANOTHER number than the barcode: the retry must trust neither
await photo('RETRY-conflict.jpg', { dev: device2, printedImei1: `${other.slice(0, 8)} - - - - - - -`, barcodeWidth: BARCODE_WIDTH });
// 3. nothing readable at all (a gray table): unresolved after its one retry, never retried again
await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#7d8083' } }).jpeg({ quality: 90 }).toFile(join(out, 'RETRY-blank.jpg'));

await writeFile(join(out, 'retry-truth.json'), JSON.stringify({
  note: 'Synthetic data for emulator tests. No real device.',
  photos: {
    'RETRY-small-barcode.jpg': { imei1: device.imei1, imei2: device.imei2, expect: 'IMEI 1 recovered from the barcode (retry), not flagged' },
    'RETRY-conflict.jpg': { imei1: device2.imei1, imei2: device2.imei2, expect: 'barcode and printed digits disagree: IMEI 1 not taken' },
    'RETRY-blank.jpg': { expect: 'no label text: unresolved after one retry' }
  }
}, null, 2));
console.log('wrote RETRY-small-barcode.jpg, RETRY-conflict.jpg, RETRY-blank.jpg, retry-truth.json to', out, '(barcode width', BARCODE_WIDTH, 'design px)');
