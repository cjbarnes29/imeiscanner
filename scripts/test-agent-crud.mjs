// Phase 4: the rest of create / read / update / delete per module. Every new operation is previewed first, applied only when approved (a removal only when explicitly
// confirmed), verified by reading the stored data back, and undone exactly. Reads change nothing. Synthetic names and IMEIs only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export { queueAssistant, commitAssistantRequestVerified } from './src/AssistantReview'; export { toolOf, confirmLevel } from './src/agent/registry'; export { previewAssistant } from './src/retail/assistant-actions'; export { emptyState, cleanState } from './src/retail/data'; export { setTargetLine } from './src/retail/targets'; export { parseReport } from './src/retail/stockreport';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-agent-crud-'));
const file = join(dir, 'crud.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { queueAssistant, commitAssistantRequestVerified, toolOf, confirmLevel, previewAssistant, emptyState, cleanState, setTargetLine, parseReport } = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const today = '2026-11-19', month = '2026-11';
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const baseRecords = () => Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: i < 8 ? 'p1' : '', name: 'r' + i, createdAt: '2026-11-18T0' + (i % 10) + ':00:00Z', raw: 'Galaxy Z Fold6' }));
function seed() {
  let st = emptyState();
  st = { ...st, workSchedules: { p1: { offWeekdays: [], offDates: [], annualLeave: [{ id: 'l1', start: '2026-11-20', end: '2026-11-22' }] } } };
  st = setTargetLine(st, month, 'p1', 'flagship1', { target: 12, achieved: 3 });
  st = { ...st, reportDrafts: { '2026-11-20': { report: parseReport('Daily Report 2026-11-20\nGalaxy Z Fold6 : 03/10'), mode: 'manual', updatedAt: '2026-11-19T00:00:00Z' } } };
  st = { ...st, assistantRoutines: [{ id: 'r1', text: 'give phones by the limits', enabled: true, time: '09:00', days: [] }, { id: 'r2', text: "prepare today's report", enabled: true, time: '18:00', days: [] }] };
  st = { ...st, recordMeta: { r10: { status: 'given' }, r11: { status: 'given' }, r12: { status: 'given' } } };
  return st;
}
function world(faithful = true) {
  const w = { state: { ...seed(), assistantRequests: [] }, people: people.map(p => ({ ...p })), recs: baseRecords(), notes: [] };
  const disk = { retail: structuredClone(w.state), people: structuredClone(w.people), recs: structuredClone(w.recs) };
  w.ctx = {
    get state() { return w.state; }, latest: () => w.state, readOnly: false, today, notify: t => w.notes.push(t),
    get records() { return w.recs; }, latestRecords: () => w.recs, get people() { return w.people; }, latestPeople: () => w.people,
    change: next => { w.state = next; if (faithful) disk.retail = structuredClone(next); },
    editPeople: ops => { for (const op of ops) { if (op.kind === 'add') w.people.push({ id: op.id, name: op.name }); else if (op.kind === 'rename') w.people = w.people.map(p => p.id === op.id ? { ...p, name: op.to } : p); else w.people = w.people.filter(p => p.id !== op.id); } if (faithful) disk.people = structuredClone(w.people); return true; },
    assign: changes => { const owner = new Map(changes.map(c => [c.id, c.personId])); w.recs = w.recs.map(r => owner.has(r.id) ? { ...r, personId: owner.get(r.id) } : r); if (faithful) disk.recs = structuredClone(w.recs); return true; },
    readPersisted: async () => ({ retail: cleanState(disk.retail), people: disk.people.map(p => ({ id: p.id, name: p.name })), records: disk.recs.map(r => ({ id: r.id, personId: r.personId })), settings: {} }),
  };
  return w;
}
const fast = { verify: { timeoutMs: 400, intervalMs: 30 } };
const prev = (w, text) => previewAssistant(w.state, w.recs, w.people, today, text);
const lines = p => p.lines.join(' | ');
const owners = w => w.recs.filter(r => r.personId === 'p1').length;

// ---- reads change nothing ----------------------------------------------------------------------------------------------------------------------------
{
  const w = world();
  let p = prev(w, 'when is asha off'); assert.ok(p.handled && !p.business && !p.moves); assert.match(lines(p), /2026-11-20 to 2026-11-22/);
  assert.match(lines(prev(w, 'show asha leave')), /2026-11-20 to 2026-11-22/); assert.match(lines(prev(w, 'when is bilal off')), /No leave is saved for Bilal/);
  assert.equal(prev(w, 'who is off tomorrow').handled, false, 'questions about everyone stay with the saved-data answers');
  p = prev(w, "what is asha's flagship 1 target"); assert.match(lines(p), /Asha · Flagship 1: target 12, achieved 3/); assert.ok(!p.business);
  assert.equal(prev(w, 'show my targets').handled, false, 'no person named: the older answer is kept');
  p = prev(w, 'how many phones does asha have'); assert.match(lines(p), /Asha has 8 phones: .*× 8/); assert.match(lines(prev(w, 'how many phones does bilal have')), /Bilal has 0 phones/);
  p = prev(w, 'list my routines'); assert.match(lines(p), /2 routines[\s\S]*09:00/); assert.ok(!p.business);
}

// ---- calendar: cancel, move, extend ---------------------------------------------------------------------------------------------------------------------
{
  const w = world(); const q = queueAssistant(w.ctx, "cancel asha's leave"); assert.ok(q.pending, q.output);
  assert.equal(toolOf(prev(w, "cancel asha's leave"), "cancel asha's leave").name, 'calendar.delete');
  await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, fast), /explicit confirmation/, 'a removal is refused without an explicit confirmation');
  assert.equal(w.state.workSchedules.p1.annualLeave.length, 1, 'nothing was removed');
  const done = await commitAssistantRequestVerified(w.ctx, q.id, { confirmed: true, ...fast }); assert.equal(done.verify.status, 'verified'); assert.equal(w.state.workSchedules.p1.annualLeave.length, 0);
  assert.equal(w.state.agentLog.at(-1).tool, 'calendar.delete'); assert.equal(w.state.agentLog.at(-1).risk, 'destructive');
  const back = await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(back.verify.status, 'verified'); assert.deepEqual(w.state.workSchedules.p1.annualLeave, [{ id: 'l1', start: '2026-11-20', end: '2026-11-22' }], 'undo needs no confirmation and restores it exactly');
}
{
  const w = world();
  let q = queueAssistant(w.ctx, "move asha's leave from 2026-11-20 to 2026-11-25"); assert.ok(q.pending, q.output); assert.match(lines(prev(w, "move asha's leave from 2026-11-20 to 2026-11-25")), /2026-11-20 to 2026-11-22 → 2026-11-25 to 2026-11-27/, 'the length of the leave is kept');
  assert.equal(toolOf(prev(w, "move asha's leave from 2026-11-20 to 2026-11-25"), "move asha's leave from 2026-11-20 to 2026-11-25").name, 'calendar.update');
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, fast)).verify.status, 'verified'); assert.equal(w.state.workSchedules.p1.annualLeave[0].start, '2026-11-25');
  await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(w.state.workSchedules.p1.annualLeave[0].start, '2026-11-20');
  q = queueAssistant(w.ctx, "extend asha's leave until 2026-11-30"); assert.ok(q.pending, q.output); await commitAssistantRequestVerified(w.ctx, q.id, fast); assert.equal(w.state.workSchedules.p1.annualLeave[0].end, '2026-11-30');
  assert.match(prev(w, "move bilal's leave from 2026-11-20 to 2026-11-25").blockers[0], /Choose one saved person|no leave saved/);
  assert.match(prev(w, "cancel asha's leave on 2026-12-24").blockers[0], /no leave saved on 2026-12-24/);
}

// ---- targets: clear ------------------------------------------------------------------------------------------------------------------------------------
{
  const w = world(); const text = "clear asha's flagship 1 target"; const q = queueAssistant(w.ctx, text); assert.ok(q.pending, q.output);
  assert.equal(toolOf(prev(w, text), text).name, 'targets.delete'); assert.match(lines(prev(w, text)), /target 12 → 0/);
  await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, fast), /explicit confirmation/);
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, { confirmed: true, ...fast })).verify.status, 'verified');
  const line = () => w.state.targets[month].p1.lines.find(l => l.segment === 'flagship1'); assert.equal(line().target, 0); assert.equal(line().achieved, 3, 'achieved numbers are never changed');
  await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(line().target, 12);
  assert.match(prev(w, "clear asha's targets").blockers[0], /Say which target/); assert.match(prev(w, "clear bilal's flagship 1 target").blockers[0], /no Flagship 1 target to clear/);
}

// ---- gives: move between people, take back ------------------------------------------------------------------------------------------------------------
{
  const w = world(); const text = 'move 2 fold6 from asha to bilal'; const q = queueAssistant(w.ctx, text); assert.ok(q.pending, q.output);
  assert.equal(toolOf(prev(w, text), text).name, 'gives.update'); assert.equal(confirmLevel(toolOf(prev(w, text), text), prev(w, text)), null, 'a move is not destructive');
  const done = await commitAssistantRequestVerified(w.ctx, q.id, fast); assert.equal(done.verify.status, 'verified', done.message); assert.equal(owners(w), 6); assert.equal(w.recs.filter(r => r.personId === 'p2').length, 2);
  assert.ok(w.state.agentLog.at(-1).checks >= 3, 'every moved phone owner was read back');
  w.recs = w.recs.map(r => r.id === 'r0' ? { ...r, personId: 'p9' } : r); // someone moved one of them since
  await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }), /changed owner after this action/, 'newer changes are never overwritten');
}
{
  const w = world(); const text = 'move 2 fold6 from asha to bilal'; const q = queueAssistant(w.ctx, text);
  await commitAssistantRequestVerified(w.ctx, q.id, fast); await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(owners(w), 8, 'undo gives the phones back'); assert.equal(w.recs.filter(r => r.personId === 'p2').length, 0);
  assert.match(prev(w, 'move 20 fold6 from asha to bilal').blockers[0], /has only 8 matching/); assert.match(prev(w, 'move 2 fold6 from asha to asha').blockers[0], /already with that person/); assert.match(prev(w, 'move 2 fold6 from nobody to bilal').blockers[0], /Name one saved person/);
}
{
  const w = world(); const text = 'take back 2 fold6 from asha'; const p = prev(w, text);
  assert.ok(p.moves.length === 2 && p.moves.every(m => m.to === '')); assert.equal(toolOf(p, text).name, 'gives.delete'); assert.equal(confirmLevel(toolOf(p, text), p), 'minor');
  const q = queueAssistant(w.ctx, text); await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, fast), /explicit confirmation/); assert.equal(owners(w), 8);
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, { confirmed: true, ...fast })).verify.status, 'verified'); assert.equal(owners(w), 6); assert.equal(w.recs.length, 30, 'phones become Unassigned, none is deleted');
  await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(owners(w), 8);
  const big = prev(w, 'take back 6 fold6 from asha'); assert.equal(confirmLevel(toolOf(big, 'take back 6 fold6 from asha'), big), 'major', 'more than 5 phones needs the typed confirmation');
  assert.equal(prev(w, 'take 2 fold6 out of stock').moves, undefined, 'removing from stock is still only a status change');
}

// ---- stock: restore ------------------------------------------------------------------------------------------------------------------------------------
{
  const w = world(); const text = 'restore 2 fold6 to stock'; const q = queueAssistant(w.ctx, text); assert.ok(q.pending, q.output);
  assert.equal(toolOf(prev(w, text), text).name, 'stock.update');
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, fast)).verify.status, 'verified'); assert.equal(Object.values(w.state.recordMeta).filter(m => m.status === 'given').length, 1, 'two of the three removals are cleared'); assert.equal(w.recs.length, 30);
  await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(Object.values(w.state.recordMeta).filter(m => m.status === 'given').length, 3);
  assert.match(prev(w, 'restore 5 fold6 to stock').blockers[0], /Only 3 matching removed/);
}

// ---- reports: discard a draft ---------------------------------------------------------------------------------------------------------------------------
{
  const w = world(); const text = 'discard the report draft for 2026-11-20'; const p = prev(w, text); assert.ok(p.business && !p.report); assert.equal(toolOf(p, text).name, 'reports.delete');
  const q = queueAssistant(w.ctx, text); await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, fast), /explicit confirmation/); assert.ok(w.state.reportDrafts['2026-11-20']);
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, { confirmed: true, ...fast })).verify.status, 'verified'); assert.equal(w.state.reportDrafts['2026-11-20'], undefined);
  await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.ok(w.state.reportDrafts['2026-11-20'], 'the draft is back');
  assert.match(prev(w, "discard today's report draft").blockers[0], /no saved report draft for 2026-11-19/);
}

// ---- routines: pause, resume, delete -------------------------------------------------------------------------------------------------------------------
{
  const w = world(); let text = 'pause the 9:00 routine'; let p = prev(w, text); assert.equal(toolOf(p, text).name, 'routines.update'); let q = queueAssistant(w.ctx, text);
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, fast)).verify.status, 'verified'); assert.equal(w.state.assistantRoutines.find(r => r.id === 'r1').enabled, false);
  assert.match(prev(w, 'pause the 9:00 routine').blockers[0], /already paused/); text = 'resume the 9:00 routine'; q = queueAssistant(w.ctx, text); await commitAssistantRequestVerified(w.ctx, q.id, fast); assert.equal(w.state.assistantRoutines.find(r => r.id === 'r1').enabled, true);
  text = 'delete the report routine'; p = prev(w, text); assert.equal(toolOf(p, text).name, 'routines.delete'); q = queueAssistant(w.ctx, text);
  await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, fast), /explicit confirmation/); assert.equal(w.state.assistantRoutines.length, 2);
  await commitAssistantRequestVerified(w.ctx, q.id, { confirmed: true, ...fast }); assert.equal(w.state.assistantRoutines.length, 1); await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(w.state.assistantRoutines.length, 2);
  assert.match(prev(w, 'delete the zzz routine').blockers[0], /No routine matches/);
}

// ---- how firmly a removal is confirmed; people deletes -------------------------------------------------------------------------------------------------
{
  const w = world();
  const del = text => { const p = prev(w, text); return confirmLevel(toolOf(p, text), p); };
  assert.equal(del('delete bilal'), 'minor', 'a person with no phones: press and hold'); assert.equal(del('delete asha'), 'major', 'a person who holds phones: typed confirmation');
  assert.equal(del('remove 2 fold6 from stock'), 'minor'); assert.equal(del('remove 8 fold6 from stock'), 'major', 'more than 5 phones');
  assert.equal(del('give 2 fold6 to bilal'), null); assert.equal(del('store 2 fold6'), null);
  const q = queueAssistant(w.ctx, 'delete bilal'); await assert.rejects(() => commitAssistantRequestVerified(w.ctx, q.id, fast), /explicit confirmation/); assert.equal(w.people.length, 2, 'the person is still there');
  assert.equal((await commitAssistantRequestVerified(w.ctx, q.id, { confirmed: true, ...fast })).verify.status, 'verified'); assert.equal(w.people.length, 1);
}

// ---- a lost save is still caught for the new operations --------------------------------------------------------------------------------------------------
{
  const w = world(false); const q = queueAssistant(w.ctx, 'move 2 fold6 from asha to bilal'); const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.verify.status, 'unverified'); assert.match(done.message, /could not confirm/);
}
console.log('agent crud: calendar, targets, gives, stock, reports and routines - preview, confirm, apply, verify and exact undo all checked');
process.exit(0);
