// Builds labeled multi-product test photos from the real labeled photos in test-photos (git-ignored: real IMEIs).
//   node scripts/make-composites.mjs   ->  test-photos/composite/*.jpg + test-photos/composite/truth.json
// Each product in truth.json is {imei, imei2?, serial?, model?}; unknown fields are left out, never guessed.
// Composites are made by cutting and stacking REAL label photos, so they test counting, splitting and field mixing at
// 1/2/4/5/10 products and under blur, glare, overlap and cut-off labels. They are not physical multi-product photos.
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const dir = 'test-photos', out = 'test-photos/composite';
await mkdir(out, { recursive: true });
const W = 1200;

// ---- ground truth read from the labels (top to bottom) ----
// Ground truth of the real labels lives in test-photos/label-truth.json (git-ignored: real IMEIs), never in this file.
let P;
try { P = JSON.parse(await readFile('test-photos/label-truth.json', 'utf8')); }
catch { console.error('Missing test-photos/label-truth.json (private). It holds {verTop, verBot, a1, a2, s1, s2, f1, f2, f3, f4}: {imei, imei2?, serial?, model?} read from the labels.'); process.exit(1); }
const file = n => `${dir}/${n}`;
const jpeg = async (input, name) => { await sharp(input).jpeg({ quality: 88 }).toFile(`${out}/${name}.jpg`); };
const resized = async (path, width = W) => sharp(path).rotate().resize({ width }).toBuffer();
async function crop(path, top, bottom) {
  const m = await sharp(path).rotate().metadata();
  return sharp(path).rotate().extract({ left: 0, top: Math.round(m.height * top), width: m.width, height: Math.round(m.height * (bottom - top)) }).resize({ width: W }).toBuffer();
}
/** Stack images vertically with a small gap (negative gap = overlap, later pictures on top). */
async function stack(buffers, gap = 24) {
  const metas = await Promise.all(buffers.map(b => sharp(b).metadata()));
  let y = 0; const layers = [];
  metas.forEach((m, i) => { layers.push({ input: buffers[i], left: 0, top: Math.max(0, y) }); y += m.height + gap; });
  const height = Math.max(...layers.map((l, i) => l.top + metas[i].height));
  return sharp({ create: { width: W, height, channels: 3, background: '#d9d9d9' } }).composite(layers).jpeg({ quality: 90 }).toBuffer();
}
/** Two columns of images. */
async function grid(buffers) {
  const cell = Math.round(W * 0.9);
  const tiles = await Promise.all(buffers.map(b => sharp(b).resize({ width: cell }).toBuffer()));
  const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
  const rows = Math.ceil(tiles.length / 2), layers = []; let y = 0;
  for (let r = 0; r < rows; r++) {
    const h = Math.max(...[0, 1].map(c => metas[r * 2 + c]?.height || 0));
    [0, 1].forEach(c => { if (tiles[r * 2 + c]) layers.push({ input: tiles[r * 2 + c], left: c * cell, top: y }); });
    y += h + 20;
  }
  return sharp({ create: { width: cell * 2, height: y, channels: 3, background: '#cfcfcf' } }).composite(layers).jpeg({ quality: 90 }).toBuffer();
}

const ver = file('verification-original.jpg');
const single1 = await crop(ver, 0.255, 0.56);   // top box only
const single2 = await crop(ver, 0.565, 0.9);    // bottom box only
const two = await resized(ver);
const four = await resized(file('1-1000380365.jpg'));
const a = await resized(file('a376-2box-a.jpg')), b = await resized(file('a376-2box-b.jpg')), s = await resized(file('s938-dark-2box.jpg'));

const truth = {};
const add = async (name, buffer, products, note) => { await jpeg(buffer, name); truth[name + '.jpg'] = { devices: products.length, products, note }; };

await add('p01-single', single1, [P.verTop], 'one product');
await add('p02-pair', two, [P.verTop, P.verBot], 'real photo, 2 boxes');
await add('p04-stack', four, [P.f1, P.f2, P.f3, P.f4], 'real photo, 4 boxes, each with repeated IMEI labels');
await add('p05-stack', await stack([four, single1]), [P.f1, P.f2, P.f3, P.f4, P.verTop], '4-box photo + 1 box');
const exp = JSON.parse((await import('node:fs')).readFileSync(`${dir}/expected.json`, 'utf8'));
const fromExpected = (name, i) => ({ imei: exp[name].imeis[i], imei2: exp[name].imei2s?.[i], serial: exp[name].serials?.[i] });
const aa = [0, 1].map(i => fromExpected('a376-2box-a.jpg', i)), bb = [0, 1].map(i => fromExpected('a376-2box-b.jpg', i));
const fourTop = await crop(file('1-1000380365.jpg'), 0.08, 0.54);   // boxes 1 and 2 of the 4-box photo
await add('p10-grid', await grid([a, b, s, two, fourTop]), [...aa, ...bb, P.s1, P.s2, P.verTop, P.verBot, P.f1, P.f2], 'ten different boxes in a 2-column grid (5 real photos, 2 boxes each)');
await add('p12-grid', await grid([a, b, s, two, four]), [...aa, ...bb, P.s1, P.s2, P.verTop, P.verBot, P.f1, P.f2, P.f3, P.f4], 'twelve different boxes in a 2-column grid');
// ---- degraded variants (same truth as the clean photo) ----
await add('d-blur-p04', await sharp(four).blur(2.2).jpeg({ quality: 85 }).toBuffer(), [P.f1, P.f2, P.f3, P.f4], 'blurred 4-box photo (sigma 2.2)');
await add('d-blur-p02', await sharp(two).blur(2.6).jpeg({ quality: 85 }).toBuffer(), [P.verTop, P.verBot], 'blurred pair (sigma 2.6)');
await add('d-softblur-p04', await sharp(four).blur(1.2).jpeg({ quality: 85 }).toBuffer(), [P.f1, P.f2, P.f3, P.f4], 'light blur, 4 boxes (sigma 1.2)');
await add('d-softblur-p02', await sharp(two).blur(1.4).jpeg({ quality: 85 }).toBuffer(), [P.verTop, P.verBot], 'light blur, pair (sigma 1.4)');
const glareSvg = (w, h, cx, cy, r) => Buffer.from(`<svg width="${w}" height="${h}"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="0.97"/><stop offset="0.6" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${r * 1.7}" ry="${r * 0.5}" fill="url(#g)"/></svg>`);
const fm = await sharp(four).metadata();
await add('d-glare-p04', await sharp(four).composite([{ input: glareSvg(fm.width, fm.height, fm.width * 0.62, fm.height * 0.42, fm.width * 0.22) }]).jpeg({ quality: 88 }).toBuffer(), [P.f1, P.f2, P.f3, P.f4], 'strong glare streak over boxes 2-3 (IMEIs there may become unreadable: flagged, never invented)');
// overlap: the lower product is pulled up over the previous one by 12%
const ov = await stack([four, single1], -Math.round((await sharp(single1).metadata()).height * 0.12));
await add('d-overlap-p05', ov, [P.f1, P.f2, P.f3, P.f4, P.verTop], 'last box overlaps the bottom of the 4-box photo by 12%');
// partially visible: the bottom product cut in half
const tm = await sharp(two).metadata();
await add('d-partial-p02', await sharp(two).extract({ left: 0, top: 0, width: tm.width, height: Math.round(tm.height * 0.72) }).jpeg({ quality: 88 }).toBuffer(), [P.verTop, { ...P.verBot, optional: true }], 'bottom box cut off at its IMEI lines: one full product + one partly visible (must not invent an IMEI)');
await writeFile(`${out}/truth.json`, JSON.stringify(truth, null, 1));
console.log('wrote', Object.keys(truth).length, 'labeled photos to', out);
