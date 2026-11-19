// Phase 1: tool registry, audit log and verified saves. "Done" may only be reported after the stored data is read back and matches; a save that silently
// failed must show as "not confirmed", never as success. Synthetic data only. Part of `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let stored = {};
globalThis.localStorage = { getItem: k => stored[k] ?? null, setItem(k, v) { stored[k] = String(v); }, removeItem(k) { delete stored[k]; } };
const bundled = await build({
  stdin: { contents: "export { queueAssistant, commitAssistantRequestVerified } from './src/AssistantReview'; export { toolOf, TOOL_REGISTRY, toolNamed } from './src/agent/registry'; export { appendAgentLog, updateAgentLog, maskImeis, MAX_AGENT_LOG } from './src/agent/log'; export { expectedChecks, verifyPersisted } from './src/agent/verify'; export { previewAssistant } from './src/retail/assistant-actions'; export { emptyState, cleanState } from './src/retail/data';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-agent-core-'));
const file = join(dir, 'core.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { queueAssistant, commitAssistantRequestVerified, toolOf, TOOL_REGISTRY, toolNamed, appendAgentLog, updateAgentLog, maskImeis, MAX_AGENT_LOG, expectedChecks, verifyPersisted, previewAssistant, emptyState, cleanState } = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const records = Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: '', name: 'r' + i, createdAt: '2026-11-18T0' + (i % 10) + ':00:00Z', raw: 'Galaxy Z Fold6' }));
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const today = '2026-11-19';

// ---- 1. the registry names every kind of change, and risk is right -------------------------------------------------------------------------------
{
  const names = TOOL_REGISTRY.map(t => t.name); assert.equal(new Set(names).size, names.length, 'tool names are unique');
  for (const t of TOOL_REGISTRY) { assert.ok(['create', 'read', 'update', 'delete'].includes(t.op)); assert.equal(t.name, `${t.module}.${t.op}`); if (t.op === 'read') assert.equal(t.risk, 'read'); if (t.op === 'delete') assert.equal(t.risk, 'destructive', t.name + ' removes something'); }
  const state = { ...emptyState(), recordMeta: Object.fromEntries(records.slice(26).map(r => [r.id, { status: 'held' }])) };
  const cases = [['add 2 people omar and lee', 'people.create'], ['rename asha to ashley', 'people.update'], ['delete bilal', 'people.delete'], ['give 4 fold6 to asha', 'gives.create'], ['store 2 fold6', 'stock.update'], ['remove 2 fold6 from stock', 'stock.delete'], ['mark asha not available 2026-11-20', 'calendar.create'], ['set asha flagship 1 target to 12', 'targets.update'], ['set report fold6 to 6', 'reports.update'], ['turn off auto-detection', 'settings.update'], ["create daily routine to prepare today's report", 'routines.create'], ["prepare today's WhatsApp report", 'whatsapp.create']];
  for (const [text, expected] of cases) { const p = previewAssistant(state, records, people, today, text); const tool = toolOf(p, text); assert.equal(tool?.name, expected, text); assert.ok(toolNamed(tool.name), 'the tool is in the registry'); }
  assert.equal(toolOf(previewAssistant(state, records, people, today, 'what if i delete bilal'), 'what if i delete bilal'), null, 'a question uses no tool');
  assert.equal(toolNamed('people.delete').risk, 'destructive'); assert.equal(toolNamed('stock.delete').risk, 'destructive');
}

// ---- 2. audit log: appended, capped, IMEIs masked, cleaned when loaded ---------------------------------------------------------------------------
{
  assert.equal(maskImeis(`give ${imei(5)} to asha`), 'give ' + imei(5).slice(0, 8) + '***' + imei(5).slice(-4) + ' to asha', 'only first 8 and last 4 digits stay');
  let state = emptyState();
  const first = appendAgentLog(state, { actor: 'you', mode: 'assistant', tool: 'people.create', op: 'create', risk: 'low', summary: 'add maya ' + imei(7), outcome: 'applied', verify: 'n/a', checks: 0 });
  assert.equal(first.state.agentLog.length, 1); assert.ok(!first.state.agentLog[0].summary.includes(imei(7)), 'no full IMEI in the log');
  const patched = updateAgentLog(first.state, first.id, { verify: 'verified', checks: 3 }); assert.equal(patched.agentLog[0].verify, 'verified'); assert.equal(updateAgentLog(patched, 'nope', { verify: 'unverified' }), patched, 'unknown id changes nothing');
  for (let i = 0; i < MAX_AGENT_LOG + 25; i++) state = appendAgentLog(state, { actor: 'agent', mode: 'autopilot', tool: 'gives.create', op: 'create', risk: 'medium', summary: 'n' + i, outcome: 'applied', verify: 'verified', checks: 1 }).state;
  assert.equal(state.agentLog.length, MAX_AGENT_LOG, 'the log is capped'); assert.equal(state.agentLog.at(-1).summary, 'n' + (MAX_AGENT_LOG + 24), 'newest entries are kept');
  const cleaned = cleanState({ ...state, agentLog: [...state.agentLog.slice(-3), { id: 'x', at: 'now', outcome: 'exploded' }, { nonsense: true }] });
  assert.equal(cleaned.agentLog.length, 3, 'broken entries are dropped when loading'); assert.equal(cleaned.agentLog[2].verify, 'verified');
}

// ---- 3. read-back logic --------------------------------------------------------------------------------------------------------------------------
{
  const next = { ...emptyState(), assistantRequests: [{ id: 'q', at: 'x', text: 'give', output: '', status: 'applied' }] };
  const input = { requestId: 'q', status: 'applied', next, businessKeys: [], changes: [{ id: 'r1', personId: 'p1' }], people: [{ kind: 'add', id: 'pn', name: 'Maya' }], settings: { k: 'v' } };
  const checks = expectedChecks(input); assert.equal(checks.length, 4, 'request + owner + person + setting');
  const good = { retail: next, people: [{ id: 'pn', name: 'Maya' }], records: [{ id: 'r1', personId: 'p1' }], settings: { k: 'v' } };
  let reads = 0, scopes = [];
  const ok = await verifyPersisted(async scope => { reads++; scopes.push(scope.records); return good; }, checks, { timeoutMs: 500, intervalMs: 20 });
  assert.equal(ok.status, 'verified'); assert.equal(ok.checks, 4); assert.equal(reads, 1, 'verified on the first read'); assert.equal(scopes[0], true, 'phone records are read because an owner is checked');
  const noPhones = await verifyPersisted(async scope => { scopes.push(scope.records); return good; }, expectedChecks({ ...input, changes: [] }), { timeoutMs: 200, intervalMs: 20 }); assert.equal(noPhones.status, 'verified'); assert.equal(scopes.at(-1), false, 'the big phone records are not read when nothing about phones is checked');
  let n = 0; const late = await verifyPersisted(async () => (++n < 4 ? { ...good, people: [] } : good), checks, { timeoutMs: 2000, intervalMs: 20 }); assert.equal(late.status, 'verified', 'a save that lands a moment later is still confirmed'); assert.ok(n >= 4);
  const stale = await verifyPersisted(async () => ({ ...good, records: [{ id: 'r1', personId: '' }], people: [] }), checks, { timeoutMs: 300, intervalMs: 20 });
  assert.equal(stale.status, 'unverified'); assert.ok(stale.failed.length >= 2 && stale.failed.some(f => /Maya/.test(f)), 'it says what was not saved: ' + stale.failed.join(' | '));
  const broken = await verifyPersisted(async () => { throw new Error('db closed'); }, checks, { timeoutMs: 200, intervalMs: 20 }); assert.equal(broken.status, 'unverified'); assert.match(broken.failed[0], /could not be read/);
  assert.equal(expectedChecks({ ...input, status: 'undone', people: [{ kind: 'delete', id: 'pn', name: 'Maya', moved: [] }], changes: [], settings: {}, additions: undefined, removeIds: ['rx'] }).length, 3, 'undo checks the person is gone and the phone removed');
}

// ---- 4. the whole approve path against a fake store that can lose data ----------------------------------------------------------------------------
function world(faithful) {
  const w = { state: { ...emptyState(), assistantRequests: [] }, people: people.map(p => ({ ...p })), recs: records.map(r => ({ ...r })), notes: [] };
  const disk = { retail: structuredClone(w.state), people: structuredClone(w.people), recs: structuredClone(w.recs), settings: {} };
  w.ctx = {
    get state() { return w.state; }, latest: () => w.state, readOnly: false, today, notify: t => w.notes.push(t),
    get records() { return w.recs; }, latestRecords: () => w.recs, get people() { return w.people; }, latestPeople: () => w.people,
    change: next => { w.state = next; if (faithful) disk.retail = structuredClone(next); },
    editPeople: ops => { for (const op of ops) { if (op.kind === 'add') w.people.push({ id: op.id, name: op.name }); else if (op.kind === 'rename') w.people = w.people.map(p => p.id === op.id ? { ...p, name: op.to } : p); else w.people = w.people.filter(p => p.id !== op.id); } if (faithful) disk.people = structuredClone(w.people); return true; },
    assign: changes => { const owner = new Map(changes.map(c => [c.id, c.personId])); w.recs = w.recs.map(r => owner.has(r.id) ? { ...r, personId: owner.get(r.id) } : r); if (faithful) disk.recs = structuredClone(w.recs); return true; },
    readPersisted: async () => ({ retail: cleanState(disk.retail), people: disk.people.map(p => ({ id: p.id, name: p.name })), records: disk.recs.map(r => ({ id: r.id, personId: r.personId })), settings: disk.settings }),
  };
  return w;
}
const fast = { verify: { timeoutMs: 400, intervalMs: 30 } };
{
  const w = world(true); const q = queueAssistant(w.ctx, 'add 2 people omar and lee'); assert.ok(q.pending);
  const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.outcome, 'applied'); assert.equal(done.verify.status, 'verified'); assert.match(done.message, /Approved and saved\. Checked in the saved data\./);
  const log = w.state.agentLog.at(-1); assert.equal(log.tool, 'people.create'); assert.equal(log.verify, 'verified'); assert.ok(log.checks >= 3); assert.equal(log.actor, 'you'); assert.equal(log.requestId, q.id);
  assert.equal(w.state.assistantRequests.find(r => r.id === q.id).verify, 'verified'); assert.equal(w.state.assistantRequests.find(r => r.id === q.id).tool, 'people.create');
  const undone = await commitAssistantRequestVerified(w.ctx, q.id, { undo: true, ...fast }); assert.equal(undone.outcome, 'undone'); assert.equal(undone.verify.status, 'verified'); assert.equal(w.people.length, 2, 'the two people are gone again');
  assert.equal(w.state.agentLog.at(-1).outcome, 'undone'); assert.equal(w.state.agentLog.length, 2, 'one log entry per action');
}
{
  const w = world(true); const q = queueAssistant(w.ctx, 'give 4 fold6 to asha'); assert.ok(q.pending, q.output);
  const done = await commitAssistantRequestVerified(w.ctx, q.id, fast); assert.equal(done.verify.status, 'verified', done.message);
  assert.equal(w.recs.filter(r => r.personId === 'p1').length, 4, 'four phones now belong to Asha'); assert.equal(w.state.agentLog.at(-1).tool, 'gives.create'); assert.ok(w.state.agentLog.at(-1).checks >= 5, 'every phone owner was checked');
}
{
  const w = world(false); const q = queueAssistant(w.ctx, 'add person zed'); // saving silently fails: the screen changes, the stored data does not
  const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.outcome, 'applied'); assert.equal(done.verify.status, 'unverified', 'a lost save is never reported as success');
  assert.match(done.message, /could not confirm it was saved/); assert.ok(!/Approved and saved/.test(done.message));
  assert.equal(w.state.agentLog.at(-1).verify, 'unverified'); assert.ok(w.state.agentLog.at(-1).failed.length > 0); assert.equal(w.state.assistantRequests.find(r => r.id === q.id).verify, 'unverified');
  assert.match(w.notes.at(-1), /could not confirm/);
}
{
  const w = world(false); const q = queueAssistant(w.ctx, 'give 2 fold6 to bilal'); const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.verify.status, 'unverified', 'phone owners that were not really saved are caught'); assert.ok(done.verify.failed.some(f => /owner/.test(f)));
}
{
  const w = world(true); delete w.ctx.readPersisted; const q = queueAssistant(w.ctx, 'add person kim'); const done = await commitAssistantRequestVerified(w.ctx, q.id, fast);
  assert.equal(done.verify.status, 'unavailable'); assert.ok(!/Checked in the saved data/.test(done.message), 'with no way to check, it does not claim a check');
  assert.equal(w.state.agentLog.at(-1).verify, 'n/a');
}
console.log('agent core: tools, audit log, read-back verification and lost-save detection all checked');
process.exit(0);
