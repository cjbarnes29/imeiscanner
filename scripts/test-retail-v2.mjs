// RetailLens plan v2, with SYNTHETIC data only: the pasted stock report (read, edit, copy back out), the report checked against scanned phones,
// the person's own segments, and the target levels (70-120). No real report, name or number is used here.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-retail2-'));
const files = ['people', 'phone-names', 'samsung-models', 'retail/types', 'retail/catalog', 'retail/data', 'retail/sales', 'retail/inventory', 'retail/targets', 'retail/pace', 'retail/stockreport', 'retail/colours', 'retail/reconcile', 'retail/segments', 'retail/reportsync', 'retail/soldsync', 'retail/targetsummary', 'retail/dashboard', 'retail/forecast', 'retail/colour-dictionary', 'retail/colourlist'];
for (const name of files) {
  const source = (await readFile(`src/${name}.ts`, 'utf8')).replace(/from '(\.{1,2}\/[^']+)'/g, (_, path) => `from '${path}.mjs'`);
  await mkdir(dirname(join(dir, name)), { recursive: true });
  await writeFile(join(dir, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const load = name => import(pathToFileURL(join(dir, `${name}.mjs`)).href);
const T = await load('retail/types'), C = await load('retail/catalog'), D = await load('retail/data'), G = await load('retail/targets'),
  P = await load('retail/stockreport'), PC = await load('retail/pace'), FC = await load('retail/forecast'), X = await load('retail/reconcile'), SG = await load('retail/segments');

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
let seq = 300000;
const imei = () => { const body = '35000000' + String(seq++).padStart(6, '0'); return body + luhn(body); };
const phone = (model, storage, colour, extra = {}) => ({ id: 'p' + seq, imei: imei(), model, personId: 'x', raw: `${storage ? `8GB | ${storage}` : ''}\nColour: ${colour}`, ...extra });

// ---- 1. the pasted report ----------------------------------------------------------------------------------------------------------------
const REPORT = `Location: DEMO
Store: DEMO STORE
Reported By: Tester
Date: Nov 11, 2026
♤■■■■■■■■■■■■■■■♤

Z Flip8 256GB : 00/04
(02,00,02) CRM,PINK,GRPH

Z Fold8 1TB : 00/00
(00,01,00) CRM,GRPH,LVND
───

S26: 00/00
(00,00) 256GB,512GB

S26U 256GB : 00/00
(00,00,00,00) C.VLT,BLK,WT,S.B
───

A07 64GB : 04/15
(02,00,13) Vlt,Grn,Blk

A17 4G 128GB : 00/01
(00,00,01) Gry,Blu,Blk

A27 5G 8/256GB : 00/03
(01,02,00) Blk,Blu,L.Pink

A57 5G 8/256GB : 00/01
(00,00,01,0p) GRY,NVY,LiLc,I.BLU

♤■■■■■■■■■■■■■♤
Total sellout

SAMSUNG

Total Sellout : 5
Total Activation 2
Total SC+:

Apple : 2
Most selling models
18 pro:

NEXT DAY SHIFT:
Aaa: 8am-5pm
Bbb: 3pm-12am`;

const rep = P.parseReport(REPORT, '2026-11-16T00:00:00.000Z');
const items = P.reportItems(rep);
assert.equal(items.length, 8, 'eight model entries');
const flip = items[0];
assert.deepEqual([flip.name, flip.sold, flip.stock, flip.kind], ['Z Flip8 256GB', 0, 4, 'colour']);
assert.deepEqual(flip.parts.map(p => [p.label, p.count]), [['CRM', 2], ['PINK', 0], ['GRPH', 2]]);
assert.equal(P.partsSum(flip), flip.stock, 'colours add up to stock');
assert.equal(items[1].stock, 0); assert.equal(P.partsSum(items[1]), 1, 'a line that disagrees with itself is read as typed (and flagged later)');
const s26 = items[2];
assert.equal(s26.kind, 'storage', 'the S26 line counts storages, not colours'); assert.deepEqual(s26.parts.map(p => p.label), ['256GB', '512GB']);
assert.equal(items.find(i => i.name === 'A07 64GB').sold, 4);
const a57 = items.find(i => i.name.startsWith('A57'));
assert.equal(a57.parts[3].count, null, '"0p" is unreadable, not guessed'); assert.equal(a57.parts[3].raw, '0p'); assert.equal(P.hasUnreadable(a57), true);
assert.equal(rep.dateText, 'Nov 11, 2026'); assert.equal(rep.totalSellout.typed, 5);
assert.equal(P.listedSold(rep), 4, 'sold numbers of the list add up to 4');
assert.equal(P.buildReport(rep), REPORT, 'copied back with nothing changed it is exactly what was pasted');
assert.equal(P.buildReport(P.parseReport(REPORT.replace(/\n/g, '\r\n'))), REPORT, 'Windows line endings are accepted');

// the date, in the report's own style
const out = P.buildReport(rep, { date: new Date(2026, 10, 16) });
assert.match(out, /^Date: Nov 16, 2026$/m); assert.equal(out.replace('Date: Nov 16, 2026', 'Date: Nov 11, 2026'), REPORT);
assert.equal(P.formatDateLike('11/11/2026', new Date(2026, 10, 5)), '05/11/2026'); assert.equal(P.formatDateLike('2026-11-11', new Date(2026, 10, 5)), '2026-11-05'); assert.equal(P.formatDateLike('odd text', new Date(2026, 10, 5)), 'odd text');

// editing: colours change the stock; sold changes; padding and spacing are kept
let edited = P.updateItem(rep, flip.id, { parts: flip.parts.map((p, k) => k === 1 ? { ...p, count: 3 } : p) });
assert.equal(P.reportItems(edited)[0].stock, 7, 'stock follows the colours');
assert.match(P.buildReport(edited), /^Z Flip8 256GB : 00\/07\n\(02,03,02\) CRM,PINK,GRPH$/m);
edited = P.updateItem(edited, flip.id, { sold: 12 });
assert.match(P.buildReport(edited), /^Z Flip8 256GB : 12\/07$/m);
assert.match(P.buildReport(P.updateItem(rep, s26.id, { sold: 1 })), /^S26: 01\/00\n\(00,00\) 256GB,512GB$/m, 'the colon spacing of "S26:" is kept');
assert.match(P.buildReport(P.updateItem(rep, a57.id, { sold: 1 })), /\(00,00,01,0p\) GRY,NVY,LiLc,I\.BLU/, 'an unreadable number is written back as typed');
assert.equal(P.reportItems(rep)[0].stock, 4, 'editing never changes the original');

// the total: left alone unless the person says it includes phones not in the list
assert.match(P.buildReport(P.updateItem(rep, flip.id, { sold: 3 })), /^Total Sellout : 5$/m);
let ack = P.acknowledgeTotal(rep);
assert.deepEqual(ack.totalSellout, { typed: 5, acknowledged: true, extra: 1 });
assert.match(P.buildReport(P.updateItem(ack, flip.id, { sold: 3 })), /^Total Sellout : 8$/m, 'sold 4+3 listed + 1 not listed');

// a new day
const day = P.startNewDay(rep);
const dayText = P.buildReport(day, { date: new Date(2026, 10, 17) });
assert.match(dayText, /^A07 64GB : 00\/15\n\(02,00,13\) Vlt,Grn,Blk$/m, 'sold back to 00, stock and colours stay');
assert.match(dayText, /^Total Sellout : 0$/m); assert.match(dayText, /^Date: Nov 17, 2026$/m);
assert.match(dayText, /^Apple : 2$/m, 'other brands and shifts are kept as typed'); assert.match(dayText, /^Aaa: 8am-5pm$/m);
assert.equal(P.parseReport('nothing here\nat all').entries.every(e => e.t === 'text'), true, 'text with no model lines is all kept text');

// ---- 2. segments (the person's own) ----------------------------------------------------------------------------------------------------
let st = D.emptyState();
assert.equal(SG.segmentDefs(st).length, 7, 'a new install starts with the built-in list');
let r1 = SG.addSegment(st, 'Fold 1'); assert.ok(r1.id); st = r1.state;
assert.equal(SG.addSegment(st, ' fold 1 ').error, 'There is already a segment with that name.');
assert.equal(SG.addSegment(st, '  ').error, 'Type a name for the segment.');
const fold1 = r1.id;
let r2 = SG.addSegment(st, 'Fold 2'); st = r2.state;
assert.equal(SG.segLabel(st, fold1), 'Fold 1'); assert.equal(SG.segLabel(st, 'other'), 'No segment');
st = SG.renameSegment(st, fold1, 'Fold One').state; assert.equal(SG.segLabel(st, fold1), 'Fold One'); st = SG.renameSegment(st, fold1, 'Fold 1').state;
assert.equal(SG.renameSegment(st, fold1, 'Fold 2').error, 'There is already a segment with that name.');
const ids = () => SG.segmentIds(st);
st = SG.moveSegment(st, r2.id, -1); assert.equal(ids().indexOf(r2.id) < ids().indexOf(fold1), true, 'Fold 2 moved up one step is now before Fold 1'); st = SG.moveSegment(st, r2.id, 1); assert.equal(SG.moveSegment(st, ids()[0], -1), st, 'the first one cannot move up');
// models: the catalog says Z Fold8 Ultra (F978) is Flagship 1 by default; the person puts it in Fold 1
assert.equal(C.itemFor(st, 'F978').code, 'F978');
st = SG.assignModels(st, fold1, ['F978', 'F976']);
assert.equal(C.segmentOf(st, 'F978', '2026-11'), fold1); assert.deepEqual(SG.modelsOf(st, fold1).map(i => i.code).sort(), ['F976', 'F978', ...SG.modelsOf(st, fold1).filter(i => !['F976', 'F978'].includes(i.code)).map(i => i.code)].sort());
assert.equal(st.corrections.F978, fold1, 'the assignment is remembered like any segment correction');
// a segment the person's list does not have reads as "not placed" (a model whose catalog segment is a starting name they replaced)
let custom = { ...D.emptyState(), segments: [{ id: 'a', name: 'A' }] };
assert.equal(C.segmentOf(custom, 'A176', '2026-11'), 'other', 'A17 guesses "low", which is not in this list');
// deleting a segment keeps its models, as "No segment"
const before = SG.modelsOf(st, fold1).length; assert.ok(before >= 2);
st = SG.deleteSegment(st, fold1);
assert.equal(SG.segmentIds(st).includes(fold1), false); assert.equal(C.segmentOf(st, 'F978', '2026-11'), 'other');
assert.equal(SG.deleteSegment(st, 'other'), st, '"No segment" cannot be deleted');

// ---- 3. target levels ---------------------------------------------------------------------------------------------------------------------
assert.deepEqual(T.LEVELS, [70, 80, 90, 100, 110, 120]);
const line = { segment: 'a', target: 5, achieved: 1 };
assert.deepEqual(G.needAt(line, 70, 14), { needed: 4, remaining: 3, perDay: 0.3 }, 'blank levels: target x level, rounded up (3.5 -> 4); 3 over 14 days = 0.2142 -> 0.3');
assert.deepEqual(G.needAt({ ...line, levels: { 70: 4, 80: 4, 90: 5, 100: 5, 110: 6, 120: 6 } }, 90, 14), { needed: 5, remaining: 4, perDay: 0.3 }, 'typed levels win');
assert.deepEqual(G.needAt({ ...line, levels: { 70: 1 } }, 70, 14), { needed: 1, remaining: 0, perDay: 0 }, 'already reached');
assert.equal(G.needAt({ ...line, levels: { 70: 4 } }, 80, 14).needed, 4, 'a level left blank falls back to target x level (5 x 0.8)');
const sum = G.summarizeTarget({ personId: 'p', month: '2026-11', lines: [{ ...line, levels: { 110: 6 } }], source: 'manual', importedAt: '' }, {}, '2026-11-17', D.emptyState().rates);
assert.deepEqual(Object.keys(sum.lines[0].at).map(Number), T.LEVELS, 'the summary answers for all six levels');
assert.equal(sum.lines[0].at[110].needed, 6); assert.equal(sum.lines[0].at[110].remaining, 5); assert.equal(sum.lines[0].at[70].remaining, 3);
assert.equal(G.emptyTarget('p', '2026-11', 'manual', 'x', ['k1', 'k2']).lines.length, 2, 'a target starts with the person\'s own segments');

// ---- 4. the report checked against scanned phones ----------------------------------------------------------------------------------------
const state = { ...D.emptyState() };
const scans = [
  phone('SM-A276B/DS', '256GB', 'Black'), phone('SM-A276B/DS', '256GB', 'Blue'), phone('SM-A276B/DS', '256GB', 'Blue'), // A27 5G 8/256: report says Blk1, Blu2, L.Pink0: agrees
  phone('SM-A075F', '64GB', 'Violet'), phone('SM-A075F', '64GB', 'Violet'),                                           // A07 64GB: report says 15, scanned 2
  phone('SM-A175F', '128GB', 'Gray'),                                                                                   // A17 4G 128GB: report Gry 0 Blu 0 Blk 1; scanned Gray 1
  phone('SM-F776B', '256GB', 'Pink', { duplicate: true }),                                                              // a duplicate is not stock
  phone('SM-F776B', '256GB', 'Pink', { id: 'sold1' })                                                                    // marked sold below
];
state.recordMeta = { sold1: { status: 'sold' } };
const rc = X.reconcile(state, rep, scans);
const by = name => rc.lines[items.findIndex(i => i.name === name)];
assert.equal(by('A27 5G 8/256GB').status, 'agree', JSON.stringify(by('A27 5G 8/256GB').issues));
assert.deepEqual(by('A27 5G 8/256GB').partMatch, ['Black', 'Blue', 'Light Pink'], 'abbreviations are matched to the colours that were scanned, and "L.Pink" (not scanned) by the dictionary');
const a07 = by('A07 64GB');
assert.equal(a07.status, 'differ'); assert.ok(a07.issues.some(i => i.kind === 'stock-differs' && /Report stock 15, scanned 2/.test(i.text)));
assert.ok(a07.issues.some(i => i.kind === 'colour-differs' && /Vlt \(Violet\): report 2, scanned 2/.test(i.text)) === false, 'violet agrees (2 and 2), so only the other colours differ');
assert.ok(a07.issues.some(i => i.kind === 'colour-unmatched' || i.kind === 'colour-differs'), 'Blk 13 has no scanned colour: it is pointed out');
const a17 = by('A17 4G 128GB');
assert.equal(a17.code, 'A175', '"4G" in a report name still finds the catalog model'); assert.ok(a17.issues.some(i => i.kind === 'colour-differs' && /Gry/.test(i.text)));
assert.equal(by('S26U 256GB').code, 'S948', '"S26U" means the S26 Ultra'); assert.equal(by('S26U 256GB').status, 'empty', 'no stock in the report and none scanned: nothing to compare, so not "agree"');
assert.ok(rc.summary.empty >= 2 && rc.summary.agree === rc.lines.filter(l => l.status === 'agree').length, 'empty lines are counted on their own, never as agreeing');
assert.equal(by('Z Flip8 256GB').scanned.total, 0, 'a duplicate and a phone marked sold are not in stock');
assert.ok(by('Z Flip8 256GB').issues.some(i => i.kind === 'not-scanned') && by('Z Flip8 256GB').status === 'info', 'stock in the report that was never scanned is information, not an error');
assert.equal(by('Z Fold8 1TB').status, 'differ'); assert.ok(by('Z Fold8 1TB').issues.some(i => i.kind === 'colours-sum' && /add up to 1 but stock says 0/.test(i.text)), 'a line that disagrees with itself');
assert.ok(by('A57 5G 8/256GB').issues.some(i => i.kind === 'unreadable'), 'the "0p" is reported');
assert.equal(by('S26: 00/00'.replace(': 00/00', '')) === undefined, false);
assert.equal(rc.summary.listedSold, 4); assert.equal(rc.summary.totalTyped, 5); assert.equal(rc.summary.totalDiff, 1, 'the total says 5 and the list adds up to 4');
assert.equal(rc.summary.scannedPhones, 6, 'six scanned phones are in stock');

// an abbreviation the catalog does not know is unknown until the person says what it means, then it is remembered
const abbr = P.parseReport('A27 8/256 : 00/03\n(01,02,00) Blk,Blu,L.Pink');
let ra = X.reconcile(state, abbr, scans).lines[0];
assert.equal(ra.status, 'unknown'); assert.equal(ra.code, undefined);
const taught = X.teachAlias(state, 'A27 8/256', 'A276');
ra = X.reconcile(taught, abbr, scans).lines[0];
assert.equal(ra.code, 'A276'); assert.equal(ra.status, 'agree', 'the same abbreviation now matches the three scanned A27 phones');
assert.equal(X.reconcile(taught, P.parseReport('A27 6/128 : 00/01\n(01) Blk'), scans).lines[0].code, 'A276', 'the alias is about the model words, so another storage of it matches too');
assert.equal(X.reconcile(state, P.parseReport('Note 17 : 01/02\n(01,01) Blk,Blu'), scans).lines[0].status, 'unknown');
assert.deepEqual(X.searchModels(state, 'a27 5g').map(i => i.code).includes('A276'), true); assert.deepEqual(X.searchModels(state, ''), []);

// storage line (S26: counts per storage) compared storage by storage
const s26scans = [phone('SM-S942B', '256GB', 'Black'), phone('SM-S942B', '256GB', 'Black'), phone('SM-S942B', '512GB', 'Black')];
const sl = X.reconcile(state, P.parseReport('S26: 00/03\n(02,01) 256GB,512GB'), s26scans).lines[0];
assert.equal(sl.status, 'agree', JSON.stringify(sl.issues));
assert.equal(X.reconcile(state, P.parseReport('S26: 00/03\n(01,02) 256GB,512GB'), s26scans).lines[0].status, 'differ');
// a scanned colour the report line does not list is pointed out, not added
const missing = X.reconcile(state, P.parseReport('A27 5G 8/256GB : 00/03\n(01,02) Blk,Blu'), scans).lines[0];
assert.ok(missing.issues.every(i => i.kind !== 'scanned-colour-missing'), 'all scanned colours are listed here');
const missing2 = X.reconcile(state, P.parseReport('A27 5G 8/256GB : 00/01\n(01) Blk'), scans).lines[0];
assert.ok(missing2.issues.some(i => i.kind === 'scanned-colour-missing' && /2 scanned in Blue/.test(i.text)));

// colour abbreviations
assert.equal(X.bestColour('Vlt', ['Violet', 'Green', 'Black']), 'Violet'); assert.equal(X.bestColour('CRM', ['Cream', 'Graphite']), 'Cream');
assert.equal(X.bestColour('C.VLT', ['Cosmic Violet', 'Black']), 'Cosmic Violet'); assert.equal(X.bestColour('L.Pink', ['Light Pink', 'Pink']), 'Light Pink');
assert.equal(X.bestColour('Blk', ['Black', 'Blue']), 'Black'); assert.equal(X.bestColour('Blu', ['Black', 'Blue']), 'Blue');
assert.equal(X.bestColour('Zzz', ['Black']), null, 'no fit: null'); assert.equal(X.bestColour('Bl', ['Black', 'Blue']), null, 'two equal fits: never a guess');

// ---- 5. saving and loading keeps the new data and refuses junk -------------------------------------------------------------------------
const full = { ...D.emptyState(), segments: [{ id: 'f1', name: 'Fold 1' }], aliases: { a27: 'A276' }, report: rep, recordMeta: { r1: { status: 'given', color: 'Blue' } },
  targets: { '2026-11': { p: { personId: 'p', month: '2026-11', lines: [{ segment: 'f1', target: 5, achieved: 1, levels: { 70: 4, 120: 6 } }], source: 'manual', importedAt: '' } } } };
const back = D.cleanState(JSON.parse(JSON.stringify(full)));
assert.deepEqual(back.segments, full.segments); assert.deepEqual(back.aliases, full.aliases); assert.equal(back.recordMeta.r1.status, 'given');
assert.deepEqual(back.targets['2026-11'].p.lines[0].levels, { 70: 4, 120: 6 }); assert.equal(P.buildReport(back.report), REPORT, 'the saved report survives and copies back unchanged');
const junk = D.cleanState({ segments: [{ id: '', name: 'x' }, 5, { id: 'ok', name: 'Ok' }], aliases: { bad: 'nope', good: 'A276' }, report: { entries: [{ t: 'item' }, 7] }, recordMeta: { z: { status: 'hacked' } },
  targets: { '2026-11': { p: { personId: 'p', lines: [{ segment: 'f1', target: -4, achieved: 'x', levels: { 70: -1, 80: 3, 85: 9 } }] } } } });
assert.deepEqual(junk.segments, [{ id: 'ok', name: 'Ok' }]); assert.deepEqual(junk.aliases, { good: 'A276' }); assert.equal(junk.report, undefined); assert.equal(junk.recordMeta.z.status, undefined);
assert.deepEqual(junk.targets['2026-11'].p.lines[0], { segment: 'f1', target: 0, achieved: 0, levels: { 80: 3 } });
assert.deepEqual(D.cleanState(null).aliases, {}); assert.equal(D.cleanState(undefined).segments, undefined);


// ---- 6. colours of each model --------------------------------------------------------------------------------------------------------------
const K = await load('retail/colours');
assert.equal(K.canonColour('grey'), 'Gray'); assert.equal(K.canonColour(' icy  blue '), 'Icy Blue'); assert.equal(K.canonColour('LIGHT GREY'), 'Light Gray'); assert.equal(K.canonColour(''), '');
// the names of a model: what was typed, the catalog variants, and the colours seen on scanned phones, in one spelling
let cs = D.emptyState();
cs = C.saveItem(cs, { code: 'F776', name: 'Galaxy Z Flip8', abbreviation: 'Z Flip8', segment: 'other', monthly: {}, variants: [{ sku: '', ram: '', storage: '256GB', colors: ['cream', 'Pink'] }], custom: true });
cs = K.addColours(cs, 'F776', ['graphite', 'Grey']);
assert.deepEqual(K.modelColourNames(cs, 'F776', ['CREAM', 'Mint']), ['Cream', 'Graphite', 'Gray', 'Mint', 'Pink'].sort((a, b) => a.localeCompare(b)), 'one spelling, no duplicates');
// what a report abbreviation means: taught first, then the fit rule
assert.equal(K.resolveColour(cs, 'F776', 'GRPH', K.modelColourNames(cs, 'F776')), 'Graphite', 'the fit rule');
assert.equal(K.resolveColour(cs, 'F776', 'XYZ', K.modelColourNames(cs, 'F776')), null, 'no fit, nothing guessed');
cs = K.teachColour(cs, 'F776', 'X.Y.Z', 'charcoal');
assert.equal(K.resolveColour(cs, 'F776', 'xyz', []), 'Charcoal', 'taught, whatever the dots and case'); assert.ok(K.modelColourNames(cs, 'F776').includes('Charcoal'), 'a taught colour joins the model');
assert.equal(K.resolveColour(cs, 'A176', 'XYZ', []), null, 'what is taught for one model is not used for another');
// the report check uses it: the scanned colour is "Charcoal"; "XYZ" only fits once it is taught
const flipReport = P.parseReport('Z Flip8 256GB : 00/01\n(01) XYZ');
const flipScans = [phone('SM-F776B', '256GB', 'charcoal')];
const before2 = X.reconcile(D.emptyState(), flipReport, flipScans).lines[0];
assert.ok(before2.issues.some(i => i.kind === 'colour-unmatched'), 'unknown abbreviation, not taught: pointed out');
const after2 = X.reconcile(cs, flipReport, flipScans).lines[0];
assert.equal(after2.status, 'agree', JSON.stringify(after2.issues)); assert.deepEqual(after2.partMatch, ['Charcoal']);
// scanned colours are compared in one spelling
const greyLine = X.reconcile(D.emptyState(), P.parseReport('A17 5G 128GB : 00/02\n(02) Gry'), [phone('SM-A176B', '128GB', 'grey'), phone('SM-A176B', '128GB', 'Gray')]).lines[0];
assert.equal(greyLine.status, 'agree', JSON.stringify(greyLine.issues)); assert.deepEqual(greyLine.scanned.colours, [{ name: 'Gray', count: 2 }], '"grey" and "Gray" are one colour');
// the edit box: one line per colour, "Name = abbreviations"
const parsed = K.parseColoursText('Cream = CRM, CREAM\nPink = PINK\nGraphite\n  \nGrey = GRY');
assert.deepEqual(parsed.names, ['Cream', 'Pink', 'Graphite', 'Gray']); assert.equal(parsed.aliases.crm, 'Cream'); assert.equal(parsed.aliases.gry, 'Gray');
let ct = K.setModelColours(D.emptyState(), 'F776', parsed);
assert.equal(K.coloursText(ct, 'F776').split('\n')[0], 'Cream = CRM, CREAM'); assert.equal(K.coloursText(ct, 'F776').split('\n')[2], 'Graphite');
assert.equal(K.setModelColours(ct, 'F776', { names: [], aliases: {} }).colours, undefined, 'emptying a model removes its entry');
// saved and loaded: kept; junk dropped
const savedC = D.cleanState(JSON.parse(JSON.stringify(ct)));
assert.deepEqual(savedC.colours.F776.names, ['Cream', 'Pink', 'Graphite', 'Gray']); assert.equal(savedC.colours.F776.aliases.crm, 'Cream');
const junkC = D.cleanState({ colours: { F776: { names: ['Ok', 5, ''], aliases: { 'a-b': 'x', ok: 'Fine', bad: '' } }, bad: { names: ['x'] }, A176: 'nope' } });
assert.deepEqual(junkC.colours, { F776: { names: ['Ok'], aliases: { ok: 'Fine' } } }); assert.equal(D.cleanState({}).colours, undefined);


// ---- 7. a line the person checked, scanned phones going into the report, everyone together on Home ------------------------------------------------
const R = await load('retail/reportsync'), H = await load('retail/dashboard');
{
  // checked: the line still differs, but the person looked at it and saved it
  const rep7 = P.parseReport('A07 64GB : 00/15\n(02,00,13) Vlt,Grn,Blk');
  const item7 = P.reportItems(rep7)[0];
  const scans7 = [phone('SM-A075F', '64GB', 'Violet'), phone('SM-A075F', '64GB', 'Violet')];
  assert.equal(X.reconcile(D.emptyState(), rep7, scans7).lines[0].status, 'differ');
  const checked7 = P.updateItem(rep7, item7.id, { checked: true });
  const c7 = X.reconcile(D.emptyState(), checked7, scans7);
  assert.equal(c7.lines[0].status, 'checked'); assert.ok(c7.lines[0].issues.length > 0, 'the difference is still said'); assert.equal(c7.summary.checked, 1); assert.equal(c7.summary.differ, 0);
  assert.equal(P.buildReport(checked7), P.buildReport(rep7), 'checking a line never changes the report text');
  assert.equal(P.reportItems(D.cleanState(JSON.parse(JSON.stringify({ ...D.emptyState(), report: checked7 }))).report)[0].checked, true, 'checked survives saving');
  assert.equal(X.reconcile(D.emptyState(), P.updateItem(P.parseReport('Zzz 9 : 01/01\n(01) Blk'), 'r0', { checked: true }), []).lines[0].status, 'unknown', 'an unknown model cannot be checked away');

  // scanned phones go into the report by themselves
  const st7 = D.emptyState();
  const text7 = 'A07 64GB : 00/15\n(02,00,13) Vlt,Grn,Blk\n\nS26: 00/00\n(00,00) 256GB,512GB\n\nTotal Sellout : 0';
  const before7 = [phone('SM-A075F', '64GB', 'Violet')];
  const rep0 = R.withBaseline(st7, P.parseReport(text7), before7);
  assert.equal(R.syncScans(st7, rep0, before7).report, rep0, 'right after pasting nothing changes (the phones scanned before are taken as already in the report)');
  const more7 = [...before7, phone('SM-A075F', '64GB', 'Violet'), phone('SM-A075F', '64GB', 'Black')];
  const r1 = R.syncScans(st7, rep0, more7);
  assert.equal(r1.added, 2);
  assert.match(P.buildReport(r1.report), /^A07 64GB : 00\/17\n\(03,00,14\) Vlt,Grn,Blk$/m, 'the colour counts and the stock follow; "Vlt" is the report\'s label for Violet');
  assert.equal(P.reportItems(r1.report)[0].scanAdded, 2); assert.equal(P.reportItems(r1.report)[0].sold, 0, 'sold is never touched');
  assert.equal(R.syncScans(st7, r1.report, more7).report, r1.report, 'running it again changes nothing');
  // a phone of a model the report does not list leaves the stock (sold) and comes back (undo): it is not a new scan, so no new line appears
  const other = phone('SM-A175F', '128GB', 'Black');
  const repOther = R.withBaseline(st7, P.parseReport(text7), [...before7, other]);
  const soldState = { ...st7, recordMeta: { [other.id]: { status: 'sold' } } };
  const goneO = R.syncScans(soldState, repOther, [...before7, other]);
  assert.equal(goneO.report, repOther, 'a phone that is not in the report leaving the stock (sold) changes nothing and does not loop');
  const back = R.syncScans(st7, goneO.report, [...before7, other]);
  assert.equal(back.created, 0, 'coming back from Sold does not make a new line'); assert.equal(back.report, repOther, 'and nothing changes');
  // a phone that was DELETED is forgotten: a later real scan of the same kind is a new scan, not hidden by the old one
  const deleted = R.syncScans(st7, repOther, before7);
  assert.equal(deleted.report.scanBase['A175|128GB|Black'], undefined, 'a deleted phone leaves the baseline');
  const again = R.syncScans(st7, deleted.report, [...before7, phone('SM-A175F', '128GB', 'Black')]);
  assert.equal(again.created, 1, 'a new scan of the same model, storage and colour is counted'); 
  // a colour the line does not have gets its own entry
  const more7b = [...more7, phone('SM-A075F', '64GB', 'Mint')];
  const r2 = R.syncScans(st7, r1.report, more7b);
  assert.match(P.buildReport(r2.report), /^A07 64GB : 00\/18\n\(03,00,14,01\) Vlt,Grn,Blk,Mint$/m);
  // a storage line counts storages
  const r3 = R.syncScans(st7, r2.report, [...more7b, phone('SM-S942B', '256GB', 'Black')]);
  assert.match(P.buildReport(r3.report), /^S26: 00\/01\n\(01,00\) 256GB,512GB$/m);
  // a model the report does not list gets a new line, after the last one and before the totals
  const r4 = R.syncScans(st7, r3.report, [...more7b, phone('SM-S942B', '256GB', 'Black'), phone('SM-A276B/DS', '256GB', 'Black')]);
  assert.equal(r4.created, 1); assert.equal(P.reportItems(r4.report).at(-1).auto, true);
  assert.match(P.buildReport(r4.report), /\(01,00\) 256GB,512GB\nA27 5G 256GB : 00\/01\n\(01\) Black\n\nTotal Sellout : 0$/);
  assert.equal(X.reconcile(st7, r4.report, [...more7b, phone('SM-S942B', '256GB', 'Black'), phone('SM-A276B/DS', '256GB', 'Black')]).lines.at(-1).code, 'A276', 'the new line is a model the app knows');
  // a phone taken out of stock (marked sold) lowers the line again, never below 0
  const gone = { ...st7, recordMeta: { [more7[1].id]: { status: 'sold' } } };
  const r5 = R.syncScans(gone, r1.report, more7);
  assert.equal(r5.removed, 1); assert.match(P.buildReport(r5.report), /^A07 64GB : 00\/16\n\(02,00,14\) Vlt,Grn,Blk$/m);
  // a report pasted before this existed has no baseline: the first run only records it
  const old = R.syncScans(st7, P.parseReport(text7), more7);
  assert.equal(old.added, 0); assert.ok(old.report.scanBase && Object.keys(old.report.scanBase).length > 0);
  assert.deepEqual(D.cleanState(JSON.parse(JSON.stringify({ ...st7, report: r2.report }))).report.scanBase, r2.report.scanBase, 'the baseline is saved');

  // everyone together on Home
  let ov = D.emptyState();
  const tg = (id, lines) => ({ personId: id, month: '2026-11', lines, source: 'manual', importedAt: '2026-11-01T00:00:00.000Z' });
  ov = { ...ov, targets: { '2026-11': { p1: tg('p1', [{ segment: 'low', target: 10, achieved: 2 }]), p2: tg('p2', [{ segment: 'low', target: 10, achieved: 9 }, { segment: 'mid', target: 4, achieved: 4 }]) } } };
  const o = H.overallDashboard(ov, ['p1', 'p2', 'p3'], '2026-11-16');
  assert.equal(o.people, 2, 'a person with no target is left out'); assert.equal(o.totalTarget, 24); assert.equal(o.totalAchieved, 15); assert.equal(o.totalPct, 62.5);
  assert.deepEqual(o.lines.map(l => [l.segment, l.remaining, l.perDay]), [['low', 9, 0.6]], 'all people added up: 8 + 1 still needed, 15 days left; "mid" is reached so it is not listed');
  assert.deepEqual(o.needHelp, [{ personId: 'p1', pct: 20 }], 'only people under 70 %');
  assert.equal(H.overallDashboard(D.emptyState(), ['p1'], '2026-11-16'), undefined, 'no targets: nothing invented');
  // a segment of the person's own is named, not "undefined"
  const own = { ...ov, segments: [{ id: 'low', name: 'Fold 1' }], settings: { ...ov.settings, myPersonId: 'p1' } };
  assert.equal(H.overallDashboard(own, ['p1'], '2026-11-16').lines[0].label, 'Fold 1');
  assert.match(H.todayDashboard(own, [], '2026-11-16').priorities[0].message, /Fold 1/);
}


// ---- 8. a phone marked Sold counts by itself (targets and report); taking it back undoes it ---------------------------------------------------------------
const SS = await load('retail/soldsync');
const TS2 = await load('retail/targetsummary');
{
  const tg = (id, lines) => ({ personId: id, month: '2026-11', lines, source: 'manual', importedAt: '2026-11-01T00:00:00.000Z' });
  const base = { ...D.emptyState(), targets: { '2026-11': { p1: tg('p1', [{ segment: 'low', target: 10, achieved: 2 }]) } }, report: P.parseReport('A07 64GB : 00/15\n(02,00,13) Vlt,Grn,Blk') };
  const ph = [{ ...phone('SM-A075F', '64GB', 'Violet'), id: 's1', personId: 'p1' }, { ...phone('SM-A075F', '64GB', 'Black'), id: 's2', personId: 'p1' }, { ...phone('SM-A075F', '64GB', 'Black'), id: 's3', personId: '' }];
  const day = '2026-11-16';
  const ach = st => st.targets['2026-11'].p1.lines.find(l => l.segment === 'low').achieved;
  const soldOf = st => P.reportItems(st.report)[0].sold;

  // the first run only records what is already marked (phones sold before this existed are taken as counted)
  const first = SS.syncSold({ ...base, recordMeta: { s2: { status: 'sold' } } }, ph, day);
  assert.equal(first.added, 0); assert.deepEqual(Object.keys(first.state.soldLedger), ['s2']); assert.equal(ach(first.state), 2, 'nothing changes on the first run'); assert.equal(soldOf(first.state), 0);
  const zero = SS.syncSold(base, ph, day).state;

  // marked Sold: the owner's Sold goes up in that segment, and the report's Sold goes up
  const sold1 = SS.syncSold({ ...zero, recordMeta: { s1: { status: 'sold' } } }, ph, day);
  assert.equal(sold1.added, 1); assert.equal(ach(sold1.state), 3, 'the owner\'s Sold: 2 -> 3'); assert.equal(soldOf(sold1.state), 1, 'the report line says Sold 1');
  assert.match(P.buildReport(sold1.state.report), /^A07 64GB : 01\/15$/m);
  // Store only: a Held phone is stored and nothing else (not in the report stock, not a sale, and the status survives saving)
  const heldState = { ...zero, recordMeta: { s1: { status: 'held' } } };
  const heldRun = SS.syncSold(heldState, ph, day);
  assert.equal(heldRun.added, 0, 'a held phone is not a sale'); assert.equal(ach(heldRun.state), 2, 'the owner\'s Sold does not move');
  assert.equal(D.cleanState(JSON.parse(JSON.stringify(heldState))).recordMeta.s1.status, 'held', 'held is saved and loaded');
  assert.ok(!(await load('retail/inventory')).inStock(heldState, ph).some(r => r.id === 's1'), 'a held phone is not in the stock that the report is checked against');
  // what was sold on a day (the Targets screen shows it as "today N")
  const e1 = sold1.state.soldLedger.s1;
  assert.deepEqual(SS.soldOnDay(sold1.state, day), { [e1.personId]: { [e1.segment]: 1 } }, 'the sale is counted on the day it was marked');
  assert.deepEqual(SS.soldOnDay(sold1.state, '2000-01-01'), {}, 'another day: nothing');
  assert.equal(D.cleanState(JSON.parse(JSON.stringify(sold1.state))).soldLedger.s1.date, day, 'the day is saved and loaded');
  assert.deepEqual(SS.soldOnDay(first.state, day), {}, 'sales that were there before days were kept are not counted as today');
  assert.equal(SS.syncSold(sold1.state, ph, day).state, sold1.state, 'running it again changes nothing (same state object)');

  // Given is not a sale
  const given = SS.syncSold({ ...sold1.state, recordMeta: { s1: { status: 'sold' }, s2: { status: 'given' } } }, ph, day);
  assert.equal(given.added, 0, 'a phone marked Given is not a sale'); assert.equal(ach(given.state), 3); assert.equal(soldOf(given.state), 1);
  // a sold phone with no owner counts in the report only
  const sold3 = SS.syncSold({ ...sold1.state, recordMeta: { s1: { status: 'sold' }, s3: { status: 'sold' } } }, ph, day);
  assert.equal(ach(sold3.state), 3); assert.equal(soldOf(sold3.state), 2);
  // taken back into stock: the numbers come off again
  const back = SS.syncSold({ ...sold3.state, recordMeta: { s3: { status: 'sold' } } }, ph, day);
  assert.equal(back.undone, 1); assert.equal(ach(back.state), 2); assert.equal(soldOf(back.state), 1);
  // a phone that was deleted keeps its sale (it happened); it only leaves the ledger
  const deleted = SS.syncSold({ ...sold1.state, recordMeta: { s1: { status: 'sold' } } }, ph.filter(p => p.id !== 's1'), day);
  assert.equal(deleted.undone, 0); assert.equal(ach(deleted.state), 3); assert.equal(deleted.state.soldLedger.s1, undefined);
  // a person with no target line gets one (Sold counted, target 0)
  const other = SS.syncSold({ ...zero, recordMeta: { z1: { status: 'sold' } } }, [...ph, { ...phone('SM-A075F', '64GB', 'Black'), id: 'z1', personId: 'p2' }], day);
  assert.deepEqual(other.state.targets['2026-11'].p2.lines, [{ segment: 'low', target: 0, achieved: 1 }]);
  // no report at all: the targets still follow
  const noReport = SS.syncSold({ ...D.emptyState(), targets: base.targets, soldLedger: {}, recordMeta: { s1: { status: 'sold' } } }, ph, day);
  assert.equal(ach(noReport.state), 3);
  // a model the report does not list: the target counts, the report is left alone
  const unlisted = SS.syncSold({ ...zero, recordMeta: { u1: { status: 'sold' } } }, [{ ...phone('SM-A276B/DS', '256GB', 'Black'), id: 'u1', personId: 'p1' }], day);
  assert.equal(soldOf(unlisted.state), 0); assert.equal(P.reportItems(unlisted.state.report).length, 1);
  // saved and loaded: the ledger is kept, junk is dropped
  assert.deepEqual(D.cleanState(JSON.parse(JSON.stringify(sold1.state))).soldLedger, sold1.state.soldLedger);
  assert.deepEqual(D.cleanState({ soldLedger: { ok: { personId: 'p1', segment: 'low', month: '2026-11', code: 'A075', storage: '64GB' }, bad: { segment: '', month: 'x' }, '': {} } }).soldLedger, { ok: { personId: 'p1', segment: 'low', month: '2026-11', code: 'A075', storage: '64GB' } });
  assert.equal(D.cleanState({}).soldLedger, undefined);
}


// ---- 9. less typing: the colour dictionary, answers that are used everywhere, one list for the whole report, levels and months ----------------------------
const CD = await load('retail/colour-dictionary'), CL = await load('retail/colourlist');
{
  // the built-in short forms
  for (const [abbr, name] of [['CRM', 'Cream'], ['GRPH', 'Graphite'], ['LVND', 'Lavender'], ['VLT', 'Violet'], ['Blk', 'Black'], ['WT', 'White'], ['S.B', 'Silver Blue'], ['C.VLT', 'Cosmic Violet'], ['I.BLU', 'Icy Blue'], ['LiLc', 'Lilac'], ['L.Pink', 'Light Pink'], ['GRY', 'Gray'], ['Grn', 'Green']]) assert.equal(CD.dictionaryExact(abbr), name, abbr);
  assert.equal(CD.dictionaryExact('XQZ'), null); assert.equal(CD.dictionaryExact('Bl'), null, 'a short form that could mean two colours is not listed');

  // who answers first: this model's own answer > an answer for every model > the model's colours that fit > the dictionary
  const s0 = D.emptyState();
  assert.deepEqual(K.resolveColourWhy(s0, 'F776', 'CRM', []), { name: 'Cream', source: 'dictionary' });
  assert.deepEqual(K.resolveColourWhy(s0, 'F776', 'GRPH', ['Graphite']), { name: 'Graphite', source: 'fit' });
  const t1 = K.teachColourEverywhere(s0, 'CRM', 'Creme', 'F776');
  assert.deepEqual(K.resolveColourWhy(t1, 'A176', 'CRM', []), { name: 'Creme', source: 'taught' }, 'taught once, used for every model');
  assert.ok(K.modelColourNames(t1, 'F776').includes('Creme'), 'the model the answer was given on gets the colour too');
  const t2 = K.teachColour(t1, 'A176', 'CRM', 'Beige');
  assert.equal(K.resolveColour(t2, 'A176', 'CRM', []), 'Beige'); assert.equal(K.resolveColour(t2, 'F776', 'CRM', []), 'Creme', "a model's own answer wins for that model only");
  assert.equal(K.resolveColour(s0, 'F776', 'XYZ', []), null, 'nothing is guessed');

  // tap suggestions
  assert.equal(K.suggestColours('CRM')[0], 'Cream'); assert.deepEqual(K.suggestColours('XQZ'), []);
  assert.equal(K.suggestColours('LVN', ['Lavender'])[0], 'Lavender'); assert.ok(K.suggestColours('GR').length >= 1 && K.suggestColours('GR').length <= 4);

  // a report fills itself: no typing at all
  const flip = P.parseReport('Z Fold8 256GB : 00/04\n(02,00,02) CRM,GRPH,LVND\n\nZ Fold8 Ultra 256GB : 00/08\n(03,03,02) GRPH,VLT,CRM\n\nA07 64GB : 00/02\n(00,00,02) Vlt,Grn,XQZ');
  const rf = X.reconcile(s0, flip, []).lines;
  assert.deepEqual(rf[0].partMatch, ['Cream', 'Graphite', 'Lavender']); assert.deepEqual(rf[1].partMatch, ['Graphite', 'Violet', 'Cream']); assert.deepEqual(rf[2].partMatch, ['Violet', 'Green', null]);
  // one row per abbreviation for the whole report; only the ones nobody knows are open
  const rows = CL.reportColourLabels(s0, flip, []);
  assert.deepEqual(rows.map(r => [r.label, r.lines, !!r.resolved]).slice(0, 1), [['XQZ', 1, false]], 'the unknown one comes first');
  assert.equal(rows.find(r => r.label === 'GRPH').lines, 2, 'GRPH is used on two lines: one answer covers both');
  assert.equal(rows.filter(r => !r.resolved).length, 1, 'everything else was filled in by itself');
  const answered = CL.reportColourLabels(K.teachColourEverywhere(s0, 'XQZ', 'Mystic Blue'), flip, []);
  assert.equal(answered.filter(r => !r.resolved).length, 0, 'one answer and nothing is left to type'); assert.equal(answered.find(r => r.label === 'XQZ').resolved.name, 'Mystic Blue');
  // all-zero lines are not asked about
  assert.equal(CL.reportColourLabels(s0, P.parseReport('Z Fold8 512GB : 00/00\n(00,00,00) ZZZ,YYY,XXX'), []).length, 0);
  // the colours are compared with the scans only when the scanned phones have a colour set
  const noColour = X.reconcile(s0, P.parseReport('A07 64GB : 00/02\n(00,00,02) Vlt,Grn,Blk'), [{ ...phone('SM-A075F', '64GB', 'x'), raw: '4GB | 64GB' }, { ...phone('SM-A075F', '64GB', 'x'), raw: '4GB | 64GB' }]).lines[0];
  assert.ok(noColour.issues.every(i => i.kind !== 'colour-differs'), 'no colour set on the scanned phones: nothing to compare, nothing invented: ' + JSON.stringify(noColour.issues));
  // saved and loaded
  assert.deepEqual(D.cleanState(JSON.parse(JSON.stringify(t1))).colourAliases, { crm: 'Creme' });
  assert.deepEqual(D.cleanState({ colourAliases: { ok: 'Fine', 'bad key': 'x', empty: '' } }).colourAliases, { ok: 'Fine' }); assert.equal(D.cleanState({}).colourAliases, undefined);

  // levels and months
  assert.deepEqual(G.suggestedLevels(5), { 70: 4, 80: 4, 90: 5, 100: 5, 110: 6, 120: 6 }); assert.deepEqual(G.suggestedLevels(0), { 70: 0, 80: 0, 90: 0, 100: 0, 110: 0, 120: 0 });
  assert.equal(G.prevMonth('2026-11'), '2026-10'); assert.equal(G.prevMonth('2026-01'), '2025-12');
  const tgt = (month, id, lines) => ({ personId: id, month, lines, source: 'manual', importedAt: '2026-01-01T00:00:00.000Z' });
  const m0 = { ...D.emptyState(), targets: { '2026-10': { p1: tgt('2026-10', 'p1', [{ segment: 'low', target: 10, achieved: 8, levels: { 70: 7, 100: 10 } }, { segment: 'mid', target: 4, achieved: 4 }]), p2: tgt('2026-10', 'p2', [{ segment: 'low', target: 20, achieved: 5 }]) }, '2026-11': { p1: tgt('2026-11', 'p1', [{ segment: 'mid', target: 6, achieved: 1 }]) } } };
  assert.equal(G.lastMonthLine(m0, '2026-11', 'p1', 'low').target, 10); assert.equal(G.lastMonthLine(m0, '2026-11', 'p1', 'tablet'), undefined);
  const nm = G.startFromLastMonth(m0, '2026-11');
  assert.equal(nm.added, 2, 'p1 low and p2 low; p1 mid already has a target this month');
  const n1 = nm.state.targets['2026-11'].p1.lines;
  assert.deepEqual(n1.find(l => l.segment === 'low'), { segment: 'low', target: 10, achieved: 0, levels: { 70: 7, 100: 10 } }, 'target and levels come over, sold starts at 0');
  assert.deepEqual(n1.find(l => l.segment === 'mid'), { segment: 'mid', target: 6, achieved: 1 }, 'what is already typed for this month is not touched');
  assert.equal(nm.state.targets['2026-11'].p2.lines[0].target, 20);
  assert.equal(G.startFromLastMonth(nm.state, '2026-11').added, 0, 'running it again adds nothing');
  assert.equal(G.startFromLastMonth(D.emptyState(), '2026-11').added, 0);
}

console.log('retail v2: all checks passed');

{
  const row = (label, target, sold, remaining, perDay, each) => ({ label, target, sold, remaining, perDay, each });
  const text = TS2.targetSummary({ month: '2026-11', level: 90, days: 15, rows: [
    row('Fold 1', 10, 1, 8, 0.6, [{ name: 'Carlou Test', target: 5, sold: 1, remaining: 4, perDay: 0.3, today: 1 }, { name: 'Asha Test', target: 5, sold: 0, remaining: 4, perDay: 0.3 }]),
    row('Mid', 6, 6, 0, 0, [{ name: 'Carlou Test', target: 6, sold: 6, remaining: 0, perDay: 0 }]), row('Tablet', 0, 0, 0, 0, [])] });
  assert.ok(text.startsWith("Targets 2026-11 · 90% · 15 days left")); assert.ok(text.includes("Fold 1: sold 1 of 10 · needs 8 more · 1 a day"), "Fold 1 line: whole numbers, no 0.6/day");
  assert.ok(text.includes("  Carlou Test: 1/5 (today 1) · needs 4 · 1 every 3 days"), "less than one a day says how many days one piece takes"); assert.ok(text.includes("Mid: sold 6 of 6 · 90% reached"), "Mid: sold 6 of 6 · 90% reached");
  assert.ok(!text.includes('Tablet'), 'a segment with no target is not listed'); assert.ok(text.includes("Total: 8 more pieces · 1 a day"), "total line");
  assert.ok(TS2.targetSummary({ month: "2026-11", level: 100, days: 1, rows: [] }).includes("No targets set yet."));
  console.log('target summary ok');
}

// choosing a segment for a model works even when an older "this month only" choice exists (the menu used to jump back)
{
  const month = T.monthOf(new Date());
  const base = D.emptyState();
  const item = C.itemFor(base, 'A075');
  const stuck = C.saveItem(base, { ...item, monthly: { [month]: 'other' } });
  assert.equal(C.segmentOf(stuck, 'A075', month), 'other', 'the older choice wins (this is what looked like "cannot assign")');
  const fixed = C.setModelSegment(stuck, 'A075', 'low');
  assert.equal(C.segmentOf(fixed, 'A075', month), 'low', 'choosing a segment now takes effect');
  const keepsOthers = C.saveItem(base, { ...item, monthly: { [month]: 'other', '2020-01': 'mid' } });
  assert.equal(C.itemFor(C.setModelSegment(keepsOthers, 'A075', 'low'), 'A075').monthly['2020-01'], 'mid', 'other months keep their own choice');
  console.log('catalog segment ok');
}

// the sales ledger is not cut at 5000 sales (a cut would make the newest sales count twice)
{
  const ledger = {};
  for (let i = 0; i < 6000; i++) ledger['r' + i] = { personId: 'p1', segment: 'low', month: '2026-11', code: 'A075', storage: '64GB' };
  assert.equal(Object.keys(D.cleanState({ soldLedger: ledger }).soldLedger).length, 6000, 'all 6000 sales are kept');
  console.log('ledger size ok');
}

// review fixes: a colour taught for every model does not override a model whose own colours fit; last-month copies skip deleted people and levels-only lines
{
  const t = K.teachColourEverywhere(D.emptyState(), 'BLK', 'Phantom Black', 'X999');
  assert.deepEqual(K.resolveColourWhy(t, 'Y111', 'BLK', ['Black']), { name: 'Black', source: 'fit' }, "the model's own colour fits, so the global answer does not override it");
  assert.deepEqual(K.resolveColourWhy(t, 'Y111', 'BLK', []), { name: 'Phantom Black', source: 'taught' }, 'with nothing to fit, the answer given for every model is used');
  const tg = (month, id, lines) => ({ personId: id, month, lines, source: 'manual', importedAt: '2026-01-01T00:00:00.000Z' });
  const st = { ...D.emptyState(), targets: { '2026-10': { gone: tg('2026-10', 'gone', [{ segment: 'low', target: 5, achieved: 1 }]), here: tg('2026-10', 'here', [{ segment: 'low', target: 7, achieved: 0 }, { segment: 'mid', target: 0, achieved: 0, levels: { 70: 3 } }]) } } };
  const r = G.startFromLastMonth(st, '2026-11', ['here']);
  assert.equal(r.added, 1, 'only the person who still exists'); assert.equal(r.state.targets['2026-11'].gone, undefined, 'a deleted person is not copied');
  assert.equal(G.lastMonthLine(st, '2026-11', 'here', 'mid'), undefined, 'a levels-only line is not a last-month target');
  assert.equal(G.lastMonthLine(st, '2026-11', 'here', 'low').target, 7);
  console.log('review fixes ok');
}

// ---- targets 1.39: pace wording, finish dates, the highest level, one-place editing, who a screenshot is for ----------------------------------------------
{
  // per day: whole numbers rounded up; under one a day says how many days one piece takes
  assert.equal(PC.perDayText(0, 10), '', 'nothing to sell, nothing to say');
  assert.equal(PC.perDayText(6, 14), '1 every 2 days', '6 pieces in 14 days');
  assert.equal(PC.perDayText(1, 14), '1 every 14 days');
  assert.equal(PC.perDayText(14, 14), '1 a day'); assert.equal(PC.perDayText(15, 14), '2 a day', 'rounded up, never 1.1/day');
  assert.equal(PC.perDayText(11, 10), '2 a day', '1.1 a day becomes 2: pieces cannot be half'); assert.equal(PC.perDayText(3, 2), '2 a day', '1.5 becomes 2'); assert.equal(PC.perDayText(21, 10), '3 a day', '2.1 becomes 3'); assert.equal(PC.perDayText(20, 10), '2 a day', 'exactly 2 stays 2');
  assert.equal(PC.perDayText(31, 10), '4 a day'); assert.equal(PC.perDayText(5, 0), '5 now', 'month over');
  assert.equal(PC.perDayText(3, 14), '1 every 4 days'); assert.ok(!/\d\.\d/.test(PC.perDayText(7, 20)), 'never a decimal');
  // dates
  assert.equal(PC.shortDate('2026-11-24'), '24 Nov'); assert.equal(PC.addDays('2026-11-28', 5), '2026-12-03'); assert.equal(PC.addDays('2028-02-28', 2), '2028-03-01', 'leap year');
  // finish dates: pace so far this month = sold / days gone
  const F = (remaining, achieved, today, month = '2026-11') => PC.finishAt(remaining, achieved, month, today);
  assert.deepEqual(F(0, 3, '2026-11-10'), { kind: 'reached' });
  assert.deepEqual(F(4, 5, '2026-11-10'), { kind: 'date', date: '2026-11-18' }, '5 sold in 10 days = 0.5 a day; 4 more = 8 days from the 10th');
  assert.deepEqual(F(10, 5, '2026-11-10'), { kind: 'date', date: '2026-11-30' }, 'exactly the last day still counts');
  assert.equal(F(12, 5, '2026-11-10').kind, 'late'); assert.equal(F(12, 5, '2026-11-10').perDay, PC.perDayText(12, 20), 'too slow for the month: says the pace that still makes it (20 days left after today)');
  assert.equal(F(3, 2, '2026-11-02').kind, 'early', 'two days gone is too little to tell'); assert.equal(F(3, 0, '2026-11-12').kind, 'none', 'no sales yet');
  assert.equal(F(3, 2, '2026-12-05').kind, 'over', 'the month is over'); assert.equal(F(3, 2, '2026-10-20', '2026-11').kind, 'early', 'next month has no pace yet');
  assert.equal(PC.finishText(100, { kind: 'date', date: '2026-11-24' }), '100% by 24 Nov'); assert.equal(PC.finishText(70, { kind: 'reached' }), '70% reached');
  assert.match(PC.finishText(120, { kind: 'late', perDay: '3 a day' }), /120% not by month end \(needs 3 a day\)/);
  assert.equal(PC.finishLine({ 70: 0, 100: 4, 120: 12 }, 5, '2026-11', '2026-11-10'), '70% reached · 100% by 18 Nov · 120% not by month end (needs ' + PC.perDayText(12, 20) + ')');

  // the highest level: a segment that stops at 100 % counts 100 % for 110 and 120
  const line = { segment: 'tablet', target: 5, achieved: 5, cap: 100 };
  assert.equal(G.effectiveLevel(line, 120), 100); assert.equal(G.effectiveLevel(line, 70), 70); assert.equal(G.isCapped(line, 120), true); assert.equal(G.isCapped(line, 100), false);
  assert.equal(G.isCapped({ segment: 'low', target: 5, achieved: 0 }, 120), false, 'no cap = no limit');
  assert.deepEqual(G.needAt(line, 120, 14), { needed: 5, remaining: 0, perDay: 0 }, 'capped: 120 % asks for the 100 % pieces, so a finished tablet line is finished');
  assert.deepEqual(G.needAt({ ...line, cap: undefined }, 120, 14), { needed: 6, remaining: 1, perDay: 0.1 }, 'without the cap the same line is still 1 short for 120 %');
  assert.deepEqual(G.needAt({ ...line, achieved: 3, levels: { 100: 6 }, cap: 100 }, 120, 14), { needed: 6, remaining: 3, perDay: 0.3 }, 'a typed 100 % number is used for the capped levels');
  const tgt = { personId: 'a', month: '2026-11', source: 'manual', importedAt: '2026-11-01T00:00:00.000Z', lines: [{ segment: 'tablet', target: 5, achieved: 0, cap: 100 }, { segment: 'low', target: 10, achieved: 0 }] };
  const sum = G.summarizeTarget(tgt, {}, '2026-11-05', { perUnit: { tablet: 100, low: 10 }, multiplier: { 70: 1, 100: 1, 120: 1 }, currency: '' });
  assert.equal(sum.lines[0].at[120].needed, 5, 'summary: capped tablet needs 5 at 120 %'); assert.equal(sum.lines[1].at[120].needed, 12, 'summary: the others still need 12');
  assert.equal(sum.ifReached[120], 5 * 100 + 12 * 10, 'incentive example counts the capped line at 100 %');

  // one place to set a line (the grid and the segment screen)
  let st = D.emptyState();
  st = G.setTargetLine(st, '2026-11', 'a', 'low', { target: 7 });
  assert.deepEqual(st.targets['2026-11'].a.lines, [{ segment: 'low', target: 7, achieved: 0 }], 'creates the person, month and line');
  st = G.setTargetLine(st, '2026-11', 'a', 'low', { achieved: 2, cap: 100 });
  assert.deepEqual(st.targets['2026-11'].a.lines[0], { segment: 'low', target: 7, achieved: 2, cap: 100 });
  st = G.setTargetLine(st, '2026-11', 'a', 'low', { cap: undefined });
  assert.equal('cap' in st.targets['2026-11'].a.lines[0], false, 'an undefined cap removes it');
  assert.equal(G.setTargetLine(st, 'bad', 'a', 'low', { target: 1 }), st, 'a bad month changes nothing');
  // the cap and the learned names survive cleaning (a saved backup is cleaned when restored)
  const cleaned = D.cleanState({ ...st, targets: { '2026-11': { a: { ...st.targets['2026-11'].a, lines: [{ segment: 'tablet', target: 5, achieved: 1, cap: 100 }, { segment: 'low', target: 1, achieved: 0, cap: 95 }] } } }, targetAliases: { 'asha k': 'a', x: 'b', ok: '' } });
  assert.equal(cleaned.targets['2026-11'].a.lines[0].cap, 100, 'a valid cap is kept'); assert.equal('cap' in cleaned.targets['2026-11'].a.lines[1], false, 'a cap that is not a level is dropped');
  assert.deepEqual(cleaned.targetAliases, { 'asha k': 'a' }, 'only real learned names are kept');
  // last month copies the cap
  const lm = G.startFromLastMonth({ ...D.emptyState(), targets: { '2026-10': { a: { personId: 'a', month: '2026-10', source: 'manual', importedAt: 'x', lines: [{ segment: 'tablet', target: 5, achieved: 5, cap: 100 }] } } } }, '2026-11', ['a']);
  assert.equal(lm.state.targets['2026-11'].a.lines[0].cap, 100); assert.equal(lm.state.targets['2026-11'].a.lines[0].achieved, 0, 'sold starts again');

  // who a screenshot or text is for (synthetic names)
  const people = [{ id: 'p1', name: 'Asha Test' }, { id: 'p2', name: 'Bilal Test' }, { id: 'p3', name: 'Carlou Test' }];
  const body = 'Flagship 1  Target 3  Achieved 2\nMid  Target 10  Achieved 7';
  assert.deepEqual(G.findWho('Name: Asha Test\n' + body, people), { personId: 'p1', key: 'asha test', how: 'name' }, 'a Name line');
  assert.equal(G.findWho('Promoter: bilal test\n' + body, people).personId, 'p2', 'case does not matter');
  assert.equal(G.findWho('Good morning Carlou Test\n' + body, people).personId, 'p3', 'a whole name anywhere counts');
  assert.deepEqual(G.findWho('Employee ID: 90017\n' + body, people), { personId: '', key: '90017', how: 'none' }, 'an ID it does not know: it does not guess');
  assert.equal(G.findWho(body, people).personId, '', 'no name at all: nobody is picked');
  assert.equal(G.findWho('Asha Test and Bilal Test\n' + body, people).personId, '', 'two people named: not sure');
  assert.deepEqual(G.findWho('Employee ID: 90017\n' + body, people, { '90017': 'p2' }), { personId: 'p2', key: '90017', how: 'learned' }, 'a learned ID');
  assert.equal(G.findWho('ID: 90017\n' + body, people, { '90017': 'gone' }).personId, '', 'a learned person who was deleted is ignored');
  let learned = G.learnWho(D.emptyState(), 'Employee 90017', 'p2');
  assert.deepEqual(learned.targetAliases, { 'employee 90017': 'p2' }); assert.equal(G.learnWho(learned, 'Employee 90017', 'p2'), learned, 'already known: unchanged');
  assert.equal(G.learnWho(D.emptyState(), 'x', 'p2').targetAliases, undefined, 'a one-letter key is not learned');
  // several people in one pasted text
  const many = G.readTargets('Name: Asha Test\n' + body + '\n\nName: Bilal Test\nFlagship 2  Target 5  Achieved 1\nName: Zed Nobody\nLow  Target 9  Achieved 4', people);
  assert.equal(many.length, 3); assert.deepEqual(many.map(b => b.who.personId), ['p1', 'p2', ''], 'each part has its own person; an unknown name stays unassigned');
  assert.deepEqual(many.map(b => b.parsed.lines.map(l => l.segment)), [['flagship1', 'mid'], ['flagship2'], ['low']]);
  const one = G.readTargets('Name: Asha Test\nEmployee ID: 55\n' + body, people);
  assert.equal(one.length, 1, 'a name and an ID line together are one person'); assert.equal(one[0].parsed.lines.length, 2);
  assert.equal(G.readTargets(body, people).length, 1); assert.equal(G.readTargets('', people).length, 1, 'empty text gives one empty part with a warning');
  assert.ok(G.readTargets('', people)[0].parsed.warnings.length > 0);
  // the shared summary carries the whole-number pace and the finish lines
  const fin = { label: 'Fold 1', target: 10, sold: 4, remaining: 6, perDay: 0.4, finish: '70% reached · 100% by 24 Nov · 120% not by month end (needs 1 a day)', each: [{ name: 'Asha Test', target: 5, sold: 2, remaining: 3, perDay: 0.2, finish: '100% by 26 Nov' }] };
  const sumText = TS2.targetSummary({ month: '2026-11', level: 100, days: 14, rows: [fin] });
  assert.ok(sumText.includes('Fold 1: sold 4 of 10 · needs 6 more · 1 every 2 days')); assert.ok(sumText.includes('  70% reached · 100% by 24 Nov'));
  assert.ok(sumText.includes('  Asha Test: 2/5 · needs 3 · 1 every 4 days')); assert.ok(sumText.includes('    100% by 26 Nov')); assert.ok(sumText.includes('Total: 6 more pieces · 1 every 2 days'));
  assert.ok(!/\d\.\d\/day/.test(sumText), 'no decimal pace in the summary');
  console.log('targets 1.39 ok');
  const cappedSummary = TS2.targetSummary({ month: '2026-11', level: 120, days: 14, rows: [{ ...fin, sold: 10, remaining: 0, capLabel: 'Cap 100%', level: 100, each: [{ ...fin.each[0], cap: 100, level: 100, remaining: 0 }] }] });
  assert.match(cappedSummary, /Cap 100% · 100% reached/);
  assert.doesNotMatch(cappedSummary, /120% reached|All segments reached 120%/);
}

// ---- Home: month outlook (where each segment ends at this pace, what to push and what not) --------------------------------------------------------
{
  const inp = (label, target, sold, needed, top = 120) => ({ segment: label, label, target, sold, needed: { 70: needed[0], 100: needed[1], 120: needed[2] }, top });
  const out = FC.forecast([
    inp('A on track', 10, 5, [7, 10, 12]),          // pace 0.5/day -> 15 by the end: 120 %
    inp('B push', 20, 6, [14, 20, 24]),             // pace 0.6 -> 18: 70 %, and 100 % needs 14 more = 0.7 a day (1.2 x the pace)
    inp('C far', 20, 2, [14, 20, 24]),              // pace 0.2 -> 6: not even 70 %, which needs 3 x the pace
    inp('D done', 10, 12, [7, 10, 12]),             // 120 % reached
    inp('E capped done', 5, 5, [4, 5, 5], 100),     // stops at 100 %, reached
    inp('F capped on track', 5, 3, [4, 5, 5], 100),
    inp('G not worth', 20, 7, [14, 20, 60]),        // 100 % likely; 120 % (60) needs about 4 x the pace
    inp('H none', 0, 0, [0, 0, 0])
  ], '2026-11', '2026-11-10');
  const by = label => out.lines.find(l => l.label === label);
  assert.equal(out.early, false); assert.equal(out.daysAfter, 20, 'from tomorrow to the 30th');
  assert.equal(by('H none'), undefined, 'a segment with no target is not listed');
  assert.equal(by('A on track').advice, 'keep'); assert.match(by('A on track').text, /On track for 120%: about 15 by the end \(150% of 10\)/);
  assert.equal(by('B push').advice, 'push'); assert.match(by('B push').text, /^Push 100%: 14 more \(1 a day\)\. About 18 by the end \(90% of 20\)/); assert.deepEqual(by('B push').next, { level: 100, remaining: 14 });
  assert.equal(by('C far').advice, 'far'); assert.match(by('C far').text, /Unlikely to reach 70%: it needs 12 more \(1 a day\), about 3 times the current pace\. Put the effort on the others/);
  assert.equal(by('D done').advice, 'stop'); assert.match(by('D done').text, /top level \(120%\) is reached\. More sales here add nothing/);
  assert.equal(by('E capped done').advice, 'stop'); assert.match(by('E capped done').text, /top level \(100%\)/, 'a segment that stops at 100% is done at 100%');
  assert.equal(by('F capped on track').advice, 'keep'); assert.match(by('F capped on track').text, /On track for 100%/, 'the cap is the top, so 120% is never asked');
  assert.equal(by('G not worth').advice, 'keep'); assert.match(by('G not worth').text, /Likely 100%\. 120% needs 53 more .*about 4 times the current pace: not worth chasing/);
  assert.deepEqual(out.lines.map(l => l.advice), ['push', 'keep', 'keep', 'keep', 'far', 'stop', 'stop'], 'push first, then keep, then far, then done');
  assert.equal(out.target, 90); assert.equal(out.sold, 40); assert.equal(out.projected, 15 + 18 + 6 + 36 + 15 + 9 + 21, 'the total adds the lines (a finished line keeps going at its own pace)');
  assert.equal(out.projectedPct, Math.round(out.projected / out.target * 100));
  // the first days of the month: no projection, only what the next level needs
  const early = FC.forecast([inp('A', 10, 1, [7, 10, 12])], '2026-11', '2026-11-02');
  assert.equal(early.early, true); assert.equal(early.projected, undefined); assert.equal(early.lines[0].projected, undefined);
  assert.match(early.lines[0].text, /70% needs 6 more \(1 every 4 days\)\. Too early in the month to project\./); assert.equal(early.lines[0].advice, 'keep');
  // nothing sold yet: a small gap is worth pushing, a big one is not
  assert.equal(FC.forecast([inp('A', 3, 0, [2, 3, 4])], '2026-11', '2026-11-10').lines[0].advice, 'push');
  const none = FC.forecast([inp('A', 30, 0, [21, 30, 36])], '2026-11', '2026-11-10').lines[0];
  assert.equal(none.advice, 'far'); assert.match(none.text, /a pace of selling nothing so far cannot reach/);
  // the last day of the month: today is all that is left
  assert.equal(FC.forecast([inp('A', 10, 8, [7, 10, 12])], '2026-11', '2026-11-30').daysAfter, 1);
  // from the real targets: two people added up; a highest level of 100% makes 100% the top
  const mk = (id, cap) => ({ personId: id, month: '2026-11', source: 'manual', importedAt: '2026-11-01T00:00:00.000Z', lines: [{ segment: 'low', target: 10, achieved: 5, ...(cap ? { cap } : {}) }] });
  let st = D.emptyState();
  st = G.putTarget(G.putTarget(st, mk('p1')), mk('p2'));
  let o = FC.outlookFor(st, ['p1', 'p2'], '2026-11-10');
  assert.equal(o.target, 20); assert.equal(o.sold, 10); assert.equal(o.lines.length, 1); assert.match(o.lines[0].text, /On track for 120%/);
  assert.equal(FC.outlookFor(st, ['p1'], '2026-11-10').target, 10, 'one person only');
  assert.equal(FC.outlookFor(st, ['nobody'], '2026-11-10'), undefined, 'no target: no outlook');
  st = G.putTarget(G.putTarget(D.emptyState(), mk('p1', 100)), mk('p2', 100));
  o = FC.outlookFor(st, ['p1', 'p2'], '2026-11-10');
  assert.match(o.lines[0].text, /On track for 100%/, 'both capped at 100%: the top is 100%');
  st = G.putTarget(G.putTarget(D.emptyState(), mk('p1', 100)), mk('p2'));
  assert.match(FC.outlookFor(st, ['p1', 'p2'], '2026-11-10').lines[0].text, /On track for 120%/, 'one of them has no limit: 120% still counts');
  console.log('month outlook ok');
}
