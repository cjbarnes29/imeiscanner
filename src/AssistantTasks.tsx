import { useState } from 'react';
import { useWorkflowOptions } from './AutoWorkflow';
import { readWorkflowOptions } from './retail/auto-workflow';
import { previewAssistant } from './retail/assistant-actions';
import { guardVerdict } from './retail/guard';
import { commitAssistantRequestVerified, queueAssistant } from './AssistantReview';
import { actionClasses, autopilotUsedToday, decideStep, finishTask, handoverSummary, isStaleError, MAX_STEP_RETRIES, newTask, patchStep, splitSteps, taskProgress, upsertTask, type StepDecision } from './retail/assistant-tasks';
import { withAudit } from './retail/data';
import { waitForManualIdle } from './processing-options';
import { recordDiagnostic } from './diagnostics';
import { notifyWhatsAppReady } from './whatsapp-ready';
import { setActivity } from './assistant-activity';
import type { AssistantMode, AssistantTask } from './retail/types';
import type { RetailCtx } from './retail/ui-helpers';

/**
 * Task runner: many steps from one request, run in order, one step at a time, each through the same
 * preview -> apply -> receipt -> Undo path as a single request. Assistant = you approve each step,
 * Copilot = you approve the whole task once, Autopilot = allowed kinds apply by themselves.
 * Mode and permissions are changed only in Settings, never by chat, so the assistant cannot widen its own rights.
 */
const stopped = new Set<string>(), active = new Set<string>();
const latestTask = (ctx: RetailCtx, id: string) => (ctx.latest?.() || ctx.state).assistantTasks?.find(t => t.id === id);
const nowIso = () => new Date().toISOString();
/** Same context, but with the records as they are at this moment. Every step must see what the step before it did. */
const fresh = (ctx: RetailCtx): RetailCtx => ({ ...ctx, records: ctx.latestRecords?.() || ctx.records, people: ctx.latestPeople?.() || ctx.people });
const actionable = (p: ReturnType<typeof previewAssistant>) => !!(p.giving.length || p.report || p.settings || p.business || p.people || p.moves?.length || p.additions?.length);

function saveTask(ctx: RetailCtx, task: AssistantTask, audit?: [string, string]) {
  const state = upsertTask(ctx.latest?.() || ctx.state, task);
  ctx.change(audit ? withAudit(state, audit[0], audit[1]) : state, '');
}
function edit(ctx: RetailCtx, id: string, change: (t: AssistantTask) => AssistantTask, audit?: [string, string]) {
  const task = latestTask(ctx, id); if (!task) return;
  saveTask(ctx, finishTask(change(task), nowIso()), audit);
}
function rejectRequest(ctx: RetailCtx, requestId: string, why: string) {
  const state = ctx.latest?.() || ctx.state;
  ctx.change({ ...state, assistantRequests: state.assistantRequests?.map(r => r.id === requestId && r.status === 'pending' ? { ...r, status: 'rejected' as const, output: `${r.output}\nStopped by the task runner: ${why}`.slice(0, 15000) } : r) }, '');
}

/** Turns one chat message into a task. Returns handled=false when the normal single-request path should answer instead. */
export function startAssistantTask(base: RetailCtx, text: string): { handled: boolean; message: string; taskId?: string } {
  const ctx = fresh(base);
  const options = readWorkflowOptions(), mode = options.assistantMode, state = ctx.latest?.() || ctx.state;
  // 1. An explicit sequence ("A, then B") whose every part is understood becomes a task: safer than trusting one parse of a combined sentence.
  const parts = splitSteps(text);
  const understood = (list: string[]) => list.every((t, i) => { if (guardVerdict(t).kind !== 'command') return false; const p = previewAssistant(state, ctx.records, ctx.people, ctx.today, t); return p.handled && (i > 0 || (!p.blockers.length && actionable(p))); });
  let steps: string[] = [];
  if (parts.length >= 2 && understood(parts)) steps = parts;
  else {
    // 2. A sentence the assistant already understands as one request stays one request ("change flagship 3 target to 12 and divide it to promoters").
    const whole = previewAssistant(state, ctx.records, ctx.people, ctx.today, text.trim());
    if (mode !== 'assistant' && whole.handled && !whole.blockers.length && actionable(whole)) steps = [text.trim()];
  }
  // 3. Anything unclear keeps the original single-request answer.
  if (!steps.length) return { handled: false, message: '' };
  if ((state.assistantTasks || []).filter(t => t.status === 'review' || t.status === 'running').length >= 10) return { handled: true, message: 'Finish or reject some open tasks first (the limit is 10). Nothing was started.' };
  let n = 0;
  const task = newTask(crypto.randomUUID(), text.slice(0, 1000), mode, steps, nowIso(), () => `${Date.now().toString(36)}-${++n}`);
  saveTask(ctx, { ...task, status: 'review' }, ['assistant task started', `${mode}: ${text.slice(0, 200)} · ${steps.length} step${steps.length === 1 ? '' : 's'}`]);
  recordDiagnostic('assistant-task-start');
  if (mode === 'autopilot') { void runTask(ctx, task.id, { manual: false }); return { handled: true, taskId: task.id, message: `Autopilot started ${steps.length} step${steps.length === 1 ? '' : 's'}. Allowed steps apply by themselves; anything else waits for you under Tasks on Home.` }; }
  return { handled: true, taskId: task.id, message: mode === 'copilot' ? `Task ready: ${steps.length} step${steps.length === 1 ? '' : 's'}. Review it under Tasks on Home, then approve it once.` : `Task ready: ${steps.length} step${steps.length === 1 ? '' : 's'}. Under Tasks on Home you approve each step.` };
}

type RunOptions = { manual: boolean; one?: boolean; override?: boolean };
/** Runs pending steps in order. A person pressing a button counts as the approval (manual); otherwise the mode's rules decide. */
export async function runTask(ctx: RetailCtx, taskId: string, opts: RunOptions): Promise<string> {
  if (active.has(taskId)) return 'This task is already running.';
  active.add(taskId); stopped.delete(taskId);
  try { return await runLoop(ctx, taskId, opts); } finally { active.delete(taskId); }
}
async function runLoop(base: RetailCtx, taskId: string, opts: RunOptions): Promise<string> {
  let ctx = fresh(base);
  const first = latestTask(ctx, taskId); if (!first) return 'Task not found.';
  // recover from a closed app: a step left "running" is looked at again; a person retrying resets the counter
  edit(ctx, taskId, t => ({ ...t, steps: t.steps.map(s => s.status === 'running' || (opts.manual && s.status === 'failed') ? { ...s, status: 'pending' as const, attempts: opts.manual ? 0 : s.attempts, error: undefined } : s) }));
  const options = readWorkflowOptions();
  let message = '', ran = 0;
  setActivity('task', 'checking');
  try {
    for (;;) {
      const task = latestTask(ctx, taskId); if (!task) break;
      if (stopped.has(taskId)) { message = 'Stopped. Steps already applied stay applied and can be undone.'; break; }
      const step = task.steps.find(s => s.status === 'pending'); if (!step) break;
      if (!opts.manual) await waitForManualIdle(); // yield to manual edits and keep the screen responsive
      else await new Promise(r => setTimeout(r, 0));
      if (stopped.has(taskId)) continue;
      ctx = fresh(base);
      const state = ctx.latest?.() || ctx.state, preview = previewAssistant(state, ctx.records, ctx.people, ctx.today, step.text), classes = actionClasses(preview, step.text);
      const decision: StepDecision = guardVerdict(step.text).kind !== 'command' ? { action: 'blocked', reason: 'This does not read as a clear request, so nothing was applied.' } : classes.includes('remove') && opts.manual ? { action: 'hold', reason: 'Removing something needs your explicit confirmation on Home: ask for it on its own, then press and hold the button (or type CONFIRM for a big change).' } : opts.manual
        ? preview.blockers.length ? { action: 'blocked', reason: preview.blockers.join(' ') } : !classes.length ? { action: 'hold', reason: 'Nothing to change for this step.' } : preview.warnings.length && !opts.override ? { action: 'hold', reason: 'This step has warnings. Tick “I reviewed the warnings” and approve again.' } : { action: 'apply', reason: 'Approved by you.' }
        : decideStep(task.mode, preview, classes, { allow: options.autopilotAllow, dailyCap: options.autopilotDailyCap, usedToday: autopilotUsedToday(state, ctx.today) });
      if (decision.action !== 'apply') {
        edit(ctx, taskId, t => patchStep(t, step.id, { classes, status: decision.action === 'blocked' ? 'failed' : 'pending', error: decision.reason }, nowIso()));
        message = decision.reason; break;
      }
      edit(ctx, taskId, t => patchStep(t, step.id, { classes, status: 'running', attempts: step.attempts + 1, error: undefined }, nowIso()));
      let requestId = '';
      try {
        const queued = queueAssistant(ctx, step.text);
        if (!queued?.saved || !queued.id || !queued.pending) throw new Error(queued && !queued.saved ? 'Too many requests are waiting on Home. Review or reject some first.' : 'This step could not be turned into a change.');
        requestId = queued.id;
        const done = await commitAssistantRequestVerified(ctx, requestId, { override: !!opts.override, notify: false, actor: opts.manual ? 'you' : 'agent' });
        if (done.verify.status === 'unverified') throw new Error(done.message);
        edit(ctx, taskId, t => patchStep(t, step.id, { status: 'done', requestId, doneAt: nowIso(), error: undefined }, nowIso()));
        ran++;
        if (!opts.manual && classes.includes('whatsapp')) notifyWhatsAppReady((ctx.latest?.() || ctx.state).deliveryPackets?.filter(p => p.kind === 'report' && p.status === 'prepared').slice(-1)[0]); // nobody is watching: tell the person it is ready (they still tap Send)
        if (classes.includes('add-stock') || classes.includes('remove')) { message = 'Applied. This step changed the phone list, so the next step waits: approve again to continue.'; break; }
      } catch (e) {
        const why = (e as Error).message;
        if (requestId) rejectRequest(ctx, requestId, why);
        const attempts = (latestTask(ctx, taskId)?.steps.find(s => s.id === step.id)?.attempts) || 1;
        if (isStaleError(why) && attempts <= MAX_STEP_RETRIES) { edit(ctx, taskId, t => patchStep(t, step.id, { status: 'pending', error: `Retrying: ${why}` }, nowIso())); continue; }
        edit(ctx, taskId, t => patchStep(t, step.id, { status: 'failed', error: why.slice(0, 500) }, nowIso()));
        message = `Stopped at “${step.text}”: ${why}`; recordDiagnostic('assistant-task-step-failed', e); break;
      }
      if (opts.one) break;
    }
  } finally { setActivity('task', null); }
  const done = latestTask(ctx, taskId);
  if (done) edit(ctx, taskId, t => t, ['assistant task progress', `${done.text.slice(0, 120)} · ${taskProgress(done).done}/${done.steps.length} steps done · ${opts.manual ? 'you approved' : done.mode}`]);
  return message || (ran ? `${ran} step${ran === 1 ? '' : 's'} applied.` : 'Nothing to apply.');
}

/** Undo every applied step, newest first. Stops at the first step that cannot be undone safely (newer edits are never overwritten). */
export async function undoTask(ctx: RetailCtx, taskId: string): Promise<string> {
  const task = latestTask(ctx, taskId); if (!task) return 'Task not found.';
  for (const step of [...task.steps].reverse().filter(s => s.status === 'done' && s.requestId)) {
    try { const done = await commitAssistantRequestVerified(ctx, step.requestId!, { undo: true, notify: false, actor: 'you' }); if (done.verify.status === 'unverified') throw new Error(done.message); edit(ctx, taskId, t => patchStep(t, step.id, { status: 'undone', error: undefined }, nowIso())); }
    catch (e) { const why = (e as Error).message; edit(ctx, taskId, t => patchStep(t, step.id, { error: `Undo blocked: ${why}`.slice(0, 500) }, nowIso())); return `Undo stopped at “${step.text}”: ${why}`; }
  }
  edit(ctx, taskId, t => ({ ...t, steps: t.steps.map(s => s.status === 'pending' ? { ...s, status: 'skipped' as const } : s) }), ['assistant task undone', task.text.slice(0, 200)]);
  return 'Task undone. Receipts are saved in History.';
}
export function rejectTask(ctx: RetailCtx, taskId: string) {
  stopped.add(taskId);
  edit(ctx, taskId, t => ({ ...t, status: 'rejected' as const, steps: t.steps.map(s => s.status === 'pending' || s.status === 'failed' ? { ...s, status: 'skipped' as const } : s) }), ['assistant task rejected', latestTask(ctx, taskId)?.text.slice(0, 200) || '']);
}
export const stopTask = (id: string) => { stopped.add(id); };

const MODE_LABEL: Record<AssistantMode, string> = { assistant: 'Assistant · you approve each step', copilot: 'Copilot · you approve once', autopilot: 'Autopilot · allowed steps apply themselves' };

export function AssistantTasks(ctx: RetailCtx) {
  const options = useWorkflowOptions(), [message, setMessage] = useState(''), [override, setOverride] = useState(false), [handover, setHandover] = useState<{ lines: string[]; next: string[] } | null>(null);
  const tasks = [...(ctx.state.assistantTasks || [])].reverse().slice(0, 5);
  const run = async (id: string, o: RunOptions) => { setMessage(await runTask(ctx, id, o)); };
  return <details className="retail-card assistant-tasks" open={tasks.some(t => t.status === 'review' || t.status === 'running')}>
    <summary><strong>Tasks · {MODE_LABEL[options.assistantMode]}</strong>{tasks.some(t => t.status === 'review') ? ' · needs you' : ''}</summary>
    <p className="settings-help">Several steps from one request, run in order. Every step is a normal request with a receipt and Undo. Change the mode and what Autopilot may do in Settings.</p>
    <div className="share-toolbar"><button className="plan-link" onClick={() => setHandover(handoverSummary(ctx.latest?.() || ctx.state, Date.now()))}>Handover summary</button></div>
    {handover && <section className="plan-preview-row" aria-label="Handover summary"><strong>Handover summary</strong>{handover.lines.map((l, i) => <p key={i}>{l}</p>)}<strong>Next</strong>{handover.next.map((l, i) => <p key={i}>{l}</p>)}<div className="share-toolbar"><button className="plan-link" onClick={() => ctx.share(`AI LENS handover\n${handover.lines.join('\n')}\nNext:\n${handover.next.join('\n')}`)}>Share</button><button className="plan-link" onClick={() => setHandover(null)}>Close</button></div></section>}
    {message && <p role="status">{message}</p>}
    {!tasks.length && <p className="settings-help">No tasks yet. Try: “store 4 Fold6, then give 4 Fold6 to {ctx.people[0]?.name || 'a person'}”.</p>}
    {tasks.map(task => { const progress = taskProgress(task), open = task.status === 'review' || task.status === 'running' || task.status === 'failed'; return <article className="plan-preview-row" key={task.id} data-task-id={task.id}>
      <div className="plan-top"><strong>{task.text}</strong><span className="plan-badge">{task.status} · {task.mode}</span></div>
      <div className="task-bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${progress.done} of ${progress.total} steps done`}><span style={{ width: `${progress.percent}%` }} /></div>
      <ol>{task.steps.map(s => <li key={s.id}><span>{s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'undone' ? '↺' : s.status === 'skipped' ? '–' : s.status === 'running' ? '…' : '○'} {s.text}</span>{s.error && <small> · {s.error}</small>}</li>)}</ol>
      <div className="share-toolbar">
        {open && task.status !== 'running' && <label className="practice-choice"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />I reviewed the warnings</label>}
        {open && task.status !== 'running' && task.mode === 'assistant' && <button className="plan-link" onClick={() => void run(task.id, { manual: true, one: true, override })}>Approve next step</button>}
        {open && task.status !== 'running' && task.mode !== 'assistant' && <button className="plan-link" onClick={() => void run(task.id, { manual: true, override })}>Approve all remaining steps</button>}
        {task.status === 'running' && <button className="plan-link" onClick={() => { stopTask(task.id); setMessage('Stopping after the current step.'); }}>Stop</button>}
        {task.steps.some(s => s.status === 'done') && task.status !== 'undone' && <button className="plan-link" onClick={() => { void undoTask(ctx, task.id).then(setMessage); }}>Undo applied steps</button>}
        {open && <button className="plan-link" onClick={() => rejectTask(ctx, task.id)}>Reject the rest</button>}
      </div>
    </article>; })}
  </details>;
}
