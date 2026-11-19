import { useState } from 'react';
import { rejectTask, runTask, undoTask } from './AssistantTasks';
import { taskCheckpoint } from './retail/assistant-tasks';
import type { RetailCtx } from './retail/ui-helpers';

/**
 * A plan proposed by the AI agent, shown in the chat. It is only a proposal: nothing is applied until you press Approve. Every step is checked again against the
 * data when it runs, a removal still needs press-and-hold or CONFIRM on Home, each approved step is saved and checked, and Undo is available.
 */
const ICON: Record<string, string> = { done: '✓', failed: '✗', undone: '↺', skipped: '–', running: '…', pending: '○' };

export function AgentPlanCard({ ctx, taskId, summary, previewLines }: { ctx: RetailCtx; taskId: string; summary: string; previewLines: string[] }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const task = (ctx.latest?.() || ctx.state).assistantTasks?.find(t => t.id === taskId);
  if (!task) return null;
  const cp = taskCheckpoint(task), open = task.status === 'review' || task.status === 'failed' || task.status === 'running', pending = task.steps.some(s => s.status === 'pending' || s.status === 'failed');
  const go = async (one: boolean) => { setBusy(true); try { setNote(await runTask(ctx, taskId, { manual: true, one })); } finally { setBusy(false); } };
  return <section className="agent-plan" data-task-id={taskId} aria-label="Plan from the AI agent">
    <strong>Plan: {summary}</strong>
    <ol>{task.steps.map((s, i) => <li key={s.id} data-status={s.status}><span>{ICON[s.status] || '○'} {s.text}</span>{i === 0 && s.status === 'pending' && previewLines.length > 0 && <ul className="agent-plan-preview">{previewLines.map((l, k) => <li key={k}>{l}</li>)}</ul>}{s.error && <small> · {s.error}</small>}</li>)}</ol>
    <small>{cp.line} Later steps are checked again when they run.</small>
    <div className="share-toolbar">
      {open && pending && <button type="button" className="primary" disabled={busy || ctx.readOnly} onClick={() => void go(true)}>Approve next step</button>}
      {open && pending && task.steps.filter(s => s.status === 'pending').length > 1 && <button type="button" className="subtle-btn" disabled={busy || ctx.readOnly} onClick={() => void go(false)}>Approve all steps</button>}
      {open && <button type="button" className="subtle-btn" disabled={busy} onClick={() => { rejectTask(ctx, taskId); setNote('Plan rejected. Nothing else will be applied.'); }}>Reject plan</button>}
      {cp.canRollBack && <button type="button" className="plan-link" disabled={busy} onClick={() => { setBusy(true); void undoTask(ctx, taskId).then(setNote).finally(() => setBusy(false)); }}>Undo {cp.saved} saved step{cp.saved === 1 ? '' : 's'}</button>}
    </div>
    {note && <p role="status">{note}</p>}
  </section>;
}
