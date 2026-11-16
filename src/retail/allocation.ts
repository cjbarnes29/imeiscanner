/**
 * Smart allocation: which unassigned phones to hand to whom. It only PROPOSES; nothing moves until a person approves (all, or the lines they
 * choose), and every approved allocation is written to a history that can be undone.
 *
 * Order (the owner's rule: help whoever is below 70 % but never at the cost of my own selected target):
 *   1. my own gap to my selected threshold is reserved first, segment by segment;
 *   2. everyone else below 70 % overall, lowest first, up to the units that reach 70 % in each segment;
 *   3. whatever is still unassigned goes to the others, lowest first, toward 100 %.
 * A person's gap already counts what they hold, what they sold but not yet submitted, and what the screenshot says they achieved.
 * Only phones that are eligible are used: valid IMEI, not a duplicate, not sold, and owned by nobody.
 */
import { planMove, UNASSIGNED } from '../people';
import { overallPct, type Threshold } from './targets';
import { isSold } from './sales';
import { type AllocationEvent, type AllocationItem, type Month, type PersonTarget, type RetailState, type Segment, SEGMENTS } from './types';

export type AllocRecord = { id: string; imei: string; personId: string; segment: Segment; duplicate?: boolean };
export type Proposal = { id: string; personId: string; segment: Segment; recordIds: string[]; reason: string; step: 'mine' | 'below70' | 'toward100' };
export type Recommendation = { proposals: Proposal[]; leftover: Partial<Record<Segment, number>>; notes: string[] };

const eligible = (state: RetailState, r: AllocRecord) => /^\d{15}$/.test(r.imei) && !r.duplicate && !isSold(state, r.id, r.imei);

/** Units a person still needs in a segment to reach a threshold, after what they hold and what is pending submission. */
export function gap(target: PersonTarget | undefined, segment: Segment, threshold: number, holding: number, pending: number): number {
  const line = target?.lines.find(l => l.segment === segment);
  if (!line || line.target <= 0) return 0;
  return Math.max(0, Math.ceil(line.target * threshold / 100) - line.achieved - pending - holding);
}

export function recommend(input: {
  state: RetailState; month: Month; people: { id: string; name: string }[]; records: AllocRecord[];
  pending: Record<string, Partial<Record<Segment, number>>>;
}): Recommendation {
  const { state, month, people, records, pending } = input;
  const notes: string[] = [];
  const usable = records.filter(r => eligible(state, r));
  // the person's own segments (Fold 1, Fold 2…), or the starting list
  const segs: Segment[] = state.segments?.length ? state.segments.map(x => x.id) : SEGMENTS;
  const pool: Record<string, string[]> = {};
  for (const r of usable) if (r.personId === UNASSIGNED && r.segment !== 'other') (pool[r.segment] ||= []).push(r.id);
  const unclassified = usable.filter(r => r.personId === UNASSIGNED && r.segment === 'other').length;
  if (unclassified) notes.push(`${unclassified} phone${unclassified === 1 ? ' has' : 's have'} no segment yet and ${unclassified === 1 ? 'was' : 'were'} left out. Classify ${unclassified === 1 ? 'it' : 'them'} first.`);
  const holdings = (personId: string, segment: Segment) => usable.filter(r => r.personId === personId && r.segment === segment).length;
  const targetOf = (personId: string) => state.targets[month]?.[personId];
  const proposals: Proposal[] = [];
  let counter = 0;
  const give = (personId: string, segment: Segment, wanted: number, step: Proposal['step'], reason: string) => {
    const list = pool[segment] || [];
    const take = Math.min(wanted, list.length);
    if (take <= 0) return;
    proposals.push({ id: `p${counter++}`, personId, segment, recordIds: list.splice(0, take), reason, step });
  };
  const me = state.settings.myPersonId;
  const myThreshold: Threshold = state.settings.myThreshold;
  if (me && targetOf(me)) {
    for (const segment of segs) give(me, segment, gap(targetOf(me), segment, myThreshold, holdings(me, segment), pending[me]?.[segment] || 0), 'mine', `Protects your ${myThreshold}% target`);
  } else if (me) notes.push('Your own target is not set for this month, so nothing could be reserved for you.');
  const others = people.filter(p => p.id !== me && targetOf(p.id));
  const ranked = [...others].sort((a, b) => overallPct(targetOf(a.id)) - overallPct(targetOf(b.id)) || a.name.localeCompare(b.name));
  for (const person of ranked.filter(p => overallPct(targetOf(p.id)) < 70)) {
    const percent = Math.round(overallPct(targetOf(person.id)));
    for (const segment of segs) give(person.id, segment, gap(targetOf(person.id), segment, 70, holdings(person.id, segment), pending[person.id]?.[segment] || 0), 'below70', `Below 70% (${percent}%): units to reach 70%`);
  }
  for (const person of ranked) {
    const percent = Math.round(overallPct(targetOf(person.id)));
    for (const segment of segs) {
      const already = proposals.filter(p => p.personId === person.id && p.segment === segment).reduce((s, p) => s + p.recordIds.length, 0);
      give(person.id, segment, gap(targetOf(person.id), segment, 100, holdings(person.id, segment) + already, pending[person.id]?.[segment] || 0), 'toward100', `At ${percent}%: units toward 100%`);
    }
  }
  const leftover: Recommendation['leftover'] = {};
  for (const [segment, list] of Object.entries(pool)) if (list.length) leftover[segment as Segment] = list.length;
  if (!proposals.length) notes.push('Nothing to propose: no unassigned phone matches a target that still needs units.');
  return { proposals, leftover, notes };
}

let eventCounter = 0;
export type ApplyResult = { records: { id: string; personId: string }[]; event?: AllocationEvent; blocked: string[]; moved: string[] };

/**
 * Applies the approved lines. Uses the same move rule as the Give tab (a phone is never moved onto a person who already holds that IMEI).
 * `records` is the whole list; the result lists which records now have which owner, and an event for the history.
 */
export function applyAllocation<T extends { id: string; imei: string; personId: string; segment?: Segment }>(
  records: T[], proposals: Proposal[], approved: Set<string>, source: AllocationEvent['source'], month: Month, now = new Date().toISOString()
): { records: T[]; event?: AllocationEvent; blocked: string[]; moved: string[] } {
  let next = records;
  const items: AllocationItem[] = [], blocked: string[] = [], moved: string[] = [];
  for (const proposal of proposals.filter(p => approved.has(p.id))) {
    const plan = planMove(next, proposal.recordIds, proposal.personId);
    for (const id of plan.moved) {
      const before = next.find(r => r.id === id)!;
      items.push({ recordId: id, imei: before.imei, segment: proposal.segment, from: before.personId, to: proposal.personId });
    }
    blocked.push(...plan.blocked); moved.push(...plan.moved); next = plan.records;
  }
  const event: AllocationEvent | undefined = items.length ? { id: `alloc-${Date.now().toString(36)}-${(eventCounter++).toString(36)}`, at: now, month, source, items, status: 'applied' } : undefined;
  return { records: next, event, blocked, moved };
}

/** Undo: every phone still with the person it was given to goes back to where it came from; a phone that moved on since stays where it is. */
export function undoAllocation<T extends { id: string; personId: string }>(records: T[], event: AllocationEvent, now = new Date().toISOString()): { records: T[]; event: AllocationEvent; restored: string[]; kept: string[] } {
  const restored: string[] = [], kept: string[] = [];
  const back = new Map<string, string>();
  for (const item of event.items) {
    const current = records.find(r => r.id === item.recordId);
    if (current && current.personId === item.to) { back.set(item.recordId, item.from); restored.push(item.recordId); } else kept.push(item.recordId);
  }
  return { records: records.map(r => back.has(r.id) ? { ...r, personId: back.get(r.id)! } : r), event: { ...event, status: 'undone', undoneAt: now }, restored, kept };
}
