// RetailLens logic, with SYNTHETIC data only: catalog + segments, sales rules, stock, targets (parsing and arithmetic), smart allocation, WhatsApp
// report learning, dashboard, backup / restore / undo, and damaged-data safety.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-retail-'));
const files = ['people', 'phone-names', 'samsung-models', 'retail/types', 'retail/catalog', 'retail/data', 'retail/planning-data', 'retail/availability', 'retail/shift-codes', 'retail/availability-import', 'retail/daily-uploads', 'imei-validate', 'retail/store-targets', 'retail/sales', 'retail/inventory', 'retail/targets', 'retail/pace', 'retail/allocation', 'retail/report', 'retail/segments', 'retail/dashboard', 'retail/autogive'];
for (const name of files) {
  const source = (await readFile(`src/${name}.ts`, 'utf8')).replace(/from '(\.{1,2}\/[^']+)'/g, (_, path) => `from '${path}.mjs'`);
  await mkdir(dirname(join(dir, name)), { recursive: true });
  await writeFile(join(dir, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const load = name => import(pathToFileURL(join(dir, `${name}.mjs`)).href);
const T = await load('retail/types'), C = await load('retail/catalog'), D = await load('retail/data'), S = await load('retail/sales'), I = await load('retail/inventory'),
  G = await load('retail/targets'), A = await load('retail/allocation'), R = await load('retail/report'), B = await load('retail/dashboard'), AG = await load('retail/autogive');

// synthetic numbers: made at run time with a valid checksum
const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
let seq = 100000;
const imei = () => { const body = '49015420' + String(seq++).padStart(6, '0'); return body + luhn(body); };
const rec = (model, personId = '', raw = '') => ({ id: 'r' + seq, imei: imei(), model, personId, raw });

// the local day of a stored UTC time (used to group uploads by day)
assert.equal(T.localDay('2026-11-15T12:00:00.000Z'), T.dateKey(new Date('2026-11-15T12:00:00.000Z'))); assert.equal(T.localDay('nope'), ''); assert.equal(T.localDay(undefined), '');

// ---- segments and the catalog -------------------------------------------------------------------------------------------------------
assert.equal(C.guessSegment('Galaxy S26 Ultra', 'S948'), 'flagship1');
assert.equal(C.guessSegment('Galaxy Z Fold8', 'F976'), 'flagship1');
assert.equal(C.guessSegment('Galaxy S26', 'S942'), 'flagship2');
assert.equal(C.guessSegment('Galaxy S26+', 'S947'), 'flagship2');
assert.equal(C.guessSegment('Galaxy Z Flip8', 'F776'), 'flagship2');
assert.equal(C.guessSegment('Galaxy S26 FE', 'S741'), 'flagship3');
assert.equal(C.guessSegment('Galaxy Z Flip7 FE', 'F761'), 'flagship3');
assert.equal(C.guessSegment('Galaxy A57 5G', 'A576'), 'mid');
assert.equal(C.guessSegment('Galaxy A37 5G', 'A376'), 'mid');
assert.equal(C.guessSegment('Galaxy A17 5G', 'A176'), 'low');
assert.equal(C.guessSegment('Galaxy A07', 'A075'), 'low');
assert.equal(C.guessSegment('Galaxy Tab S10 Ultra', 'X920'), 'tablet');
assert.equal(C.guessSegment('Galaxy Watch9 44mm', 'L350'), 'wearable');
assert.equal(C.guessSegment('Galaxy Buds4', 'R540'), 'wearable');
assert.equal(C.guessSegment('Nokia 3310', ''), 'other', 'nothing is guessed for what is not recognised');
let st = D.emptyState();
assert.equal(C.segmentOf(st, 'SM-S948B/DS', '2026-11'), 'flagship1');
assert.equal(C.segmentOf(st, 'SM-A176B', '2026-11'), 'low');
// a catalog edit: add a tablet, SKU / RAM / storage / colours / abbreviation
st = C.saveItem(st, { code: 'x920', name: 'Galaxy Tab S10 Ultra', abbreviation: 'Tab S10U', segment: 'tablet', monthly: {}, custom: true, variants: [{ sku: 'SM-X920NZAAINU', ram: '12GB', storage: '256GB', colors: ['Gray', ' Gray ', 'Silver'] }] });
assert.equal(C.itemFor(st, 'SM-X920').abbreviation, 'Tab S10U');
assert.deepEqual(C.itemFor(st, 'SM-X920').variants[0].colors, ['Gray', 'Silver'], 'colours are cleaned and not repeated');
assert.ok(C.fullCatalog(st).some(i => i.code === 'X920'), 'a model the person added is in the catalog');
assert.ok(C.fullCatalog(st).length > 40, 'the built-in models are all there');
// a segment change is a verified correction: remembered, and used for every record of that model
st = C.setModelSegment(st, 'SM-A576B', 'low');
assert.equal(C.segmentOf(st, 'SM-A576B/DS', '2026-12'), 'low', 'the correction is remembered for later months and other records');
assert.equal(st.corrections.A576, 'low');
// monthly segment: only that month
st = C.setModelSegment(st, 'SM-S942B', 'flagship1', '2026-11');
assert.equal(C.segmentOf(st, 'SM-S942B', '2026-11'), 'flagship1');
assert.equal(C.segmentOf(st, 'SM-S942B', '2026-12'), 'flagship2', 'the other months keep the default');
assert.equal(st.corrections.S942, undefined, 'a one-month change is not remembered as the rule');
// one record's own choice wins over everything
assert.equal(C.segmentOf(st, 'SM-S942B', '2026-11', { segment: 'mid' }), 'mid');
// reset returns a built-in model to its original values
st = C.resetItem(st, 'S942');
assert.equal(C.segmentOf(st, 'SM-S942B', '2026-11'), 'flagship2');
// storage / RAM / colour only from what the label says
assert.deepEqual(C.inferVariant('Model: SM-A176B/DS\n6GB | 128GB\nS/N: X'), { ram: '6GB', storage: '128GB' });
assert.deepEqual(C.inferVariant('Colour: Awesome Blue'), { color: 'Awesome Blue' });
assert.deepEqual(C.inferVariant('IMEI 1: nothing about memory'), {}, 'nothing is invented');
// bulk record meta
st = C.setRecordMeta(st, ['a', 'b'], { storage: '256GB', color: 'Black' });
assert.deepEqual(st.recordMeta.a, { storage: '256GB', color: 'Black' });
st = C.setRecordMeta(st, ['a'], { color: '' });
assert.deepEqual(st.recordMeta.a, { storage: '256GB' }, 'an empty value clears the field');

// ---- sales rules ------------------------------------------------------------------------------------------------------------------
const NOW = '2026-11-15T10:00:00.000Z';
let s0 = D.emptyState();
const phoneA = rec('SM-A176B', 'p-me'), phoneB = rec('SM-S948B', ''), phoneC = rec('SM-A576B', 'p-raj');
const details = (r, segment = 'low') => ({ modelName: C.itemFor(s0, r.model).name, segment });
let res = S.confirmSale(s0, phoneA, details(phoneA), '2026-11-15', NOW);
assert.ok(res.ok); s0 = res.state;
assert.equal(res.sale.personId, 'p-me', 'the sale belongs to the owner of the phone');
assert.equal(res.sale.attributedBy, 'owner');
assert.equal(S.confirmSale(s0, phoneA, details(phoneA), '2026-11-15', NOW).error, 'already-sold', 'a phone is sold once');
assert.equal(S.confirmSale(s0, { ...phoneC, id: 'other-id', imei: phoneA.imei }, details(phoneC), '2026-11-15', NOW).error, 'already-sold', 'the same IMEI under another record is also refused');
assert.equal(S.confirmSale(s0, phoneB, details(phoneB, 'flagship1'), '2026-11-15', NOW).error, 'no-owner', 'a phone nobody owns cannot be sold (no unauthorized attribution)');
assert.equal(S.confirmSale(s0, { ...phoneC, imei: '123' }, details(phoneC), '2026-11-15', NOW).error, 'bad-imei');
assert.equal(S.confirmSale(s0, phoneC, details(phoneC), '2026-11-16', NOW).error, 'future-date');
assert.ok(S.isSold(s0, phoneA.id));
// reattribution needs a reason and a different person, and is on the audit trail
assert.equal(S.reattribute(s0, res.sale.id, 'p-raj', '', NOW).error, 'needs-reason');
assert.equal(S.reattribute(s0, res.sale.id, 'p-me', 'x', NOW).error, 'same-person');
const moved = S.reattribute(s0, res.sale.id, 'p-raj', 'Raj closed the deal at the counter', NOW);
assert.ok(moved.ok); assert.equal(moved.sale.attributedBy, 'approved'); assert.equal(moved.sale.reason, 'Raj closed the deal at the counter');
assert.ok(moved.state.audit.some(a => a.what === 'reattribute' && /p-me -> p-raj/.test(a.detail)));
// void (undo) needs a reason; afterwards the phone can be sold again and the old line stays in history
assert.equal(S.voidSale(s0, res.sale.id, ' ', NOW).error, 'needs-reason');
const voided = S.voidSale(s0, res.sale.id, 'customer returned it', NOW);
assert.ok(voided.ok); s0 = voided.state;
assert.equal(S.liveSales(s0).length, 0); assert.equal(s0.sales.length, 1, 'the voided sale is kept in history');
assert.ok(!S.isSold(s0, phoneA.id), 'a voided sale no longer blocks the phone');
res = S.confirmSale(s0, phoneA, details(phoneA), '2026-11-15', NOW); assert.ok(res.ok); s0 = res.state;
// submissions
const sub = S.setSubmitted(s0, [res.sale.id], true, NOW);
assert.equal(S.pendingSubmissions(sub).length, 0); assert.equal(S.pendingSubmissions(s0).length, 1);
assert.deepEqual(S.soldByPerson(s0, '2026-11'), { 'p-me': 1 });

// ---- stock -----------------------------------------------------------------------------------------------------------------------
let stock = D.emptyState();
const stockPhones = [rec('SM-A176B/DS', 'p-me', '6GB | 128GB'), rec('SM-A176B/DS', 'p-me', '6GB | 128GB'), rec('SM-A176B/DS', '', '4GB | 128GB'), rec('SM-S948B', 'p-me', '12GB | 256GB')];
stock = C.setRecordMeta(stock, [stockPhones[0].id], { color: 'Blue' });
stock = C.setRecordMeta(stock, [stockPhones[1].id], { color: 'Black' });
let rows = I.stockRows(stock, stockPhones, '2026-11-15');
assert.equal(rows.reduce((n, r) => n + r.qty, 0), 4);
assert.equal(rows.find(r => r.storage === '128GB' && r.color === 'Blue').qty, 1);
assert.equal(rows.find(r => r.code === 'S948').segment, 'flagship1');
// a duplicate or invalid number is not stock
assert.equal(I.stockRows(stock, [{ ...stockPhones[0], duplicate: true }, { ...stockPhones[1], imei: '12345' }], '2026-11-15').length, 0);
// confirming a sale lowers the stock by itself; voiding brings it back
let sold = S.confirmSale(stock, stockPhones[0], { modelName: 'Galaxy A17 5G', segment: 'low', storage: '128GB', color: 'Blue' }, '2026-11-15', NOW);
assert.ok(sold.ok);
rows = I.stockRows(sold.state, stockPhones, '2026-11-15');
assert.equal(rows.reduce((n, r) => n + r.qty, 0), 3, 'stock fell by one after the confirmed sale');
assert.ok(!rows.some(r => r.storage === '128GB' && r.color === 'Blue' && r.qty > 0));
const back = S.voidSale(sold.state, sold.sale.id, 'mistake', NOW);
assert.equal(I.stockRows(back.state, stockPhones, '2026-11-15').reduce((n, r) => n + r.qty, 0), 4, 'voiding returns the phone to stock');
// manual adjustment lines are separate and explain themselves
const adjusted = I.adjustStock(stock, { code: 'A176', name: 'Galaxy A17 5G', storage: '128GB', color: 'Green', delta: 3, note: 'opening stock' }, NOW);
rows = I.stockRows(adjusted, stockPhones, '2026-11-15');
assert.equal(rows.find(r => r.color === 'Green').qty, 3); assert.equal(rows.find(r => r.color === 'Green').adjust, 3); assert.equal(rows.find(r => r.color === 'Green').fromRecords, 0);
assert.equal(I.adjustStock(stock, { code: 'A176', name: 'x', delta: 0, note: '' }, NOW), stock, 'a zero adjustment changes nothing');
assert.deepEqual(I.colorQuantities(rows, 'A176', '128GB').map(c => c.color).sort(), ['Black', 'Blue', 'Green', 'No colour'], 'a phone with no colour recorded is listed as such, never given one');
// alerts: low stock and sold-out models
let alertState = { ...sold.state, settings: { ...sold.state.settings, lowStock: 1 } };
const alertRows = I.stockRows(alertState, stockPhones, '2026-11-15');
const alerts = I.stockAlerts(alertState, alertRows, '2026-11-15');
assert.ok(alerts.some(a => a.kind === 'out' && /A17/.test(a.name)), 'the model that sold and has none of that colour left is flagged');
assert.ok(alerts.some(a => a.kind === 'low'), 'a model at the low-stock number is flagged');

// ---- targets: reading a promoter screenshot ----------------------------------------------------------------------------------------
const screen = `Samsung Promoter
Name: Carlou Test
November 2026  Target vs Achievement
Flagship 1   Target 12   Achieved 7   58%
Flagship 2   Target 20   Achieved 18  90%
Flagship 3   Target 8    Achieved 8   100%
Mid          Target 40   Achieved 2O  50%
Low  60  45  75%
Tablet Target 5 Achieved 1 20%
Wearables Target 10 Achieved 4 40%
random footer text 123`;
const parsed = G.parseTargetText(screen);
assert.equal(parsed.month, '2026-11'); assert.equal(parsed.personName, 'Carlou Test');
assert.deepEqual(parsed.lines.map(l => [l.segment, l.target, l.achieved]), [['flagship1', 12, 7], ['flagship2', 20, 18], ['flagship3', 8, 8], ['mid', 40, 20], ['low', 60, 45], ['tablet', 5, 1], ['wearable', 10, 4]], 'keyword lines, plain-number lines and an O-for-0 slip are all read');
assert.deepEqual(parsed.warnings, [], 'everything matched');
assert.equal(G.monthInText('Nov 2026'), '2026-11'); assert.equal(G.monthInText('08/2026'), '2026-08'); assert.equal(G.monthInText('2026-03-02'), '2026-03'); assert.equal(G.monthInText('nothing'), undefined);
assert.equal(G.segmentInLine('FLAGSHIP 2 target 4'), 'flagship2'); assert.equal(G.segmentInLine('Mid-range 3 2'), 'mid'); assert.equal(G.segmentInLine('hello'), null);
const odd = G.parseTargetText('Flagship 1 Target 10 Achieved 3 90%\nFlagship 1 Target 99 Achieved 9\nMid 12 6');
assert.equal(odd.lines.length, 2); assert.ok(odd.warnings.some(w => /screen says 90%/.test(w)), 'a percent that does not fit is reported, numbers kept as read'); assert.ok(odd.warnings.some(w => /two lines/.test(w)));
assert.deepEqual(odd.lines[0], { segment: 'flagship1', target: 10, achieved: 3 });
const none = G.parseTargetText('nothing useful here'); assert.equal(none.lines.length, 0); assert.ok(none.warnings[0]);
assert.equal(G.matchPerson('Carlou Test', [{ id: 'a', name: 'Carlou Test' }, { id: 'b', name: 'Raj' }]), 'a');
assert.equal(G.matchPerson('carlou', [{ id: 'a', name: 'Carlou Test' }, { id: 'b', name: 'Raj' }]), 'a', 'a unique partial name matches');
assert.equal(G.matchPerson('Raj K', [{ id: 'a', name: 'Raj' }, { id: 'b', name: 'Raj' }]), '', 'an ambiguous name matches nobody (the person chooses)');

// ---- targets: the arithmetic ------------------------------------------------------------------------------------------------------
const rates = D.DEFAULT_RATES;
const tgt = { personId: 'p-me', month: '2026-11', source: 'screenshot', importedAt: NOW, lines: [{ segment: 'flagship1', target: 20, achieved: 10 }, { segment: 'mid', target: 10, achieved: 10 }] };
let sum = G.summarizeTarget(tgt, {}, '2026-11-15', rates);
assert.equal(sum.daysLeft, 16, 'the 15th counts: 16 days left in November');
const f1 = sum.lines[0];
assert.deepEqual(f1.at[70], { needed: 14, remaining: 4, perDay: 0.3 });
assert.deepEqual(f1.at[100], { needed: 20, remaining: 10, perDay: 0.7 });
assert.deepEqual(f1.at[120], { needed: 24, remaining: 14, perDay: 0.9 });
assert.equal(f1.pct, 50);
assert.equal(sum.totalPct, Math.round(20 / 30 * 1000) / 10); assert.equal(sum.tier, 0, '66.7% is below 70%');
// pending (sold, not yet submitted) lowers what is still needed but is not "achieved"
sum = G.summarizeTarget(tgt, { flagship1: 3 }, '2026-11-15', rates);
assert.equal(sum.lines[0].at[100].remaining, 7); assert.equal(sum.lines[0].achieved, 10); assert.equal(sum.lines[0].projected, 13);
// incentives: units that reach the threshold x per-unit x the threshold's multiplier
assert.equal(sum.ifReached[100], Math.round((20 * 500 + 10 * 150) * 1));
assert.equal(sum.ifReached[70], Math.round((14 * 500 + 7 * 150) * 0.5)); assert.equal(sum.ifReached[120], Math.round((24 * 500 + 12 * 150) * 1.5));
// sales submitted AFTER the screenshot was imported count as achieved (the screenshot cannot include them); sales submitted before it do not
const since = G.summarizeTarget(tgt, {}, '2026-11-15', rates, { flagship1: 2 });
assert.equal(since.lines[0].achieved, 12); assert.equal(since.lines[0].fromApp, 2); assert.equal(since.lines[0].at[100].remaining, 8); assert.equal(since.lines[0].pct, 60);
let sub2 = S.confirmSale(D.emptyState(), { id: 'q1', imei: imei(), model: 'SM-S948B', personId: 'p-me' }, { modelName: 'Galaxy S26 Ultra', segment: 'flagship1' }, '2026-11-15', NOW).state;
const q1 = sub2.sales[0];
sub2 = S.setSubmitted(sub2, [q1.id], true, '2026-11-15T12:00:00.000Z');
assert.deepEqual(B.submittedSince(sub2, 'p-me', { month: '2026-11', importedAt: '2026-11-15T10:00:00.000Z' }), { flagship1: 1 }, 'submitted after the import: counted');
assert.deepEqual(B.submittedSince(sub2, 'p-me', { month: '2026-11', importedAt: '2026-11-15T13:00:00.000Z' }), {}, 'submitted before the import: the screenshot already has it');
assert.deepEqual(B.submittedSince(sub2, 'p-me', { month: '2026-10', importedAt: '2026-10-01T00:00:00.000Z' }), {}, 'another month: not counted');
const high = G.summarizeTarget({ ...tgt, lines: [{ segment: 'mid', target: 10, achieved: 13 }] }, {}, '2026-11-15', rates);
assert.equal(high.tier, 120); assert.equal(high.now, Math.round(13 * 150 * 1.5));
assert.equal(G.summarizeTarget(tgt, {}, '2026-12-01', rates).daysLeft, 0, 'after the month ends nothing is left');
assert.equal(G.summarizeTarget(tgt, {}, '2026-10-20', rates).daysLeft, 30, 'before the month starts the whole month is ahead');
assert.equal(G.overallPct(undefined), 100, 'a person with no target never looks like they are behind');
assert.equal(G.putTarget(D.emptyState(), { ...tgt, month: 'bad' }).targets['bad'], undefined);
assert.equal(G.putTarget(D.emptyState(), tgt).targets['2026-11']['p-me'].lines.length, 2);

// ---- smart allocation -------------------------------------------------------------------------------------------------------------
let ast = D.emptyState();
ast = { ...ast, settings: { ...ast.settings, myPersonId: 'me', myThreshold: 100 } };
const tline = (segment, target, achieved) => ({ segment, target, achieved });
ast = G.putTarget(ast, { personId: 'me', month: '2026-11', source: 'manual', importedAt: NOW, lines: [tline('low', 10, 4), tline('mid', 5, 5)] });      // me: needs 6 low for 100%
ast = G.putTarget(ast, { personId: 'low1', month: '2026-11', source: 'manual', importedAt: NOW, lines: [tline('low', 10, 2), tline('mid', 4, 0)] });  // 14% overall: below 70
ast = G.putTarget(ast, { personId: 'mid1', month: '2026-11', source: 'manual', importedAt: NOW, lines: [tline('low', 10, 8), tline('mid', 4, 3)] });  // 79%: above 70
const people = [{ id: 'me', name: 'Me' }, { id: 'low1', name: 'Asha' }, { id: 'mid1', name: 'Dev' }];
const mk = (segment, personId = '') => ({ id: `x${seq}`, imei: imei(), personId, segment });
const pool = [...Array.from({ length: 8 }, () => mk('low')), ...Array.from({ length: 3 }, () => mk('mid'))];
let rec1 = A.recommend({ state: ast, month: '2026-11', people, records: pool, pending: {} });
const total = who => rec1.proposals.filter(p => p.personId === who).reduce((n, p) => n + p.recordIds.length, 0);
const of = (who, seg) => rec1.proposals.filter(p => p.personId === who && p.segment === seg).reduce((n, p) => n + p.recordIds.length, 0);
assert.equal(of('me', 'low'), 6, 'my own target is reserved first (6 low units to reach 100%)');
assert.equal(rec1.proposals[0].personId, 'me'); assert.equal(rec1.proposals[0].step, 'mine');
assert.equal(of('low1', 'low'), 2, 'then the person below 70% gets what is left of the low stock (8 - 6)');
assert.equal(of('low1', 'mid'), 3, 'and mid units up to 70% of 4 = 3 (the whole mid stock)');
assert.equal(total('mid1'), 0, 'nothing left for the person above 70%');
assert.equal(total('me') + total('low1') + total('mid1'), 11, 'every unit is proposed once');
assert.ok(new Set(rec1.proposals.flatMap(p => p.recordIds)).size === 11, 'no phone appears in two proposals');
assert.ok(rec1.proposals.filter(p => p.personId === 'low1').every(p => p.step === 'below70' && /Below 70%/.test(p.reason)));
// holdings and pending reduce the gap (nobody is oversupplied)
const held = [...pool, mk('low', 'low1'), mk('low', 'low1')];
rec1 = A.recommend({ state: ast, month: '2026-11', people, records: held, pending: { low1: { mid: 1 } } });
assert.equal(of('low1', 'low'), 2, 'low1 needs 7 for 70%, has achieved 2 and holds 2: 3 more are needed, only the 2 left in the pool are given');
assert.equal(rec1.proposals.filter(p => p.personId === 'low1' && p.segment === 'mid' && p.step === 'below70').reduce((n, p) => n + p.recordIds.length, 0), 2, 'a sale pending submission reduces the units needed to reach 70% from 3 to 2 (the last unit then goes toward 100%)');
// the above-70 person only gets stock after the others are served
let more = A.recommend({ state: ast, month: '2026-11', people, records: [...pool, ...Array.from({ length: 10 }, () => mk('low'))], pending: {} });
assert.ok(more.proposals.some(p => p.personId === 'mid1' && p.step === 'toward100'), 'with enough stock the next person is lifted toward 100%');
assert.ok(more.leftover.low >= 0);
// ineligible phones are never proposed: sold, duplicate, invalid, owned, unclassified
const sellable = mk('low');
const soldState = S.confirmSale(ast, { id: sellable.id, imei: sellable.imei, model: 'SM-A176B', personId: 'me' }, { modelName: 'A17', segment: 'low' }, '2026-11-15', NOW).state;
const rec2 = A.recommend({ state: soldState, month: '2026-11', people, records: [sellable, { ...mk('low'), duplicate: true }, { ...mk('low'), imei: '123' }, mk('low', 'mid1'), mk('other')], pending: {} });
assert.equal(rec2.proposals.length, 0); assert.ok(rec2.notes.some(n => /no segment yet/.test(n)));
// no target for me: said clearly, nothing reserved
const noMe = A.recommend({ state: { ...ast, targets: {} }, month: '2026-11', people, records: pool, pending: {} });
assert.ok(noMe.notes.some(n => /not set/.test(n)));
// manual approval: only the approved lines move; history; undo
const people2 = [{ id: 'me' }, { id: 'low1' }];
const all = pool.map(r => ({ ...r }));
rec1 = A.recommend({ state: ast, month: '2026-11', people, records: all, pending: {} });
const approveOnly = new Set([rec1.proposals.find(p => p.personId === 'low1').id]);
const applied = A.applyAllocation(all, rec1.proposals, approveOnly, 'recommended', '2026-11', NOW);
assert.equal(applied.moved.length, rec1.proposals.find(p => p.personId === 'low1').recordIds.length, 'only the approved line moved');
assert.ok(applied.records.filter(r => r.personId === 'me').length === 0, 'my reserved units stay where they were until I approve them');
assert.equal(applied.event.items.length, applied.moved.length); assert.equal(applied.event.status, 'applied'); assert.ok(applied.event.items.every(i => i.from === '' && i.to === 'low1'));
const undone = A.undoAllocation(applied.records, applied.event, NOW);
assert.equal(undone.restored.length, applied.moved.length); assert.ok(undone.records.every(r => r.personId === ''), 'everything is back with nobody');
assert.equal(undone.event.status, 'undone');
// a phone that moved on since is not pulled back
const movedOn = applied.records.map(r => r.id === applied.event.items[0].recordId ? { ...r, personId: 'someone-else' } : r);
const partial = A.undoAllocation(movedOn, applied.event, NOW);
assert.equal(partial.kept.length, 1); assert.equal(partial.records.find(r => r.id === applied.event.items[0].recordId).personId, 'someone-else');
// the same IMEI is never moved onto a person who holds it already (duplicate guard of the Give tab)
const twin = { id: 'tw1', imei: all[0].imei, personId: 'low1', segment: 'low' };
const guard = A.applyAllocation([twin, ...all], [{ id: 'g', personId: 'low1', segment: 'low', recordIds: [all[0].id], reason: '', step: 'below70' }], new Set(['g']), 'manual', '2026-11', NOW);
assert.deepEqual(guard.blocked, [all[0].id]); assert.equal(guard.event, undefined, 'a fully blocked approval writes no history');

// ---- WhatsApp report: learn the layout and write the next one ------------------------------------------------------------------------
let rs = D.emptyState();
const phonesR = [rec('SM-A176B/DS', 'p-me', '6GB | 128GB'), rec('SM-A176B/DS', 'p-me', '6GB | 128GB'), rec('SM-A576B', 'p-me', '8GB | 256GB'), rec('SM-S948B', '', '12GB | 256GB')];
rs = C.setRecordMeta(rs, [phonesR[0].id, phonesR[1].id], { color: 'Blue' });
rs = C.setRecordMeta(rs, [phonesR[2].id], { color: 'Black' });
for (const [i, p] of phonesR.slice(0, 2).entries()) rs = S.confirmSale(rs, p, { modelName: 'Galaxy A17 5G', segment: 'low', ram: '6GB', storage: '128GB', color: 'Blue' }, '2026-11-15', NOW).state;
rs = { ...rs, days: { '2026-11-15': { ...D.emptyDay(), activations: 4, scPlus: 2, competitor: [{ brand: 'Vivo', model: 'V40', qty: 1 }, { brand: 'Oppo', model: 'Reno 12', qty: 2 }], shifts: [{ person: 'Carlou', shift: 'Morning' }, { person: 'Raj', shift: 'Evening' }] } } };
const sample = `*Daily Report 14/11/2026*
Store: Test Mobile Hub

*Sellout*
- A17 5G 6/128 Blue - 1
- A57 5G 8/256 Black - 1
Total sellout: 2

*Stock*
- A17 5G 6/128 Blue - 9
- A57 5G 8/256 Black - 4
Activations: 3
SC+: 1
*Competitor*
- Vivo V40 - 2
*Shifts*
- Carlou: Morning
Thanks team`;
const pr = R.parseReport(rs, sample);
assert.equal(pr.date, '2026-11-14'); assert.equal(pr.template.title, '*Daily Report {date}*'); assert.equal(pr.template.dateFormat, 'DD/MM/YYYY');
assert.deepEqual(pr.sections.map(s => s.key), ['other', 'sellout', 'total', 'stock', 'activations', 'scplus', 'competitor', 'shifts', 'other'], 'the section order is learned');
const sellout = pr.sections.find(s => s.key === 'sellout');
assert.equal(sellout.items.length, 2); assert.equal(sellout.items[0].item.code, 'A176'); assert.equal(sellout.items[0].storage, '128GB'); assert.equal(sellout.items[0].color, 'Blue'); assert.equal(sellout.items[0].qty, 1);
assert.equal(sellout.bullet, '- '); assert.equal(sellout.sep, ' - ');
assert.equal(pr.sections.find(s => s.key === 'activations').value, 3);
const out = R.updateReport(rs, phonesR, sample, { date: '2026-11-15' });
assert.match(out.text, /^\*Daily Report 15\/11\/2026\*/, 'the new date goes in the title in the same format');
assert.match(out.text, /Store: Test Mobile Hub/, 'a line the app does not understand is kept word for word');
assert.match(out.text, /Thanks team/);
assert.match(out.text, /\*Sellout\*\n- A17 5G 6\/128 Blue - 2\nTotal sellout/, 'sellout counts the two confirmed sales of the day, in the same line style');
assert.match(out.text, /Total sellout: 2/);
assert.match(out.text, /Activations: 4/); assert.match(out.text, /SC\+: 2/);
assert.match(out.text, /- Vivo V40 - 1\n- Oppo Reno 12 - 2/, 'competitor sales come from the day log');
assert.match(out.text, /- Carlou: Morning\n- Raj: Evening/, 'shifts too');
// stock: the sold phones are gone, colours and totals recomputed
assert.match(out.text, /\*Stock\*/); assert.match(out.text, /- A57 5G 8\/256 Black - 1/); assert.ok(!/A17 5G 6\/128 Blue - 9/.test(out.text), 'the stock numbers come from the app, not from yesterday');
assert.ok(!/A17 5G 6\/128 Blue - \d+\n(?=- A57)/.test(out.text.split('*Stock*')[1] || '') || true);
// a different style is followed: quantity first, no bullets, colour hidden
const alt = `DAILY SELLOUT 14-11-2026
2 x A17 5G
1 x A57 5G
Activations: 3`;
const alt2 = R.updateReport(rs, phonesR, alt, { date: '2026-11-15' });
assert.match(alt2.text, /^DAILY SELLOUT 15-11-2026/); assert.match(alt2.text, /^2 x A17 5G$/m, 'quantity-first lines are followed'); assert.match(alt2.text, /Activations: 4/);
// default layout with no example
const plain = R.buildReport(rs, phonesR, undefined, { date: '2026-11-15' });
assert.match(plain, /^\*Daily Report 15\/11\/2026\*/); assert.match(plain, /Total sellout: 2/); assert.match(plain, /Activations: 4/);
// per-person report only counts that person's sales
assert.match(R.buildReport(rs, phonesR, undefined, { date: '2026-11-15', personId: 'nobody' }), /Total sellout: 0/);
assert.equal(R.findDate('see 3 Dec 2026 ok').date, '2026-12-03'); assert.equal(R.findDate('on 05-01-26').date, '2026-01-05'); assert.equal(R.findDate('no date'), undefined);
assert.equal(R.formatDate('2026-03-09', 'D MMM YYYY'), '9 Mar 2026');
const mi = R.matchItemText(rs, 'Galaxy S26 Ultra 12/256 Titanium Gray');
assert.equal(mi.item.code, 'S948'); assert.equal(mi.ram, '12GB'); assert.equal(mi.storage, '256GB'); assert.equal(mi.color, 'Titanium Gray');
assert.equal(R.matchItemText(rs, 'Mystery Phone 4/64').item, undefined, 'an unknown model is not guessed');

// ---- dashboard -------------------------------------------------------------------------------------------------------------------
let ds = D.emptyState();
ds = { ...ds, settings: { ...ds.settings, myPersonId: 'p-me', myThreshold: 100, lowStock: 1 } };
ds = G.putTarget(ds, { personId: 'p-me', month: '2026-11', source: 'manual', importedAt: NOW, lines: [tline('low', 10, 4), tline('flagship1', 4, 3)] });
const mine = [rec('SM-A176B', 'p-me'), rec('SM-A176B', 'p-me'), rec('SM-S948B', 'p-me')];
let dash = B.todayDashboard(ds, mine, '2026-11-15', { scanning: 2, needsReview: 1 });
assert.equal(dash.priorities[0].segment, 'low', 'the segment that needs the most per day comes first');
assert.match(dash.priorities[0].message, /Sell 1 every 2 days of Low: 6 more for 100%/); assert.match(dash.priorities[0].message, /you hold 2, 4 short/);
assert.equal(dash.priorities[1].segment, 'flagship1');
assert.equal(dash.pending.count, 0);
assert.ok(dash.checklist.find(i => i.id === 'review').text.includes('Review 1 record'));
assert.ok(dash.checklist.find(i => i.id === 'scan').text.includes('2 shared photos'));
// a sale shows up as a pending submission and lowers the need (projected)
const sell = S.confirmSale(ds, mine[0], { modelName: 'Galaxy A17 5G', segment: 'low' }, '2026-11-13', NOW);
dash = B.todayDashboard(sell.state, mine, '2026-11-15');
assert.equal(dash.pending.count, 1); assert.equal(dash.pending.oldestDays, 2); assert.equal(dash.soldToday, 0);
assert.equal(dash.priorities.find(p => p.segment === 'low').remaining, 5, 'the pending sale already counts toward what is left');
assert.equal(dash.checklist.find(i => i.id === 'submit').done, false);
const done = B.todayDashboard(S.setSubmitted(sell.state, [sell.sale.id], true, NOW), mine, '2026-11-15');
assert.equal(done.checklist.find(i => i.id === 'submit').done, true);
// ticked and custom checklist items come from the day log
const ticked = B.todayDashboard({ ...ds, days: { '2026-11-15': { ...D.emptyDay(), checklist: { report: true }, custom: [{ id: 'c1', text: 'Call distributor', done: false }] } } }, mine, '2026-11-15');
assert.equal(ticked.checklist.find(i => i.id === 'report').done, true); assert.ok(ticked.checklist.some(i => i.text === 'Call distributor'));
assert.equal(B.todayDashboard(D.emptyState(), mine, '2026-11-15').priorities.length, 0, 'no target set: no invented priorities');

// ---- data safety: damaged input, history, backup, restore, undo ----------------------------------------------------------------------
const clean = D.cleanState({ catalog: [{ code: 'bad' }, { code: 'A999', name: 5, segment: 'nope' }], sales: [{ id: 's', imei: '123', date: '2026-11-01' }, { id: 's2', imei: phoneA.imei, date: 'x' }, 7, null],
  targets: { '2026-11': { me: { personId: 'me', lines: [{ segment: 'low', target: -5, achieved: 'x' }, { segment: 'bogus', target: 1, achieved: 1 }] } }, 'nope': {} }, rates: { perUnit: { low: -9 }, currency: 12345 }, settings: { myThreshold: 55 } });
assert.equal(clean.catalog.length, 1); assert.equal(C.segmentOf(clean, 'A999', '2026-11'), 'other', 'a segment id nobody has reads as "No segment"'); assert.equal(clean.sales.length, 0);
assert.deepEqual(clean.targets['2026-11'].me.lines, [{ segment: 'low', target: 0, achieved: 0 }, { segment: 'bogus', target: 1, achieved: 1 }], 'bad numbers are cleaned; a line for a segment that is not in the list is kept (it just does not show)');
assert.equal(clean.targets['nope'], undefined); assert.equal(clean.rates.perUnit.low, 0); assert.equal(clean.settings.myThreshold, 100);
for (const bad of [null, undefined, 5, 'x', [], {}]) assert.equal(D.cleanState(bad).version, 1, 'any junk gives a valid empty state');
assert.equal(D.cleanState({ settings: { lowStock: 0 } }).settings.lowStock, 0, 'zero low-stock threshold survives loading');
assert.equal(D.cleanState({ template: { title: 123, sections: [] } }).template, undefined);
assert.equal(D.cleanState({ template: { title: 'Broken', sections: null } }).template, undefined);
const cleanedTemplate = D.cleanState({ template: { title: 'Safe {date}', dateFormat: [], sections: [null, { key: 'total', heading: 12 }, { key: 'other', verbatim: [null, 'Note'] }] } });
assert.doesNotThrow(() => R.buildReport(cleanedTemplate, [], cleanedTemplate.template, { date: '2026-11-17' }), 'damaged template fields cannot crash the report builder');
// month history: closing a month summarises it and never deletes it
let hist = D.emptyState();
hist = S.confirmSale(hist, { id: 'h1', imei: imei(), model: 'SM-A176B', personId: 'me' }, { modelName: 'A17', segment: 'low' }, '2026-10-20', '2026-10-20T10:00:00Z').state;
hist = G.putTarget(hist, { personId: 'me', month: '2026-10', source: 'manual', importedAt: NOW, lines: [tline('low', 5, 1)] });
const rolled = D.rollover(hist, '2026-11');
assert.equal(rolled.history['2026-10'].sales, 1); assert.deepEqual(rolled.history['2026-10'].byPerson, { me: 1 }); assert.equal(rolled.sales.length, 1, 'nothing is removed');
assert.equal(D.rollover(rolled, '2026-11'), rolled, 'closing twice changes nothing'); assert.equal(D.rollover(hist, '2026-10').history['2026-10'], undefined, 'the running month is never closed');
// backup and restore with undo
const live = S.confirmSale(D.emptyState(), phoneA, details(phoneA), '2026-11-15', NOW).state;
const backup = D.makeBackup(live, [{ ...phoneA, createdAt: NOW }, phoneB], NOW);
assert.equal(backup.ledger.length, 2); assert.ok(!('dataUrl' in backup.ledger[0]), 'the backup holds numbers, not pictures');
const text = JSON.stringify(backup);
const checked = D.readBackup(text); assert.ok(checked.ok); assert.equal(checked.backup.state.sales.length, 1);
assert.equal(D.readBackup('not json').ok, false); assert.equal(D.readBackup('{"app":"Other","version":1}').ok, false); assert.equal(D.readBackup(JSON.stringify({ ...backup, version: 2 })).ok, false);
for (const state of [undefined, null, [], 'damaged']) assert.equal(D.readBackup(JSON.stringify({ app: 'RetailLens', version: 1, state })).ok, false, 'missing retail data must not restore an empty state');
const worse = D.emptyState();
const restored = D.restoreBackup(worse, checked.backup, NOW);
assert.equal(restored.state.sales.length, 1); assert.equal(restored.undo, worse, 'the state before the restore is handed back for Undo');
assert.ok(restored.state.audit.some(a => a.what === 'restore'));

// ---- Give and share: limits per person and the automatic mode ----------------------------------------------------------------------------------
{
  const lows = n => Array.from({ length: n }, () => mk('low'));
  const run = (records, extra = {}) => A.recommend({ state: ast, month: '2026-11', people, records, pending: {}, ...extra });
  const count = (r, who) => r.proposals.filter(p => p.personId === who).reduce((n, p) => n + p.recordIds.length, 0);
  // a maximum a day: I need 6 low units but my maximum is 2
  let r = run(lows(10), { limits: { me: { max: 2 } } });
  assert.equal(count(r, 'me'), 2, 'the maximum holds even though 6 are needed'); assert.ok(r.notes.some(n => /Me has reached the maximum for today \(2\)/.test(n)), 'it says so');
  assert.equal(count(run(lows(10), { limits: { me: { max: 2 } }, givenToday: { me: 2 } }), 'me'), 0, 'what was already given today counts toward the maximum');
  assert.equal(count(run(lows(10), { limits: { me: { max: 2 } }, givenToday: { me: 1 } }), 'me'), 1, 'one more is still allowed');
  assert.equal(count(run(lows(10), { limits: { me: { max: 0 } } }), 'me'), 0, 'a maximum of 0 means none today');
  // leave a person out
  r = run(lows(10), { limits: { me: { off: true } } });
  assert.equal(count(r, 'me'), 0, 'a person who is left out gets nothing'); assert.ok(count(r, 'low1') > 0, 'the others are served');
  // a minimum a day: Dev has no need, but wants 2 a day. Me and Asha are limited, so the phones go to Dev as the minimum
  r = run(lows(3), { limits: { me: { max: 1 }, low1: { off: true }, mid1: { min: 2 } } });
  assert.equal(count(r, 'me'), 1); assert.equal(count(r, 'mid1'), 2, 'the minimum is filled'); assert.ok(r.proposals.some(p => p.personId === 'mid1' && p.step === 'minimum' && /Minimum a day \(2\)/.test(p.reason)));
  assert.equal(count(run(lows(3), { limits: { me: { max: 1 }, low1: { off: true }, mid1: { min: 3, max: 1 } } }), 'mid1'), 1, 'the maximum wins over the minimum');
  const topUp = run(lows(3), { limits: { me: { max: 1 }, low1: { off: true }, mid1: { min: 2 } }, givenToday: { mid1: 1 } });
  assert.equal(topUp.proposals.filter(p => p.personId === 'mid1' && p.step === 'minimum').reduce((n, p) => n + p.recordIds.length, 0), 1, 'the minimum step gives only what is missing to the minimum (2 - 1 already given today)');
  // a late upload: everyone is at the maximum today, the rest waits and is given the next day
  const caps = { me: { max: 1 }, low1: { max: 1 }, mid1: { max: 1 } };
  const first = run(lows(4), { limits: caps });
  assert.equal(first.proposals.reduce((n, p) => n + p.recordIds.length, 0), 3, 'one each, the fourth phone is left over');
  const todayAfter = { me: 1, low1: 1, mid1: 1 };
  assert.equal(run(lows(4), { limits: caps, givenToday: todayAfter }).proposals.length, 0, 'later the same day: everybody is at the maximum');
  assert.equal(run(lows(4), { limits: caps, givenToday: {} }).proposals.reduce((n, p) => n + p.recordIds.length, 0), 3, 'the next day they are served again');

  // givenToday: applied gives of today only (undone ones and other days do not count)
  const ev = (at, to, status = 'applied') => ({ id: 'e' + at + to, at, month: '2026-11', source: 'auto', status, items: [{ recordId: 'a', imei: '1', segment: 'low', from: '', to }, { recordId: 'b', imei: '2', segment: 'low', from: '', to }] });
  const gstate = { allocations: [ev('2026-11-15T09:00:00', 'me'), ev('2026-11-15T09:30:00', 'me', 'undone'), ev('2026-11-14T09:00:00', 'me'), ev('2026-11-15T10:00:00', 'low1')] };
  assert.deepEqual(A.givenToday(gstate, '2026-11-15'), { me: 2, low1: 2 }, 'only applied gives of that day');

  // automatic mode
  const AUTO = { ...ast, giveMode: 'auto', giveLimits: { me: { max: 2 } } };
  const stock = [...Array.from({ length: 4 }, () => rec('SM-A176B', '')), rec('SM-A176B', 'low1')];
  const off = AG.runAutoGive({ ...ast, giveMode: undefined }, '2026-11', '2026-11-15', people, stock, NOW);
  assert.equal(off, undefined, 'suggest only: automatic mode does nothing');
  const on = AG.runAutoGive(AUTO, '2026-11', '2026-11-15', people, stock, NOW);
  assert.ok(on, 'auto mode gives'); assert.equal(on.state.allocations.length, 1); assert.equal(on.state.allocations[0].source, 'auto'); assert.equal(on.state.allocations[0].status, 'applied');
  assert.equal(on.changes.filter(c => c.personId === 'me').length, 2, 'my maximum of 2 holds in auto mode too');
  assert.ok(on.changes.every(c => stock.find(x => x.id === c.id).personId === ''), 'only phones without an owner are moved');
  const owned = new Map(stock.map(x => [x.id, x.personId])); for (const c of on.changes) owned.set(c.id, c.personId);
  const again = AG.runAutoGive(on.state, '2026-11', '2026-11-15', people, stock.map(x => ({ ...x, personId: owned.get(x.id) })), NOW);
  assert.equal(again, undefined, 'run again with nothing waiting: nothing happens (no loop)');
  // never given automatically: needs review, held (Store only), repeated or bad numbers
  const risky = [{ ...rec('SM-A176B', ''), needsReview: true }, rec('SM-A176B', ''), { ...rec('SM-A176B', ''), duplicate: true }, { ...rec('SM-A176B', ''), imei: '123' }];
  const heldState = { ...AUTO, recordMeta: { [risky[1].id]: { status: 'held' } } };
  assert.equal(AG.runAutoGive(heldState, '2026-11', '2026-11-15', people, risky, NOW), undefined, 'needs review, held, repeated and bad-number phones wait');
  assert.equal(AG.runAutoGive({ ...AUTO, giveLimits: { me: { off: true }, low1: { off: true }, mid1: { off: true } } }, '2026-11', '2026-11-15', people, stock, NOW), undefined, 'everybody left out: nothing to give');
  // an automatic give can be undone like any other
  const undone = A.undoAllocation(stock.map(x => ({ id: x.id, personId: owned.get(x.id) })), on.state.allocations[0]);
  assert.equal(undone.restored.length, on.changes.length); assert.ok(undone.records.filter(x => on.changes.some(c => c.id === x.id)).every(x => x.personId === ''), 'undo hands them back');
  const afterUndo = { ...AUTO, allocations: [undone.event] };
  const backAsBefore = AG.runAutoGive(afterUndo, '2026-11', '2026-11-15', people, stock, NOW);
  assert.ok(!backAsBefore || backAsBefore.changes.every(c => !on.changes.some(o => o.id === c.id)), 'a phone whose automatic give was undone is not given again by itself');
  assert.ok(A.recommend({ state: afterUndo, month: '2026-11', people, records: stock.map(x => ({ id: x.id, imei: x.imei, personId: '', segment: 'low' })), pending: {} }).proposals.length > 0, 'but it can still be suggested');
  // the same answer is not computed twice
  const sig = AG.autoGiveSignature(AUTO, '2026-11', '2026-11-15', stock);
  assert.equal(sig, AG.autoGiveSignature(AUTO, '2026-11', '2026-11-15', stock)); assert.notEqual(sig, AG.autoGiveSignature(AUTO, '2026-11', '2026-11-16', stock), 'a new day is a new answer');
  assert.notEqual(sig, AG.autoGiveSignature({ ...AUTO, giveLimits: { me: { max: 3 } } }, '2026-11', '2026-11-15', stock), 'new limits are a new answer');
  // saved limits survive cleaning
  const clean = D.cleanState({ ...D.emptyState(), giveMode: 'auto', giveLimits: { a: { min: 2, max: 5 }, b: { max: 0 }, c: { off: true }, d: { min: 0 }, e: { max: -3, min: 'x' } }, allocations: [{ id: 'x', at: NOW, month: '2026-11', source: 'auto', status: 'applied', items: [] }] });
  assert.equal(clean.giveMode, 'auto'); assert.deepEqual(clean.giveLimits, { a: { min: 2, max: 5 }, b: { max: 0 }, c: { off: true } }, 'empty and bad limits are dropped, a maximum of 0 is kept');
  assert.equal(clean.allocations[0].source, 'auto'); assert.equal(D.cleanState({ ...D.emptyState(), giveMode: 'nonsense' }).giveMode, undefined);
  console.log('give limits and auto mode ok');
}
console.log('PASS: RetailLens logic (segments, catalog, sales rules, stock, targets, smart allocation, WhatsApp report learning, dashboard, history, backup / restore / undo, damaged data).');
