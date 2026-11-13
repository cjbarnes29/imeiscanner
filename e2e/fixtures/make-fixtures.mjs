// Generates SYNTHETIC label photos for the emulator tests (no real device data). Deterministic; writes e2e/fixtures/out/*.jpg and truth.json.
//   node e2e/fixtures/make-fixtures.mjs
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
await mkdir(out, { recursive: true });

const luhnCheck = body14 => { let sum = 0; for (let i = 0; i < 14; i++) { let n = +body14[13 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return (10 - (sum % 10)) % 10; };
// Synthetic IMEI: public-looking model code + made-up device digits + valid check digit. Never a real device.
const imei = (tac, serial6) => { const body = `${tac}${serial6}`; return body + luhnCheck(body); };

const devices = {
  A: { model: 'SM-A376B', imei1: imei('49015420', '323751'), imei2: imei('35693803', '564380'), serial: 'RSYN20HB02P' },
  B: { model: 'SM-S938B', imei1: imei('49015420', '777001'), imei2: imei('35693803', '777002'), serial: 'RSYN30HB03Q' },
  C: { model: 'SM-A165F', imei1: imei('49015420', '555123'), imei2: imei('35693803', '555124'), serial: 'RSYN40HB04R' },
  D: { model: 'SM-A077F', imei1: imei('49015420', '999321'), imei2: imei('35693803', '999322'), serial: 'RSYN50HB05S' },
};

const W = 1200, H = 520;
const bars = (x, y, w, h, seed) => { let s = '', cx = x, k = seed; while (cx < x + w) { k = (k * 7 + 3) % 11; const bw = 2 + (k % 4); if (k % 2) s += `<rect x="${cx}" y="${y}" width="${bw}" height="${h}" fill="#000"/>`; cx += bw + 1; } return s; };
const labelSvg = (d, { hideImei1 = false, yOff = 0 } = {}) => `
  <rect x="20" y="${yOff + 20}" width="${W - 40}" height="${H - 40}" rx="14" fill="#ffffff" stroke="#222" stroke-width="3"/>
  <text x="60" y="${yOff + 90}" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="bold" fill="#000">Model : ${d.model}/DS</text>
  <text x="60" y="${yOff + 150}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">6GB | 128GB</text>
  <text x="60" y="${yOff + 215}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">S/N : ${d.serial}</text>
  ${bars(60, yOff + 245, 520, 70, 3)}
  <text x="60" y="${yOff + 360}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">IMEI 1 : ${hideImei1 ? '- - - - - - - - - - - - - - -' : d.imei1}</text>
  ${bars(60, yOff + 385, 520, 60, 5)}
  <text x="60" y="${yOff + 485}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">IMEI 2 : ${d.imei2}</text>`;
const page = (height, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}"><rect width="${W}" height="${height}" fill="#d9d9d9"/>${body}</svg>`);
const jpg = async (svg, name, quality = 90) => sharp(svg).jpeg({ quality }).toFile(join(out, name));

await jpg(page(H, labelSvg(devices.A)), 'E2E-single-A.jpg');
await jpg(page(H, labelSvg(devices.B)), 'E2E-single-B.jpg');
await jpg(page(2 * H + 30, labelSvg(devices.C) + labelSvg(devices.D, { yOff: H + 30 })), 'E2E-two-box-CD.jpg');
// same label as single-A but different bytes (quality and size): the same IMEI again = a duplicate record
await sharp(page(H, labelSvg(devices.A))).resize({ width: 1100 }).jpeg({ quality: 70 }).toFile(join(out, 'E2E-dup-of-A.jpg'));
// IMEI 1 not readable, IMEI 2 clear: must be flagged, never shown as a clean IMEI 1
await jpg(page(H, labelSvg({ ...devices.B, imei2: imei('35693803', '123456') }, { hideImei1: true })), 'E2E-imei2-only.jpg');

const truth = {
  note: 'Synthetic data for emulator tests. No real device.',
  photos: {
    'E2E-single-A.jpg': { devices: 1, imei1: [devices.A.imei1], models: [devices.A.model] },
    'E2E-single-B.jpg': { devices: 1, imei1: [devices.B.imei1], models: [devices.B.model] },
    'E2E-two-box-CD.jpg': { devices: 2, imei1: [devices.C.imei1, devices.D.imei1], models: [devices.C.model, devices.D.model] },
    'E2E-dup-of-A.jpg': { devices: 1, imei1: [devices.A.imei1], models: [devices.A.model], duplicateOf: 'E2E-single-A.jpg' },
    'E2E-imei2-only.jpg': { devices: 1, imei1: [], imei2: [imei('35693803', '123456')], models: [devices.B.model], expectFlag: 'imei2-fallback' },
  },
};
await writeFile(join(out, 'truth.json'), JSON.stringify(truth, null, 2));
console.log('wrote', Object.keys(truth.photos).length, 'photos to', out);
