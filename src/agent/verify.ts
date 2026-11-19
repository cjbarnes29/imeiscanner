import { assistantFingerprint } from '../retail/assistant-actions';
import { cleanState } from '../retail/data';
import type { PeopleOp, RetailState } from '../retail/types';

/**
 * "Done" is only said after the saved data is read back and matches. `Persisted` is what is really stored right now (read fresh from the stores, not from
 * memory); each Check compares one expected fact with it. Pure logic: the app supplies the reader.
 */
export type Persisted = { retail: RetailState; people: { id: string; name: string }[]; records: { id: string; personId: string }[]; settings: Record<string, string | null> };
/** Reads what is really stored. Phone records are large (photos), so they are only read when a check needs them. */
export type PersistedReader = (scope: { records: boolean }) => Promise<Persisted>;
export type Check = { id: string; label: string; ok: (p: Persisted) => boolean };
export type VerifyInput = { requestId: string; status: 'applied' | 'undone'; next: RetailState; businessKeys: string[]; changes: { id: string; personId: string }[]; settings?: Record<string, string | null>; people?: PeopleOp[]; additions?: { id: string }[]; removeIds?: string[] };
export type VerifyResult = { status: 'verified' | 'unverified' | 'unavailable'; checks: number; failed: string[] };

export function expectedChecks(input: VerifyInput): Check[] {
  const checks: Check[] = [];
  const expected = cleanState(input.next);
  checks.push({ id: 'request', label: `the request is saved as ${input.status}`, ok: p => p.retail.assistantRequests?.find(r => r.id === input.requestId)?.status === input.status });
  for (const key of input.businessKeys) checks.push({ id: 'state:' + key, label: `saved ${key} match`, ok: p => assistantFingerprint((p.retail as Record<string, unknown>)[key] ?? null) === assistantFingerprint((expected as Record<string, unknown>)[key] ?? null) });
  for (const c of input.changes) checks.push({ id: 'owner:' + c.id, label: 'a phone is saved with the right owner', ok: p => p.records.find(r => r.id === c.id)?.personId === c.personId });
  for (const op of input.people || []) {
    if (op.kind === 'add') checks.push({ id: 'person+' + op.id, label: `${op.name} is saved in the people list`, ok: p => p.people.some(x => x.id === op.id && x.name === op.name) });
    else if (op.kind === 'rename') checks.push({ id: 'person~' + op.id, label: `${op.to} is saved as the name`, ok: p => p.people.some(x => x.id === op.id && x.name === op.to) });
    else checks.push({ id: 'person-' + op.id, label: `${op.name} is removed from the people list`, ok: p => !p.people.some(x => x.id === op.id) });
  }
  for (const [key, value] of Object.entries(input.settings || {})) checks.push({ id: 'setting:' + key, label: 'the setting is saved', ok: p => (p.settings[key] ?? null) === value });
  for (const a of input.additions || []) checks.push({ id: 'phone+' + a.id, label: 'the added phone is saved', ok: p => p.records.some(r => r.id === a.id) });
  for (const id of input.removeIds || []) checks.push({ id: 'phone-' + id, label: 'the removed phone is no longer in the records', ok: p => !p.records.some(r => r.id === id) });
  return checks;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** Reads the stores again and again (saving is asynchronous) until every check passes or the time is up. Never throws. */
export async function verifyPersisted(read: PersistedReader, checks: Check[], options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<VerifyResult> {
  const needsRecords = checks.some(c => c.id.startsWith('owner:') || c.id.startsWith('phone'));
  const timeoutMs = options.timeoutMs ?? 4000, intervalMs = options.intervalMs ?? (needsRecords ? 400 : 150), end = Date.now() + timeoutMs;
  let failed: string[] = checks.map(c => c.label);
  for (;;) {
    try { const persisted = await read({ records: needsRecords }); failed = checks.filter(c => { try { return !c.ok(persisted); } catch { return true; } }).map(c => c.label); } catch { failed = ['the saved data could not be read']; }
    if (!failed.length) return { status: 'verified', checks: checks.length, failed: [] };
    if (Date.now() >= end) return { status: 'unverified', checks: checks.length, failed: [...new Set(failed)].slice(0, 6) };
    await sleep(intervalMs);
  }
}
