// RetailLens plan v2, with SYNTHETIC data only: the pasted stock report (read, edit, copy back out), the report checked against scanned phones,
// the person's own segments, and the target levels (70-120). No real report, name or number is used here.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-retail2-'));
const files = ['people', 'phone-names', 'samsung-models', 'retail/types', 'retail/catalog', 'retail/data', 'retail/sales', 'retail/inventory', 'retail/targets', 'retail/stockreport', 'retail/reconcile', 'retail/segments'];
for (const name of files) {
  const source = (await readFile(`src/${name}.ts`, 'utf8')).replace(/from '(\.{1,2}\/[^']+)'/g, (_, path) => `from '${path}.mjs'`);
  await mkdir(dirname(join(dir, name)), { recursive: true });
  await writeFile(join(dir, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const load = name => import(pathToFileURL(join(dir, `${name}.mjs`)).href);
const T = await load('retail/types'), C = await load('retail/catalog'), D = await load('retail/data'), G = await load('retail/targets'),
  P = await load('retail/stockreport'), X = await load('retail/reconcile'), SG = await load('retail/segments');

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
assert.deepEqual(by('A27 5G 8/256GB').partMatch, ['Black', 'Blue', null], 'abbreviations are matched to the colours that were scanned');
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

console.log('retail v2: all checks passed');
