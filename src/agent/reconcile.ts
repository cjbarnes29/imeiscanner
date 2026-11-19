import type { PeopleOp, RetailState } from '../retail/types';
import type { Persisted, VerifyInput } from './verify';

/**
 * Cross-store consistency. The assistant writes to several places (the retail state, the people list, phone owners, settings), and they are not saved in one
 * atomic step. If the app closes between them, or one write is lost, the stores disagree. These pure helpers say (a) which recent change was never confirmed,
 * (b) what its stored facts should be, and (c) what is still missing, so the app can re-check and repair that one change. They never touch anything newer.
 */
export const RECONCILE_WINDOW_MS = 48 * 3600 * 1000;

/** What must be true in the stored data for an applied request, rebuilt from its receipt. */
export function receiptInput(state: RetailState, id: string): VerifyInput | null {
  const request = state.assistantRequests?.find(r => r.id === id);
  if (!request || request.status !== 'applied') return null;
  let businessKeys: string[] = [];
  try { businessKeys = Object.keys(JSON.parse(request.businessAfter || '{}')); } catch { businessKeys = []; }
  const event = request.allocationId ? state.allocations.find(e => e.id === request.allocationId && e.status === 'applied') : undefined;
  const changes: { id: string; personId: string }[] = [
    ...(event?.items.map(i => ({ id: i.recordId, personId: i.to })) || []),
    ...(request.moves || []).map(m => ({ id: m.id, personId: m.to })),
  ];
  for (const op of request.peopleOps || []) if (op.kind === 'delete') for (const phone of op.moved) changes.push({ id: phone, personId: '' });
  return { requestId: id, status: 'applied', next: state, businessKeys, changes, people: request.peopleOps };
}

/**
 * The one request worth re-checking: the newest applied request whose check never finished (the app closed first) and that nothing newer has built on.
 * Older or already-checked requests are left alone, so a legitimate later edit is never "repaired" back.
 */
export function latestUnconfirmed(state: RetailState, now: number, windowMs = RECONCILE_WINDOW_MS): { requestId: string; logId?: string } | null {
  const requests = state.assistantRequests || [];
  const last = [...requests].reverse().find(r => r.status === 'applied' || r.status === 'undone');
  if (!last || last.status !== 'applied' || last.verify) return null;
  const entry = [...(state.agentLog || [])].reverse().find(e => e.requestId === last.id && e.outcome === 'applied');
  if (!entry || entry.verify !== 'n/a') return null;
  if (now - Date.parse(entry.at) > windowMs || Number.isNaN(Date.parse(entry.at))) return null;
  return { requestId: last.id, logId: entry.id };
}

/** What is still missing in the stores, narrowed so that applying it again is safe (an add is only repeated if the person is absent, and so on). */
export function missingFrom(input: VerifyInput, persisted: Persisted): { people: PeopleOp[]; changes: { id: string; personId: string }[]; retail: boolean } {
  const people = (input.people || []).filter(op =>
    op.kind === 'add' ? !persisted.people.some(p => p.id === op.id)
    : op.kind === 'rename' ? persisted.people.some(p => p.id === op.id && p.name !== op.to)
    : persisted.people.some(p => p.id === op.id));
  const changes = input.changes.filter(c => { const r = persisted.records.find(x => x.id === c.id); return !!r && r.personId !== c.personId; });
  const saved = persisted.retail.assistantRequests?.find(r => r.id === input.requestId);
  return { people, changes, retail: saved?.status !== input.status || !persisted.retail.assistantRequests };
}
