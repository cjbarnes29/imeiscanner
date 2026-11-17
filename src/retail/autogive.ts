/**
 * Give and share, automatic mode. One place that turns the scan records into what the allocation rules need, so the Suggested list and the automatic
 * mode always agree: the same phones, the same limits, the same order. Pure functions, no React.
 *
 * Automatic mode gives every phone that has no owner by itself, using the same rules as the suggestions (my own target first, then everyone under 70 %,
 * then each person's minimum a day, then toward 100 %) and never more than a person's maximum a day. What the limits leave over stays without an owner and
 * is given on the next run (a late upload, or tomorrow). Every automatic give is one entry in the history and can be undone.
 * Phones that still need review, are held (Store only), have a bad or repeated number, or whose give was undone are never given automatically.
 */
import { UNASSIGNED } from '../people';
import { applyAllocation, givenToday, recommend, type AllocRecord, type Recommendation } from './allocation';
import { segmentOf } from './catalog';
import { pendingBySegment, submittedSince } from './dashboard';
import { type DateKey, type Month, type RetailState, type Segment } from './types';

export type GiveRecord = { id: string; imei: string; model: string; personId: string; duplicate?: boolean; needsReview?: boolean };

/** Units a person has sold but not submitted, plus those submitted since their screenshot: both already count toward what they need. */
export function creditOf(state: RetailState, month: Month, personId: string): Partial<Record<Segment, number>> {
  const out: Partial<Record<Segment, number>> = { ...pendingBySegment(state, personId) };
  for (const [segment, n] of Object.entries(submittedSince(state, personId, state.targets[month]?.[personId]))) out[segment as Segment] = (out[segment as Segment] || 0) + (n || 0);
  return out;
}

/** The records as the allocation rules see them. `forAuto` leaves out unassigned phones that must not be given by themselves. */
export function allocView(state: RetailState, month: Month, records: GiveRecord[], forAuto = false): AllocRecord[] {
  // a phone whose give was undone is never given again by itself (it can still be suggested, and given by hand)
  const undone = forAuto ? new Set(state.allocations.filter(e => e.status === 'undone').flatMap(e => e.items.map(i => i.recordId))) : new Set<string>();
  return records
    .filter(r => !forAuto || r.personId !== UNASSIGNED || (!r.needsReview && state.recordMeta[r.id]?.status !== 'held' && !undone.has(r.id)))
    .map(r => ({ id: r.id, imei: r.imei, personId: r.personId, segment: segmentOf(state, r.model, month, state.recordMeta[r.id]), duplicate: r.duplicate }));
}

/** What would be given now, with the person's limits and what was already given today. */
export function recommendFor(state: RetailState, month: Month, today: DateKey, people: { id: string; name: string }[], records: GiveRecord[], forAuto = false): Recommendation {
  return recommend({
    state, month, people, records: allocView(state, month, records, forAuto), pending: Object.fromEntries(people.map(p => [p.id, creditOf(state, month, p.id)])),
    limits: state.giveLimits, givenToday: givenToday(state, today)
  });
}

export type AutoGiveResult = { state: RetailState; changes: { id: string; personId: string }[]; blocked: number };

/** Gives everything the rules propose, as one history entry marked automatic. Nothing happens unless the mode is Auto. */
export function runAutoGive(state: RetailState, month: Month, today: DateKey, people: { id: string; name: string }[], records: GiveRecord[], now = new Date().toISOString()): AutoGiveResult | undefined {
  if (state.giveMode !== 'auto') return undefined;
  const rec = recommendFor(state, month, today, people, records, true);
  if (!rec.proposals.length) return undefined;
  const result = applyAllocation(allocView(state, month, records, true), rec.proposals, new Set(rec.proposals.map(p => p.id)), 'auto', month, now);
  if (!result.event) return undefined;
  return { state: { ...state, allocations: [...state.allocations, result.event] }, changes: result.event.items.map(i => ({ id: i.recordId, personId: i.to })), blocked: result.blocked.length };
}

/** A short fingerprint of what automatic mode looks at: the same fingerprint means the same answer, so it is not run twice. */
export function autoGiveSignature(state: RetailState, month: Month, today: DateKey, records: GiveRecord[]): string {
  const waiting = records.filter(r => r.personId === UNASSIGNED).map(r => r.id).sort();
  return [state.giveMode || 'suggest', today, JSON.stringify(state.giveLimits || {}), JSON.stringify(state.targets[month] || {}), state.settings.myPersonId, state.settings.myThreshold, waiting.length, waiting[0] || '', waiting[waiting.length - 1] || ''].join('|');
}
