import { PlanModal } from './RetailPlan';
import { segmentOf } from './retail/catalog';
import { segLabel } from './retail/segments';
import { monthOf, type RetailState } from './retail/types';
import type { RetailCtx, RetailRecord } from './retail/ui-helpers';
import { availabilityAt } from './retail/availability';
import { withAudit } from './retail/data';

export function UploadDisposition({ state, records, today, change, notify, openPlan, openExport }: Pick<RetailCtx, 'state' | 'records' | 'today' | 'change' | 'notify'> & { openPlan: () => void; openExport?: () => void }) {
  const ids = new Set(state.pendingUploadIds || []), pending = records.filter(r => ids.has(r.id));
  const groups = new Map<string, RetailRecord[]>();
  for (const r of pending) { const segment = segmentOf(state, r.model, monthOf(today), state.recordMeta[r.id]); groups.set(segment, [...(groups.get(segment) || []), r]); }
  const decide = (choice: 'available' | 'stored' | 'plan') => {
    const absent = pending.filter(r => r.personId && availabilityAt(state, r.personId, today) !== 'working');
    if (choice === 'available' && absent.length && !window.confirm(`${absent.length} phones belong to people who are Not available today. Automatic giving skips them. Make these phones available anyway? This override will be recorded in History.`)) return;
    const meta = { ...state.recordMeta };
    for (const r of pending) if (meta[r.id]?.status === 'held') {
      if (choice === 'available') { const { status: _, ...rest } = meta[r.id]; meta[r.id] = rest; }
    }
    let next: RetailState = { ...state, recordMeta: meta, pendingUploadIds: [] };
    if (choice === 'available' && absent.length) next = withAudit(next, 'off-day override', `${today}: ${absent.length} newly uploaded phones made available for unavailable owners after explicit confirmation.`);
    change(next, `upload ${choice}`);
    notify(choice === 'available' ? `${pending.length} phones made available. No sales recorded.` : `${pending.length} phones stored. Included in real unsold stock; no sales recorded.`);
    if (choice === 'plan') openPlan();
  };
  return <PlanModal title="Where should these phones go?" close={() => decide('stored')}><span className="plan-eyebrow">SCAN COMPLETE</span><h3>{pending.length} phone{pending.length === 1 ? '' : 's'} ready for your decision</h3><p className="plan-alert"><strong>Storage: inside RetailLens on this phone.</strong> No special folder is needed. Export creates a separate copy in your chosen location; photos need the picture export.</p><p className="settings-help">Review segment totals. Invalid or duplicate IMEIs still need review before they can be released.</p>{[...groups].map(([segment, rows]) => <div key={segment} className="plan-preview-row plan-top"><strong>{segLabel(state, segment)}</strong><span>{rows.length} phones</span></div>)}<p className="plan-alert">All unsold phones count in real stock. Storing or making phones available does not increase sold totals or target achievement.</p><div className="plan-upload-actions"><button className="primary" onClick={() => decide('available')}>Use now <small>Make available for normal giving</small></button><button className="subtle-btn" onClick={() => decide('stored')}>Store for now <small>Keep IMEIs for a later release</small></button><button className="subtle-btn" onClick={() => decide('plan')}>Plan release <small>Calculate quantities for today and next</small></button></div><details><summary>More options · save an external copy</summary><button className="subtle-btn" onClick={() => { decide('stored'); openExport?.(); }}>Store now & open Export</button><p className="settings-help">Export IMEI files, the retail backup and photos separately. Scanning and live previews do not automatically share or release phones.</p></details></PlanModal>;
}
