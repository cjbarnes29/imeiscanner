import { useMemo } from 'react';
import { useWorkflowOptions } from './AutoWorkflow';
import { showSuggestions } from './retail/auto-workflow';
import { previewRosterLeave, rosterLeaveRanges, saveRosterLeave, type RosterLeaveRange } from './retail/leave-bridge';
import { segLabel } from './retail/segments';
import { type RetailCtx, who } from './retail/ui-helpers';

/** Shift Calendar -> annual leave. Shows AL days found in imported rosters with the calculated effect; saving the range never changes targets. */
export function RosterLeavePanel(ctx: RetailCtx) {
  const options = useWorkflowOptions();
  const ranges = useMemo(() => rosterLeaveRanges(ctx.state), [ctx.state]);
  if (!showSuggestions(options, 'leave') || !ranges.length) return null;
  const save = (range: RosterLeaveRange) => {
    try {
      const state = ctx.latest?.() || ctx.state;
      ctx.change(saveRosterLeave(state, range, who(ctx, range.personId)), 'leave range from shift roster');
      ctx.notify(`Annual leave saved. Targets are unchanged. To review the target calculation open Give & share → Availability & calculation days → Edit dates / target adjustment (global policy: ${options.targetLinkMode === 'linked' ? 'Linked, you approve before targets change' : 'Manual only, targets stay unchanged'}).`);
    } catch (error) { ctx.notify((error as Error).message); }
  };
  return <section className="retail-card roster-leave" aria-label="Annual leave found in the shift calendar">
    <h3>Annual leave in the shift calendar ({ranges.length})</h3>
    <p className="settings-help">These AL days are not yet in the annual-leave target calculation. Saving a range records the leave only; targets change only after you review and apply the calculation. Hide this in Settings → AI integration.</p>
    {ranges.map(range => {
      const preview = previewRosterLeave(ctx.state, range, ctx.people.filter(p => p.id !== range.personId).map(p => p.id), ctx.today);
      return <article className="plan-preview-row" key={`${range.personId}-${range.start}`}>
        <div className="plan-top"><strong>{who(ctx, range.personId)}</strong><span className="plan-badge">{range.start === range.end ? range.start : `${range.start} → ${range.end}`} · {range.leaveDays} AL day{range.leaveDays === 1 ? '' : 's'}</span></div>
        {preview.segments.length ? preview.segments.map(s => <p key={s.segment}>{segLabel(ctx.state, s.segment)}: {s.total} moves to {s.shares.length ? s.shares.map(p => `${who(ctx, p.personId)} +${p.units}`).join(', ') : 'nobody available'}</p>) : <p className="settings-help">No target set for {range.month}, so there is nothing to move.</p>}
        <small>Month {preview.monthDays} days − {preview.leaveDays} AL = divisor {preview.divisor}. Preview only.</small>
        <div className="share-toolbar"><button className="plan-link" onClick={() => save(range)}>Save as annual leave (targets unchanged)</button></div>
      </article>;
    })}
  </section>;
}
