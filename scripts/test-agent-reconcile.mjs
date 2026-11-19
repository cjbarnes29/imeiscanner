// Cross-store consistency: a lost write is repaired once and re-checked; a change left unconfirmed by a closed app is re-checked on the next start;
// older or already-checked changes are never touched. Synthetic data only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export { queueAssistant, commitAssistantRequest, commitAssistantRequestVerified, reconcileRecent } from './src/AssistantReview'; export { emptyState, cleanState } from './src/retail/data'; export { latestUnconfirmed, receiptInput, missingFrom } from './src/agent/reconcile';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-reconcile-'));
const file = join(dir, 'r.mjs'); await writeFile(file, bundled.outputFiles[0].text);
const { queueAssistant, commitAssistantRequest, commitAssistantRequestVerified, reconcileRecent, emptyState, cleanState, latestUnconfirmed, receiptInput, missingFrom } = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const today = '2026-11-19';
// `lose` = how many writes of each store are silently lost before it behaves again (a crash or a failed save)
function world({ loseOwners = 0, losePeople = 0, loseRetail = 0 } = {}) {
  const w = { state: { ...emptyState(), assistantRequests: [] }, people: [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }], recs: Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: '', name: 'r' + i, createdAt: '2026-11-18T0' + (i % 10) + ':00:00Z', raw: 'Galaxy Z Fold6' })) };
  const disk = { retail: structuredClone(w.state), people: structuredClone(w.people), recs: structuredClone(w.recs) }, lost = { owners: loseOwners, people: losePeople, retail: loseRetail };
  w.disk = disk;
  w.ctx = {
    get state() { return w.state; }, latest: () => w.state, readOnly: false, today, notify() {},
    get records() { return w.recs; }, latestRecords: () => w.recs, get people() { return w.people; }, latestPeople: () => w.people,
    change: next => { w.state = next; if (lost.retail > 0) lost.retail--; else disk.retail = structuredClone(next); },
    editPeople: ops => { for (const op of ops) { if (op.kind === 'add') { if (!w.people.some(p => p.id === op.id)) w.people.push({ id: op.id, name: op.name }); } else if (op.kind === 'rename') w.people = w.people.map(p => p.id === op.id ? { ...p, name: op.to } : p); else w.people = w.people.filter(p => p.id !== op.id); } if (lost.people > 0) lost.people--; else disk.people = structuredClone(w.people); return true; },
    assign: changes => { const owner = new Map(changes.map(c => [c.id, c.personId])); w.recs = w.recs.map(r => owner.has(r.id) ? { ...r, personId: owner.get(r.id) } : r); if (lost.owners > 0) lost.owners--; else disk.recs = structuredClone(w.recs); return true; },
    readPersisted: async () => ({ retail: cleanState(disk.retail), people: disk.people.map(p => ({ id: p.id, name: p.name })), records: disk.recs.map(r => ({ id: r.id, personId: r.personId })), settings: {} }),
  };
  return w;
}
const fast = { verify: { timeoutMs: 300, intervalMs: 30 } };
const diskOwners = (w, id) => w.disk.recs.filter(r => r.personId === id).length;

// 1. a lost phone-owner write is put back once, and "done" is only said after it is checked
{
  const w = world({ loseOwners: 1 }); const q = queueAssistant(w.ctx, 'give 2 fold6 to asha'); assert.ok(q.pending, q.output);
  const done = await commitAssistantRequestVerified(w.ctx, q.id, fast); assert.equal(done.verify.status, 'verified', done.message); assert.equal(diskOwners(w, 'p1'), 2, 'the owners really are saved now');
}
// 2. a lost people write is put back (and no second copy of the person appears)
{
  const w = world({ losePeople: 1 }); const q = queueAssistant(w.ctx, 'add person zed'); const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.verify.status, 'verified', done.message); assert.equal(w.disk.people.filter(p => p.name === 'Zed').length, 1); assert.equal(w.people.filter(p => p.name === 'Zed').length, 1);
}
// 3. a lost retail-state write is saved again
{
  const w = world({ loseRetail: 2 }); const q = queueAssistant(w.ctx, 'set asha flagship 1 target to 12'); assert.ok(q.pending, q.output);
  const done = await commitAssistantRequestVerified(w.ctx, q.id, fast); assert.equal(done.verify.status, 'verified', done.message);
}
// 4. a store that keeps losing writes is still reported honestly
{
  const w = world({ loseOwners: 99 }); const q = queueAssistant(w.ctx, 'give 2 fold6 to asha'); const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.verify.status, 'unverified'); assert.match(done.message, /could not confirm/);
}
// 5. the app closed before the check: the next start re-checks the newest change and repairs a lost write
{
  const w = world({ loseOwners: 1 }); const q = queueAssistant(w.ctx, 'give 2 fold6 to asha'); commitAssistantRequest(w.ctx, q.id, { notify: false }); // applied, never checked (the app "closed")
  assert.equal(diskOwners(w, 'p1'), 0, 'the owner write was lost');
  assert.ok(latestUnconfirmed(w.state, Date.now()), 'the change is seen as unconfirmed');
  const note = await reconcileRecent(w.ctx, { timeoutMs: 300, intervalMs: 30 }); assert.equal(note, null, 'repaired, nothing to tell the person');
  assert.equal(diskOwners(w, 'p1'), 2); assert.equal(w.state.assistantRequests.find(r => r.id === q.id).verify, 'verified'); assert.equal(w.state.agentLog.at(-1).verify, 'verified');
  assert.equal(latestUnconfirmed(w.state, Date.now()), null, 'checked once, not again'); assert.equal(await reconcileRecent(w.ctx, { timeoutMs: 100 }), null);
}
// 6. nothing can be repaired: the person is told, and the log says so
{
  const w = world({ loseOwners: 99 }); const q = queueAssistant(w.ctx, 'give 2 fold6 to asha'); commitAssistantRequest(w.ctx, q.id, { notify: false });
  const note = await reconcileRecent(w.ctx, { timeoutMs: 200, intervalMs: 30 }); assert.match(note, /could not be confirmed/); assert.equal(w.state.agentLog.at(-1).verify, 'unverified');
}
// 7. only the newest unconfirmed change is ever touched: an older one, or one with a newer change after it, is left alone
{
  const w = world(); const a = queueAssistant(w.ctx, 'give 2 fold6 to asha'); commitAssistantRequest(w.ctx, a.id, { notify: false });
  const b = queueAssistant(w.ctx, 'give 1 fold6 to bilal'); await commitAssistantRequestVerified(w.ctx, b.id, fast);
  assert.equal(latestUnconfirmed(w.state, Date.now()), null, 'the newest change was checked, so the older unconfirmed one is not "repaired" back');
  w.recs = w.recs.map(r => r.personId === 'p1' ? { ...r, personId: 'p2' } : r); w.disk.recs = structuredClone(w.recs); // a newer manual edit
  assert.equal(await reconcileRecent(w.ctx, { timeoutMs: 100 }), null); assert.equal(diskOwners(w, 'p1'), 0, 'the newer edit is untouched');
}
// 8. too old, or not applied: ignored; missingFrom only lists what is really missing
{
  const w = world(); const q = queueAssistant(w.ctx, 'add person zed'); commitAssistantRequest(w.ctx, q.id, { notify: false });
  assert.equal(latestUnconfirmed(w.state, Date.now() + 3 * 24 * 3600 * 1000), null, 'older than 48 hours is not touched');
  const input = receiptInput(w.state, q.id), persisted = await w.ctx.readPersisted({ records: true });
  assert.deepEqual(missingFrom(input, persisted).people, [], 'the person is saved, so nothing is missing');
  assert.equal(receiptInput(w.state, 'nope'), null);
}
console.log('agent reconcile: lost writes repaired once and re-checked, interrupted changes re-checked on start, newer work never touched');
process.exit(0);
