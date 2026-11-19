import { useEffect, useRef, useState } from 'react';
import { onAgent, type AgentEvent, type AgentPhase } from './agent/events';
import { runTask, stopTask } from './AssistantTasks';
import type { RetailCtx } from './retail/ui-helpers';

/**
 * Compact, collapsible progress panel for the assistant: what it is doing right now (thinking, planning, applying a step, checking the saved data),
 * how far a task is, and Cancel / Retry. It only listens to events; it never changes data by itself (Retry is a person pressing a button).
 * Animations use transform and opacity only, so they stay smooth in the Android WebView; they stop for people who asked for reduced motion.
 */
const LABEL: Record<AgentPhase, string> = { thinking: 'Reading your request', planning: 'Planning the steps', 'step-start': 'Applying a step', 'step-done': 'Step saved', 'step-error': 'A step stopped', verifying: 'Checking the saved data', verified: 'Saved and checked', unverified: 'Applied, but not confirmed', failed: 'Stopped', cancelled: 'Cancelled', idle: 'Ready' };
const BUSY: AgentPhase[] = ['thinking', 'planning', 'step-start', 'verifying'];
const BAD: AgentPhase[] = ['step-error', 'failed', 'unverified'];
const SHOW_MS = 9000, STALE_MS = 25000;

export function AgentProgress(ctx: RetailCtx) {
  const [events, setEvents] = useState<AgentEvent[]>([]), [open, setOpen] = useState(false), [now, setNow] = useState(Date.now()), [note, setNote] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => onAgent(e => { setNow(Date.now()); setEvents(list => (e.phase === 'idle' ? [] : [...list, e]).slice(-8)); }), []);
  useEffect(() => { window.clearInterval(timer.current); if (events.length) timer.current = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer.current); }, [events.length]);
  const last = events[events.length - 1];
  if (!last) return null;
  const age = now - last.at, busy = BUSY.includes(last.phase) && age < STALE_MS, bad = BAD.includes(last.phase), taskId = [...events].reverse().find(e => e.taskId)?.taskId;
  if (!busy && !bad && age > SHOW_MS) return null;
  const withTotal = [...events].reverse().find(e => e.total), percent = withTotal?.total ? Math.round(((withTotal.done || 0) / withTotal.total) * 100) : busy ? 0 : 100;
  return <section className="agent-progress" role="status" aria-live="polite" data-phase={last.phase} data-busy={busy ? 'true' : 'false'}>
    <button type="button" className="agent-progress-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="agent-pulse" aria-hidden="true"><i /><i /><i /></span>
      <span className="agent-progress-label">{LABEL[last.phase]}{last.text ? ` · ${last.text.slice(0, 60)}` : ''}</span>
      {withTotal?.total ? <span className="agent-progress-count">{withTotal.done || 0}/{withTotal.total}</span> : null}
    </button>
    <div className="agent-bar" aria-hidden="true"><span style={{ transform: `scaleX(${percent / 100})` }} /></div>
    {open && <ol className="agent-steps">{events.map((e, i) => <li key={i} data-phase={e.phase}>{LABEL[e.phase]}{e.text ? ` · ${e.text.slice(0, 80)}` : ''}</li>)}</ol>}
    {taskId && (busy || bad) && <div className="agent-actions">
      {busy && <button type="button" className="plan-link" onClick={() => { stopTask(taskId); setNote('Cancelling after the current step. Steps already saved stay saved and can be undone.'); }}>Cancel</button>}
      {bad && <button type="button" className="plan-link" onClick={() => { setNote('Retrying…'); void runTask(ctx, taskId, { manual: true }).then(setNote); }}>Retry</button>}
    </div>}
    {note && <small>{note}</small>}
  </section>;
}
