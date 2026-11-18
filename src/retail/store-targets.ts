import { applyLeaveTransfer, equalShares } from './availability';
import { withAudit } from './data';
import type { RetailState } from './types';
export const promoterTotal = (state: RetailState, month: string, segment: string) => Object.values(state.targets[month] || {}).reduce((sum, person) => sum + (person.lines.find(l => l.segment === segment)?.target || 0), 0);
export const splitStoreTarget = (total: number, ids: string[]) => equalShares(Math.max(0, Math.floor(total)), ids);
/** Balanced monthly split; reapply existing AL adjustments after replacing the base shares. */
export function applyStoreTarget(state: RetailState, month: string, segment: string, total: number, shares: { personId: string; units: number }[]): RetailState {
  if (!Number.isInteger(total) || total < 0 || !shares.length || shares.some(s => !s.personId || !Number.isInteger(s.units) || s.units < 0) || new Set(shares.map(s => s.personId)).size !== shares.length || shares.reduce((n, s) => n + s.units, 0) !== total) throw new Error('Promoter shares must add up exactly to the store target.');
  const active = (state.leaveTransfers || []).filter(t => t.status === 'active' && t.adjustmentsApplied && t.start.slice(0, 7) === month);
  let next = state;
  for (const transfer of [...active].reverse()) next = applyLeaveTransfer(next, { ...transfer, status: 'cancelled' });
  const ids = [...new Set([...Object.keys(next.targets[month] || {}), ...shares.map(s => s.personId)])];
  for (const id of ids) {
    const target = next.targets[month]?.[id] || { personId: id, month, source: 'manual' as const, importedAt: new Date().toISOString(), lines: [] };
    const old = target.lines.find(l => l.segment === segment), units = shares.find(s => s.personId === id)?.units || 0;
    const line = { ...(old || { segment, achieved: 0 }), target: units, levels: old?.levels ? Object.fromEntries(Object.entries(old.levels).map(([level, value]) => [level, old.target ? Math.ceil((value || 0) * units / old.target) : Math.ceil(units * Number(level) / 100)])) : undefined };
    next = { ...next, targets: { ...next.targets, [month]: { ...next.targets[month], [id]: { ...target, lines: old ? target.lines.map(l => l.segment === segment ? line : l) : [...target.lines, line] } } } };
  }
  for (const transfer of active) next = applyLeaveTransfer(next, transfer);
  if (promoterTotal(next, month, segment) !== total) throw new Error('The adjusted promoter totals do not match the store target. Review the AL adjustments.');
  next = { ...next, storeTargets: { ...next.storeTargets, [month]: { ...next.storeTargets?.[month], [segment]: total } } };
  return withAudit(next, 'store target divided', `${month} ${segment}: store ${total}; base promoter shares ${shares.map(s => `${s.personId}=${s.units}`).join(', ')}. Active AL adjustments preserved. Sold and stock unchanged.`);
}
