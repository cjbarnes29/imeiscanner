// Copies the text-reading engine into public/ocr so the app serves it itself instead of
// downloading it from a CDN on the first scan (faster first scan, works offline once
// opened). Runs before dev/build. The copied files are generated, so they are git-ignored.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
// Which language model: "4.0.0_best_int" is the quantized best model (about 3 MB,
// faster); "4.0.0" is the 11 MB float model that tesseract.js downloads by default.
const MODEL = process.env.OCR_MODEL || '4.0.0_best_int';
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  [`node_modules/@tesseract.js-data/eng/${MODEL}/eng.traineddata.gz`, 'eng.traineddata.gz']
];
await mkdir(out, { recursive: true });
for (const [from, to] of files) {
  const source = join(root, from);
  await access(source).catch(() => { throw new Error(`Missing ${from}. Run npm install first.`); });
  await copyFile(source, join(out, to));
}
console.log(`OCR engine copied to public/ocr (language model ${MODEL}).`);

// Brand profiles (brands/profiles/*.json) are the single source for the Android scanner and the web page. They are copied to public/brands so they
// reach dist/ and the Android assets (brands/*.json). The copies are generated and git-ignored.
import { readdir } from 'node:fs/promises';
const profilesDir = join(root, 'brands', 'profiles'), brandsOut = join(root, 'public', 'brands');
await mkdir(brandsOut, { recursive: true });
for (const file of (await readdir(profilesDir)).filter(name => name.endsWith('.json'))) await copyFile(join(profilesDir, file), join(brandsOut, file));
console.log('Brand profiles copied to public/brands.');
