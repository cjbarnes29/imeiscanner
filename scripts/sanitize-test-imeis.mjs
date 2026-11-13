// One-off helper that replaced real device IMEIs in tracked test scripts by synthetic ones.
//   node scripts/sanitize-test-imeis.mjs <real-imeis.txt> <file> [<file> ...]
// The model code (first 8 digits, public) is kept so model lookups behave the same. The device part (digits 9-14) goes through a fixed
// digit permutation, so equal parts stay equal and different parts stay different (IMEI 1 / IMEI 2 pairing, duplicates, near-misses).
// The check digit is recomputed so a number that passed the checksum still passes and one that failed still fails.
// The list of real IMEIs is private and never committed.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , listFile, ...files] = process.argv;
if (!listFile || !files.length) { console.error('usage: sanitize-test-imeis.mjs <real-imeis.txt> <file>...'); process.exit(2); }
const real = new Set(readFileSync(listFile, 'utf8').split(/\s+/).filter(value => /^[0-9]{15}$/.test(value)));
const luhnSum = digits => { let sum = 0; for (let i = 0; i < digits.length; i++) { let n = +digits[digits.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum; };
const checkDigit = first14 => (10 - (luhnSum(first14) % 10)) % 10;
const permute = digit => (+digit * 3 + 7) % 10;
export function synthetic(imei) {
  const body = imei.slice(0, 8) + [...imei.slice(8, 14)].map(permute).join('');
  const valid = checkDigit(body);
  const wasValid = checkDigit(imei.slice(0, 14)) === +imei[14];
  return body + (wasValid ? valid : (valid + 1) % 10);
}
for (const file of files) {
  let text = readFileSync(file, 'utf8'), count = 0;
  text = text.replace(/(?<![0-9])[0-9]{15}(?![0-9])/g, match => { if (!real.has(match)) return match; count++; return synthetic(match); });
  writeFileSync(file, text);
  console.log(`${file}: ${count} replaced`);
}
