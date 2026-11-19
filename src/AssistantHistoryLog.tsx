import { useState } from 'react';
import { exportLog, FILTER_LABEL, filterLog, logLine, logTotals, type LogFilter } from './agent/log-view';
import type { RetailCtx } from './retail/ui-helpers';

/** What the assistant did, newest first: who asked, which tool, what happened and whether the saved data was checked. Read-only; nothing here changes data. */
export function AssistantHistoryLog(ctx: RetailCtx) {
  const [filter, setFilter] = useState<LogFilter>('all'), [shown, setShown] = useState(20);
  const log = ctx.state.agentLog || [];
  if (!log.length) return null;
  const rows = filterLog(log, filter), totals = logTotals(log);
  return <details className="retail-card assistant-history-log">
    <summary><strong>Assistant history · {totals.total}</strong>{totals.unconfirmed ? ` · ${totals.unconfirmed} not confirmed saved` : ''}</summary>
    <p className="settings-help">{totals.applied} applied, {totals.undone} undone, {totals.problems} stopped or waiting. IMEIs are masked.</p>
    <div className="share-toolbar" role="group" aria-label="Filter history">
      {(Object.keys(FILTER_LABEL) as LogFilter[]).map(f => <button key={f} type="button" className="plan-link" aria-pressed={filter === f} onClick={() => { setFilter(f); setShown(20); }}>{FILTER_LABEL[f]}</button>)}
      <button type="button" className="plan-link" onClick={() => ctx.share(exportLog(log, filter))}>Share</button>
    </div>
    {!rows.length && <p className="settings-help">Nothing in this view.</p>}
    <ol className="history-log-list">{rows.slice(0, shown).map(e => <li key={e.id} data-outcome={e.outcome} data-verify={e.verify}>{logLine(e)}</li>)}</ol>
    {rows.length > shown && <button type="button" className="plan-link" onClick={() => setShown(n => n + 20)}>Show more ({rows.length - shown} left)</button>}
  </details>;
}
