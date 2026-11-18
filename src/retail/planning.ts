/** Shared, deterministic release planning. Plans reserve phones; only confirmation records a sale. */
import { coverageUnits, isWorking, isAvailableAt, calculationDates } from './availability';
import { luhnValid } from '../imei-validate';
import { itemFor, segmentOf } from './catalog';
import { creditOf } from './autogive';
import { isSold } from './sales';
import { variantOf, validImei } from './inventory';
import { bumpReport, syncSold } from './soldsync';
import { withAudit } from './data';
import { monthOf, type PlanRequest, type ReleasePlan, type ReleaseEvent, type RetailState, type TargetLine } from './types';
import type { RetailRecord } from './ui-helpers';

const uid = () => crypto.randomUUID();
const whole = (n: number) => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
export const pendingReleases = (state: RetailState) => (state.releases || []).filter(e => e.status === 'released').flatMap(e => e.recordIds.filter(id => !e.reportedIds.includes(id) && state.recordMeta[id]?.status === 'sold').map(id => ({ event: e, id })));
export const eligibleStored = (state: RetailState, records: RetailRecord[]) => {
  const seen = new Set<string>();
  return [...records].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id)).filter(r => {
    if (state.recordMeta[r.id]?.status !== 'held' || !validImei(r.imei) || !itemFor(state,r.model) || !luhnValid(r.imei) || r.duplicate || r.needsReview || isSold(state, r.id, r.imei) || state.pendingUploadIds?.includes(r.id) || seen.has(r.imei)) return false;
    seen.add(r.imei); return true;
  });
};
export function planFingerprint(state: RetailState, records: RetailRecord[]) {
  return JSON.stringify([state.targets, state.recordMeta, state.sales, state.giveLimits, state.workSchedules, state.shiftCodes, state.leaveTransfers, records.map(r => [r.id, r.imei, r.model, r.personId, r.duplicate, r.needsReview]), (state.releasePlans || []).flatMap(p => p.entries.filter(e => e.status === 'scheduled').map(e => [p.request.personId, e.date, e.recordIds]))]);
}
export function thresholdUnits(line: TargetLine, percent: number) {
  const level = Math.min(Math.max(0, percent), line.cap ?? 120);
  const typed = line.levels?.[level as keyof NonNullable<TargetLine['levels']>];
  return typed === undefined ? Math.ceil(line.target * level / 100) : typed;
}
export function daysBetween(start: string, end: string, skip: number[] = []) {
  const days: string[] = [], d = new Date(`${start}T12:00:00`);
  for (let n = 0; n < 366 && !Number.isNaN(d.getTime()); n++, d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (key > end) break;
    if (!skip.includes(d.getDay())) days.push(key);
  }
  return days;
}
export function draftPlan(state: RetailState, records: RetailRecord[], request: PlanRequest): ReleasePlan {
  const month = monthOf(request.date), target = state.targets[month]?.[request.personId];
  const plan: ReleasePlan = { id: uid(), createdAt: new Date().toISOString(), request, fingerprint: '', entries: [] };
  if (!target || state.giveLimits?.[request.personId]?.off || monthOf(request.until) !== month) return plan;
  const reserved = new Set((state.releasePlans || []).filter(p => p.request.personId !== request.personId).flatMap(p => p.entries.filter(e => e.status === 'scheduled').flatMap(e => e.recordIds)));
  const pool = eligibleStored(state, records).filter(r => !reserved.has(r.id) && (!r.personId || r.personId === request.personId));
  const credit = creditOf(state, month, request.personId);
  const lines = target.lines.filter(l => l.target > 0 && request.segments.includes(l.segment));
  lines.sort((a, b) => request.priority === 'nearest' ? Math.max(0, thresholdUnits(a, request.value) - a.achieved - (credit[a.segment] || 0)) - Math.max(0, thresholdUnits(b, request.value) - b.achieved - (credit[b.segment] || 0)) : (a.achieved + (credit[a.segment] || 0)) / a.target - (b.achieved + (credit[b.segment] || 0)) / b.target);
  const perDay = new Map<string, number>();
  for (const event of state.releases || []) if (event.status === 'released' && event.personId === request.personId) perDay.set(event.date, (perDay.get(event.date) || 0) + event.recordIds.length);
  const calculation = new Set(calculationDates(state, request.personId, request.date, request.until));
  const dates = daysBetween(request.date, request.until, request.skipDays).filter(date => !request.skipDates?.includes(date) && isWorking(state, request.personId, date) && (request.quantityMode === 'manual' || calculation.has(date))); 
  const milestones = request.method === 'milestones' ? [...request.milestones].filter(m => m.date >= request.date && m.date <= request.until && dates.includes(m.date)).sort((a, b) => a.date.localeCompare(b.date)) : [{ date: request.date, percent: request.value }];
  for (const line of lines) {
    const phones = pool.filter(r => segmentOf(state, r.model, month, state.recordMeta[r.id]) === line.segment);
    const allowed = phones.slice(0, Math.max(0, phones.length - whole(request.reserve)));
    const achieved = line.achieved + (credit[line.segment] || 0);
    const coverage = coverageUnits({ ...state, leaveTransfers: state.leaveTransfers?.filter(t => !t.adjustmentsApplied) }, request.personId, line.segment, `${month}-01`, request.until);
    const coverageDelta = coverage - (request.coverageBase?.[line.segment] || 0);
    let planned = 0, cursor = 0;
    const stages = request.method === 'spread' ? [{ date: request.until, percent: request.value }] : milestones;
    for (const stage of stages) {
      const capRemaining = Math.max(0, thresholdUnits(line, line.cap ?? 120) + coverage - achieved - planned);
      const raw = request.method !== 'milestones' && request.goalUnits?.[line.segment] !== undefined ? Math.max(0, Math.ceil(request.goalUnits[line.segment] * ((request.method === 'quantity' || request.method === 'stored' || !request.goalBaseTargets?.[line.segment]) ? 1 : line.target / request.goalBaseTargets[line.segment])) + coverageDelta - achieved - planned) : request.method === 'stored' ? Math.ceil(allowed.length * request.value / 100) : request.method === 'quantity' ? whole(request.value) : Math.max(0, thresholdUnits(line, request.method === 'points' ? achieved / line.target * 100 + request.value : stage.percent) + coverage - achieved - planned);
      let remaining = Math.min(raw, capRemaining);
      const useDates = request.quantityMode === 'manual' ? (request.method === 'milestones' ? [stage.date] : dates) : request.method === 'milestones' ? [stage.date] : request.method === 'spread' ? dates : dates.filter(d => d >= stage.date);
      for (let i = 0; i < useDates.length && remaining > 0; i++) {
        const date = useDates[i], limit = Math.min(request.dailyLimit ?? Infinity, state.giveLimits?.[request.personId]?.max ?? Infinity);
        const room = Math.max(0, limit - (perDay.get(date) || 0));
        const aim = request.quantityMode === 'manual' ? whole(request.manualDaily?.[date]?.[line.segment] || 0) : request.method === 'spread' ? Math.ceil(remaining / (useDates.length - i)) : remaining;
        const required = Math.min(aim, room, remaining);
        if (!required) continue;
        const ids = allowed.slice(cursor, cursor + required).map(r => r.id);
        plan.entries.push({ id: uid(), date, segment: line.segment, recordIds: ids, required, before: achieved + planned, target: line.target, goal: Math.min(stage.percent, line.cap ?? 120), status: 'scheduled' });
        cursor += ids.length; planned += ids.length; remaining -= required; perDay.set(date, (perDay.get(date) || 0) + required);
      }
      if (remaining > 0) plan.entries.push({ id: uid(), date: stage.date, segment: line.segment, recordIds: [], required: remaining, before: achieved + planned, target: line.target, goal: Math.min(stage.percent, line.cap ?? 120), status: 'scheduled' });
    }
  }
  return plan;
}
export function approvePlan(state: RetailState, records: RetailRecord[], draft: ReleasePlan): RetailState {
  const fresh = draftPlan(state, records, draft.request);
  const selected = new Set<string>(), eligible = new Map(eligibleStored(state, records).map(r => [r.id, r]));
  fresh.entries.forEach((entry, i) => {
    const proposed = draft.entries[i];
    if (!proposed || proposed.recordIds.length !== entry.recordIds.length) throw new Error('The calculation changed. Review a fresh proposal.');
    for (const id of proposed.recordIds) {
      const r = eligible.get(id);
      if (!r || selected.has(id) || r.personId !== draft.request.personId || segmentOf(state, r.model, monthOf(entry.date), state.recordMeta[id]) !== entry.segment) throw new Error('A selected IMEI is no longer eligible. Recalculate the proposal.');
      selected.add(id);
    }
    entry.recordIds = [...proposed.recordIds];
  });
  if (!fresh.entries.some(e => e.recordIds.length)) throw new Error('No eligible stored phones can be reserved. Check the target, owner, dates and limits.');
  const plans = (state.releasePlans || []).map(p => p.request.personId === draft.request.personId ? { ...p, entries: p.entries.map(e => e.status === 'scheduled' ? { ...e, status: 'cancelled' as const } : e) } : p);
  fresh.calculatedFor = fresh.request.date;
  fresh.request = { ...fresh.request, goalBaseTargets: Object.fromEntries((state.targets[monthOf(fresh.request.date)]?.[fresh.request.personId]?.lines || []).map(l => [l.segment, l.target])), coverageBase: Object.fromEntries(fresh.request.segments.map(segment => [segment, coverageUnits({ ...state, leaveTransfers: state.leaveTransfers?.filter(t => !t.adjustmentsApplied) }, fresh.request.personId, segment, `${monthOf(fresh.request.date)}-01`, fresh.request.until)])), goalUnits: Object.fromEntries(fresh.request.segments.map(segment => [segment, Math.max(0, ...fresh.entries.filter(e => e.segment === segment).map(e => e.before + e.required))])) };
  const next = { ...state, planningVersion: 1 as const, releasePlans: [...plans, fresh] };
  fresh.fingerprint = planFingerprint(next, records);
  return withAudit(next, 'plan approved', `${fresh.entries.reduce((s, e) => s + e.recordIds.length, 0)} IMEIs reserved; none released`);
}
export function confirmRelease(state: RetailState, records: RetailRecord[], planId: string, entryId: string, today: string, allowOffDay = false): RetailState {
  const plan = state.releasePlans?.find(p => p.id === planId), entry = plan?.entries.find(e => e.id === entryId);
  if (!plan || !entry || entry.status !== 'scheduled' || entry.date > today || monthOf(today) !== monthOf(entry.date)) throw new Error('This release is not due in the current month.');
  if (!isAvailableAt(state, plan.request.personId, today) && !allowOffDay) throw new Error('The saved calendar marks this person off or on annual leave today. An explicit manual override is required.');
  if (plan.fingerprint !== planFingerprint(state, records)) throw new Error('Stock or targets changed. Review and approve an updated plan before releasing.');
  const eligible = new Map(eligibleStored(state, records).map(r => [r.id, r]));
  if (!entry.recordIds.length || entry.recordIds.some(id => !eligible.has(id) || eligible.get(id)!.personId !== plan.request.personId)) throw new Error('Assign these reserved phones to the selected person, then review the plan before releasing.');
  let next = syncSold(state, records, today).state;
  const event: ReleaseEvent = { id: uid(), at: new Date().toISOString(), date: today, personId: plan.request.personId, segment: entry.segment, recordIds: [...entry.recordIds], reportedIds: [], details: {}, status: 'released' };
  const meta = { ...next.recordMeta };
  for (const id of event.recordIds) {
    const r = eligible.get(id)!;
    meta[id] = { ...meta[id], status: 'sold' };
    event.details[id] = { personId: r.personId, segment: entry.segment, month: monthOf(today), code: itemFor(state, r.model)?.code || '', storage: variantOf(state, r).storage.replace(/\s+/g, '').toUpperCase(), date: today };
  }
  next = { ...next, recordMeta: meta, releases: [...(next.releases || []), event], releasePlans: next.releasePlans?.map(p => p.id === plan.id ? { ...p, entries: p.entries.map(e => e.id === entry.id ? { ...e, status: 'released', releaseId: event.id } : e) } : p) };
  next = syncSold(next, records, today).state;
  // Our own confirmed action is known: keep the remaining reservations valid. External changes still require review.
  const fingerprint = planFingerprint(next, records);
  next = { ...next, releasePlans: next.releasePlans?.map(p => p.id === plan.id ? { ...p, fingerprint } : p) };
  next = withAudit(next, 'release confirmed', `${event.recordIds.length} ${event.segment} sold; awaiting reporting`);
  return !isAvailableAt(state, plan.request.personId, today) ? withAudit(next, 'off-day override', `${today}: release of ${event.recordIds.length} ${event.segment} for ${event.personId} explicitly approved despite the saved off/annual-leave calendar.`) : next;
}
export function includeReleased(state: RetailState, ids: string[], alreadyIncluded = false): RetailState {
  const wanted = new Set(ids), pending = pendingReleases(state).filter(p => wanted.has(p.id));
  if (pending.length && !state.report) throw new Error('Paste or create a report before including released IMEIs.');
  let next = state.report ? { ...state, report: { ...state.report, releaseRevision: state.report.releaseRevision || uid() } } : state;
  if (!alreadyIncluded) for (const p of pending) next = bumpReport(next, p.event.details[p.id], 1, true);
  const included = new Set(pending.map(p => p.id));
  next = { ...next, releases: next.releases?.map(e => ({ ...e, reportedIds: [...new Set([...e.reportedIds, ...e.recordIds.filter(id => included.has(id))])], reportLinks: { ...e.reportLinks, ...Object.fromEntries(e.recordIds.filter(id => included.has(id)).map(id => [id, next.report!.releaseRevision!])) } })) };
  return withAudit(next, 'report inclusion', `${included.size} released IMEIs included; ${pendingReleases(next).length} awaiting reporting`);
}
export function undoRelease(state: RetailState, records: RetailRecord[], id: string, today: string): RetailState {
  const event = state.releases?.find(e => e.id === id && e.status === 'released');
  if (!event) return state;
  if (event.recordIds.some(rid => !records.some(r => r.id === rid) || state.recordMeta[rid]?.status !== 'sold')) throw new Error('Some phones changed or were deleted. Review them before undoing this release.');
  let next = state;
  for (const rid of event.reportedIds) if (event.reportLinks?.[rid] === next.report?.releaseRevision) next = bumpReport(next, event.details[rid], -1);
  const meta = { ...next.recordMeta };
  for (const rid of event.recordIds) meta[rid] = { ...meta[rid], status: 'held' };
  next = { ...next, recordMeta: meta, releases: next.releases?.map(e => e.id === id ? { ...e, status: 'undone', undoneAt: new Date().toISOString() } : e) };
  next = syncSold(next, records, today).state;
  return withAudit(next, 'release undone', `${event.recordIds.length} phones restored. Correct any report already shared outside the app.`);
}

/** Refresh calculations only. Actual releases always require the user's confirmation. */
export function refreshCalculatedPlans(state: RetailState, records: RetailRecord[], today: string): RetailState {
  let next = state, changed = false;
  const updated = new Set<string>();
  for (const plan of state.releasePlans || []) {
    if (plan.request.quantityMode === 'manual' || !plan.entries.some(e => e.status === 'scheduled') || plan.request.date > today || plan.request.until < today || monthOf(plan.request.date) !== monthOf(today)) continue;
    if (plan.calculatedFor === today && plan.fingerprint === planFingerprint(state, records)) continue;
    const request = { ...plan.request, date: today };
    const draft = draftPlan(next, records, request);
    next = { ...next, releasePlans: next.releasePlans?.map(p => p.id === plan.id ? { ...p, calculatedFor: today, request, entries: [...p.entries.filter(e => e.status !== 'scheduled'), ...draft.entries] } : p) };
    changed = true; updated.add(plan.id);
  }
  if (!changed) return state;
  const fingerprint = planFingerprint(next, records);
  next = { ...next, releasePlans: next.releasePlans?.map(p => updated.has(p.id) ? { ...p, fingerprint } : p) };
  return withAudit(next, 'daily plan recalculated', 'Updated upcoming quantities from real stock and achievement. No phones released.');
}
export function skipReleaseToday(state: RetailState, records: RetailRecord[], planId: string, today: string): RetailState {
  const plan = state.releasePlans?.find(p => p.id === planId);
  if (!plan) return state;
  const request = { ...plan.request, skipDates: [...new Set([...(plan.request.skipDates || []), today])] };
  const draft = draftPlan(state, records, { ...request, date: today });
  let next = { ...state, releasePlans: state.releasePlans?.map(p => p.id === planId ? { ...p, request, calculatedFor: today, entries: [...p.entries.filter(e => e.status !== 'scheduled'), ...draft.entries] } : p) };
  const fingerprint = planFingerprint(next, records);
  next = { ...next, releasePlans: next.releasePlans?.map(p => p.id === planId ? { ...p, fingerprint } : p) };
  return withAudit(next, 'no release today', 'No phones sold. Remaining quantities replanned within the approved end date.');
}
