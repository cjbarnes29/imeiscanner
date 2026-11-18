// The app report (src/retail/report-*.ts): the model is built only from the app's own numbers, and the same model becomes simple notes, a real Excel file and a
// real PowerPoint file. The Excel file is read back with exceljs; the PowerPoint package is checked part by part (every XML part is well formed, every
// relationship points at a part that exists, every part has a content type, the slide list matches). No IMEI is ever written. Synthetic data only.
// Set REPORT_OUT_DIR to also keep the generated .xlsx / .pptx / .txt for opening by hand. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const cache = join(process.cwd(), 'node_modules', '.cache', 'imei-report-test');
await mkdir(cache, { recursive: true });
const entry = `
export { buildReport, monthTitle } from './src/retail/report-model';
export { reportNotes } from './src/retail/report-notes';
export { reportXlsx } from './src/retail/report-xlsx';
export { reportPptx, reportSlides, xmlText } from './src/retail/report-pptx';
export { parseReportIntent, monthInRequest } from './src/retail/report-intent';
export { emptyState } from './src/retail/data';
export { putTarget } from './src/retail/targets';`;
const bundled = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', external: ['exceljs', 'jszip'] });
const file = join(cache, 'report.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const R = await import(pathToFileURL(file).href);
const ExcelJS = (await import('exceljs')).default;
const JSZip = (await import('jszip')).default;

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
let seq = 910000;
const imei = () => { const body = '49015420' + String(seq++).padStart(6, '0'); return body + luhn(body); };
const TODAY = '2026-11-18', NOW = '2026-11-18T10:00:00.000Z';
const people = [{ id: 'p1', name: 'Asha Test' }, { id: 'p2', name: 'Bilal Test' }];
const line = (segment, target, achieved) => ({ segment, target, achieved });
let state = R.emptyState();
state = R.putTarget(state, { personId: 'p1', month: '2026-11', source: 'manual', importedAt: NOW, lines: [line('low', 10, 6), line('mid', 4, 4)] });
state = R.putTarget(state, { personId: 'p2', month: '2026-11', source: 'manual', importedAt: NOW, lines: [line('low', 10, 2)] });
const sale = (n, personId, segment, submitted) => ({ id: 's' + n, recordId: 'sold' + n, imei: imei(), model: 'SM-A176B', modelName: 'Galaxy A17 5G', ram: '6GB', storage: '128GB', color: 'Black', segment, personId, date: '2026-11-10', month: '2026-11', submitted, attributedBy: 'owner', createdAt: NOW });
state = { ...state, sales: [sale(1, 'p1', 'low', true), sale(2, 'p1', 'low', false), sale(3, 'p2', 'low', false)] };
const records = [{ id: 'r1', imei: imei(), model: 'SM-A176B', personId: '', raw: '6GB | 128GB\nColour: Black' }, { id: 'r2', imei: imei(), model: 'SM-A176B', personId: 'p1', raw: '6GB | 128GB\nColour: Black' }, { id: 'r3', imei: imei(), model: 'SM-A576B', personId: 'p2', raw: '8GB | 256GB\nColour: Gray' }];

// ---- the model ------------------------------------------------------------------------------------------------------------------------------------
const m = R.buildReport(state, records, people, TODAY);
assert.equal(m.title, 'AI LENS report · November 2026'); assert.equal(m.who, 'Everyone'); assert.equal(m.daysLeft, 13);
const kpi = name => m.kpis.find(k => k.label === name).value;
assert.equal(kpi('Target'), '24'); assert.equal(kpi('Sold'), '12'); assert.equal(kpi('Achieved'), '50%'); assert.equal(kpi('Days left'), '13');
assert.equal(kpi('Sales this month'), '3'); assert.equal(kpi('Not yet submitted'), '2'); assert.equal(kpi('Phones in stock'), '3', 'three valid unsold phones');
const low = m.segments.rows.find(r => r[0] === 'Low'), mid = m.segments.rows.find(r => r[0] === 'Mid');
assert.deepEqual(low.slice(1, 5), [20, 8, 0.4, 12], 'Low: target 20, sold 8, 40%, needs 12 for 100%');
assert.deepEqual(mid.slice(1, 5), [4, 4, 1, 0]); assert.equal(mid[5], 'Reached', 'a reached segment says so');
assert.match(low[5], /(a day|every \d+ days)/, 'whole-number pace for 100%'); assert.match(low[6], /^(by \d+ \w+|not by month end|too early|no sales)/);
assert.equal(m.people.rows.length, 2); assert.deepEqual(m.people.rows[0].slice(0, 5), ['Asha Test', 14, 10, 0.7143, 1]);
assert.equal(m.outlook.rows.length, 2); assert.ok(m.outlook.rows.every(r => ['Push', 'Keep the pace', 'Hard to reach', 'Done'].includes(r[3])));
assert.ok(m.highlights[0].startsWith('Everyone is at 50% of target (12 of 24) with 13 days left.'), m.highlights[0]);
assert.ok(m.highlights.some(h => /waiting to be submitted to Samsung/.test(h)) && m.highlights.some(h => /^If sales keep this month's pace/.test(h)));
assert.deepEqual(m.sales.rows.map(r => r.slice(0, 4)), [['Asha Test', 'Low', 2, 1], ['Bilal Test', 'Low', 1, 0]]);
assert.equal(m.stock.rows.reduce((s, r) => s + r[4], 0), 3);
// one person only
const one = R.buildReport(state, records, people, TODAY, { personId: 'p2' });
assert.equal(one.who, 'Bilal Test'); assert.equal(one.kpis.find(k => k.label === 'Target').value, '10'); assert.equal(one.kpis.find(k => k.label === 'Sold').value, '2'); assert.equal(one.kpis.find(k => k.label === 'Phones in stock').value, '1'); assert.equal(one.sales.rows.length, 1);
// a past month and a month with nothing
const past = R.buildReport(state, records, people, TODAY, { month: '2026-10' });
assert.equal(past.month, '2026-10'); assert.match(past.highlights[0], /^No targets are set for October 2026\./); assert.equal(past.kpis.find(k => k.label === 'Days left').value, '—'); assert.equal(past.outlook.rows.length, 0);
assert.equal(R.buildReport(R.emptyState(), [], [], TODAY).kpis.find(k => k.label === 'Target').value, '0', 'an empty app still gives a report');
// no IMEI anywhere
for (const text of [JSON.stringify(m), JSON.stringify(one), JSON.stringify(past)]) assert.ok(!/\d{15}/.test(text), 'no 15-digit number in a report model: ' + (text.match(/.{0,30}\d{15}.{0,10}/) || [''])[0]);

// ---- simple notes -----------------------------------------------------------------------------------------------------------------------------------
const notes = R.reportNotes(m);
for (const word of ['AI LENS report · November 2026', 'HIGHLIGHTS', 'NUMBERS', 'TARGETS BY SEGMENT', 'PEOPLE', 'WHAT TO PUSH AND WHAT TO LEAVE', 'SALES THIS MONTH', 'STOCK']) assert.ok(notes.includes(word), 'notes have ' + word);
assert.match(notes, /- Low: target 20, sold 8, achieved 40%, needs for 100% 12/); assert.ok(!/\d{15}/.test(notes)); assert.ok(notes.split('\n').length < 80, 'notes stay short');
assert.match(R.reportNotes(R.buildReport(R.emptyState(), [], [], TODAY)), /Nothing to show\./);

// ---- Excel -------------------------------------------------------------------------------------------------------------------------------------------
const xlsx = await R.reportXlsx(m);
assert.equal(xlsx.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); assert.ok(xlsx.size > 3000);
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Targets by segment', 'People', 'Month outlook', 'Sales this month', 'Stock']);
assert.equal(wb.getWorksheet('Summary').getCell('A1').value, 'AI LENS report · November 2026');
const seg = wb.getWorksheet('Targets by segment');
assert.deepEqual(seg.getRow(1).values.slice(1), ['Segment', 'Target', 'Sold', 'Achieved', 'Needs for 100%', 'Pace for 100%', 'Reaches 100%']);
const lowRow = seg.getRows(2, 2).find(r => r.getCell(1).value === 'Low');
assert.equal(lowRow.getCell(2).value, 20); assert.equal(lowRow.getCell(4).value, 0.4, 'percent is a real number'); assert.equal(seg.getColumn(4).numFmt, '0%');
assert.equal(seg.views[0].state, 'frozen'); assert.ok(!JSON.stringify(wb.model).match(/\d{15}/), 'no IMEI in the workbook');
assert.equal((await R.reportXlsx(R.buildReport(R.emptyState(), [], [], TODAY))).size > 2000, true, 'an empty app still gives a workbook');

// ---- PowerPoint --------------------------------------------------------------------------------------------------------------------------------------
/** Strict-enough XML check: tags nest and close, attributes are quoted, text has no bare & or <. */
function checkXml(name, xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<[^>]*>?)/g;
  let match;
  while ((match = re.exec(body))) {
    if (match[6]) throw new Error(`${name}: bad markup near "${match[6].slice(0, 40)}"`);
    if (match[5]) { if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(match[5])) throw new Error(`${name}: bare & in text`); continue; }
    if (match[1]) { if (stack.pop() !== match[2]) throw new Error(`${name}: </${match[2]}> does not match`); } else if (!match[4]) stack.push(match[2]);
  }
  if (stack.length) throw new Error(`${name}: <${stack.pop()}> is never closed`);
}
async function checkPptx(blob, expectSlides) {
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml']) assert.ok(names.includes(required), 'has ' + required);
  const xmlOf = async n => zip.file(n).async('string');
  for (const n of names) checkXml(n, await xmlOf(n));
  // every relationship target exists
  for (const n of names.filter(x => x.endsWith('.rels'))) {
    const base = n.replace(/(^|.*\/)_rels\/[^/]*\.rels$/, '$1');
    for (const target of [...(await xmlOf(n)).matchAll(/Target="([^"]+)"/g)].map(t => t[1])) {
      const parts = (base + target).split('/'), out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
      assert.ok(names.includes(out.join('/')), `${n} points at ${out.join('/')} which is missing`);
    }
  }
  // every part has a content type
  const types = await xmlOf('[Content_Types].xml');
  for (const n of names.filter(x => x !== '[Content_Types].xml' && !x.endsWith('.rels'))) assert.ok(types.includes(`PartName="/${n}"`) || (n.endsWith('.xml') && false), `content type for ${n}`);
  // the slide list matches the slides in the package
  const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal((await xmlOf('ppt/presentation.xml')).match(/<p:sldId /g).length, slides.length);
  if (expectSlides) assert.equal(slides.length, expectSlides);
  const all = (await Promise.all(slides.map(xmlOf))).join('\n');
  assert.ok(!/\d{15}/.test(all), 'no IMEI on a slide');
  return { slides, all, zip };
}
const pptx = await R.reportPptx(m);
const checked = await checkPptx(pptx);
assert.ok(checked.slides.length >= 6, 'title, numbers, targets, push/leave, people, sales and stock: ' + checked.slides.length);
for (const text of ['AI LENS report · November 2026', 'The month in numbers', 'Targets by segment', 'What to push, what to leave', 'People', 'Sales and stock', 'Low', 'Asha Test']) assert.ok(checked.all.includes(`>${text}`) || checked.all.includes(text), 'slides mention ' + text);
// hostile text stays valid XML: & < > quotes and control characters in names
const hostile = [{ id: 'h1', name: 'A & B <x> "q" \u0007' }];
let hs = R.putTarget(R.emptyState(), { personId: 'h1', month: '2026-11', source: 'manual', importedAt: NOW, lines: [line('low', 5, 1)] });
await checkPptx(await R.reportPptx(R.buildReport(hs, [], hostile, TODAY)));
assert.equal(R.xmlText('a&b<c>"d"\u0001'), 'a&amp;b&lt;c&gt;&quot;d&quot;');
// long lists continue on more slides instead of overflowing
const many = Array.from({ length: 19 }, (_, i) => ({ id: 'x' + i, name: 'Person ' + i }));
let ms = R.emptyState(); for (const p of many) ms = R.putTarget(ms, { personId: p.id, month: '2026-11', source: 'manual', importedAt: NOW, lines: [line('low', 5, 1), line('mid', 3, 1), line('flagship1', 2, 0)] });
const big = await checkPptx(await R.reportPptx(R.buildReport(ms, [], many, TODAY)));
assert.ok(big.slides.length >= 8, 'people continue on extra slides: ' + big.slides.length);
await checkPptx(await R.reportPptx(R.buildReport(R.emptyState(), [], [], TODAY)));

// ---- understanding a typed request ----------------------------------------------------------------------------------------------------------------------
const P = t => R.parseReportIntent(t, people, TODAY);
assert.deepEqual(P('make a powerpoint report for last month'), { format: 'pptx', month: '2026-10', personId: '', personUnclear: false, summary: 'a PowerPoint file for everyone, 2026-10' });
assert.equal(P('Create an Excel report for Asha').personId, 'p1'); assert.equal(P('Create an Excel report for Asha').format, 'xlsx');
assert.equal(P('give me simple notes of my targets').format, 'notes');
assert.equal(P('prepare a presentation of this month').format, 'pptx'); assert.equal(P('generate a spreadsheet summary').format, 'xlsx');
assert.equal(P('make a monthly performance report').format, 'notes', 'an overview with no file kind becomes simple notes');
assert.equal(P('build an excel report for october').month, '2026-10'); assert.equal(P('make a pptx report for 2026-09').month, '2026-09');
assert.equal(P('make an excel report for november 2026').month, '2026-11');
assert.equal(P('create an excel report for Zorro').personUnclear, true, 'an unknown name is reported, never guessed'); assert.equal(P('create an excel report for Zorro').personId, '');
assert.equal(P('create an excel report for everyone').personUnclear, false);
// a file kind first is enough, without a verb
assert.equal(P('excel report for Asha').format, 'xlsx'); assert.equal(P('excel report for Asha').personId, 'p1'); assert.equal(P('powerpoint of this month').format, 'pptx'); assert.equal(P('a spreadsheet summary for october').month, '2026-10');
assert.equal(P('simple notes of my targets').format, 'notes'); assert.equal(P('report as powerpoint').format, 'pptx'); assert.equal(P('presentation for last month').month, '2026-10');
for (const t of ['excel', 'notes about stock', 'powerpoint', 'excel is great', 'report', 'my notes']) assert.equal(P(t), null, `"${t}" alone is not a report request`);
// the existing report commands are left alone
for (const t of ['set report Fold6 to 6', 'prepare today report', 'check my report', 'give 4 Fold6 to Asha', 'make the report for whatsapp', 'what is my report', 'Turn off auto-detection', 'make 4 Fold6 available']) assert.equal(P(t), null, `"${t}" is not an app-report request`);
assert.equal(R.monthInRequest('last month', '2026-01-05'), '2025-12', 'last month across a year end'); assert.equal(R.monthInRequest('december', '2026-11-18'), '2025-12', 'a month still to come means last year');
if (process.env.REPORT_OUT_DIR) {
  await mkdir(process.env.REPORT_OUT_DIR, { recursive: true });
  await writeFile(join(process.env.REPORT_OUT_DIR, 'AI-LENS-report.xlsx'), Buffer.from(await xlsx.arrayBuffer()));
  await writeFile(join(process.env.REPORT_OUT_DIR, 'AI-LENS-report.pptx'), Buffer.from(await pptx.arrayBuffer()));
  await writeFile(join(process.env.REPORT_OUT_DIR, 'AI-LENS-report.txt'), notes);
}
console.log('report builder ok');
