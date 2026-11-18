import type { AssistantPreview } from './assistant-actions';
import type { AssistantMode, AssistantTask, AssistantTaskStep, RetailState } from './types';

/**
 * Multi-step assistant tasks. Pure logic only: nothing here changes stock, targets or reports.
 * Every step still goes through the existing preview -> approve -> receipt -> Undo flow.
 */
export const MAX_TASK_STEPS = 8;
export const MAX_STEP_RETRIES = 2;

const VERBS = 'store|hold|give|make|mark|set|prepare|add|remove|split|divide|create|turn|change|update|put|assign|move|check|show|delete';
const BREAK = new RegExp(`\\s*(?:;|\\n|,?\\s+(?:and\\s+)?then\\s+|,\\s+and\\s+(?=(?:${VERBS})\\b)|\\s+and\\s+(?=(?:${VERBS})\\b))\\s*`, 'i');

/** "store 4 Fold6 and set report Fold6 to 6, then mark Maya unavailable ..." -> separate steps. "give 4 to A and 10 to B" stays one step. */
export function splitSteps(text: string): string[] {
  const clean = text.trim().replace(/[ \t]+/g, ' ');
  if (!clean) return [];
  return clean.split(BREAK).map(part => part.trim().replace(/^(?:and|then|also|please)\s+/i, '').replace(/[.,;]+$/, '').trim()).filter(Boolean).slice(0, MAX_TASK_STEPS);
}

/** What kinds of change a previewed step would make. Used for permissions. */
export function actionClasses(preview: AssistantPreview, text: string): string[] {
  const out = new Set<string>();
  if (preview.giving.length) out.add('give');
  if (preview.additions?.length) out.add('add-stock');
  if (preview.report) out.add('report');
  if (preview.settings) out.add('settings');
  if (preview.people) { out.add('people'); if (preview.people.ops.some(op => op.kind === 'delete')) out.add('remove'); }
  const after = preview.business?.after || {};
  if ('recordMeta' in after) out.add(/\b(?:remove|delete)\b/i.test(text) ? 'remove' : 'stock');
  if ('targets' in after || 'storeTargets' in after) out.add('targets');
  if ('workSchedules' in after || 'leaveTransfers' in after) out.add('calendar');
  if ('accessoryStock' in after || 'accessoryReport' in after) out.add('accessory');
  if ('assistantRoutines' in after) out.add('routine');
  if ('deliveryPackets' in after) out.add('whatsapp');
  return [...out];
}

export type Autopilot = { allow: string[]; dailyCap: number; usedToday: number };
export type StepDecision = { action: 'apply' | 'hold' | 'blocked'; reason: string };

/**
 * Who applies a step. Assistant and Copilot never apply by themselves. Autopilot applies only
 * allowed kinds, with no warnings, no removals, and within the daily cap; everything else waits for review.
 */
export function decideStep(mode: AssistantMode, preview: AssistantPreview, classes: string[], autopilot: Autopilot): StepDecision {
  if (preview.blockers.length) return { action: 'blocked', reason: preview.blockers.join(' ') };
  if (!classes.length) return { action: 'hold', reason: 'Nothing to change.' };
  if (mode === 'assistant') return { action: 'hold', reason: 'Assistant mode: waiting for your approval.' };
  if (mode === 'copilot') return { action: 'hold', reason: 'Copilot mode: approve the whole task once.' };
  if (preview.warnings.length) return { action: 'hold', reason: 'Has warnings, so it needs your review.' };
  if (classes.includes('remove')) return { action: 'hold', reason: 'Removing phones or people always needs your approval.' };
  const notAllowed = classes.filter(c => !autopilot.allow.includes(c));
  if (notAllowed.length) return { action: 'hold', reason: `Autopilot is not allowed to change: ${notAllowed.join(', ')}.` };
  if (autopilot.usedToday >= autopilot.dailyCap) return { action: 'hold', reason: `Autopilot daily limit of ${autopilot.dailyCap} actions reached.` };
  return { action: 'apply', reason: 'Allowed for Autopilot.' };
}

/** Steps Autopilot already applied today (counted from saved tasks, so a restart cannot reset the limit). */
export function autopilotUsedToday(state: Pick<RetailState, 'assistantTasks'>, today: string): number {
  return (state.assistantTasks || []).filter(t => t.mode === 'autopilot').reduce((n, t) => n + t.steps.filter(s => s.status === 'done' && (s.doneAt || '').slice(0, 10) === today).length, 0);
}

/** Errors that mean "the data moved under the preview": worth one fresh look, never a blind repeat. */
export const isStaleError = (message: string) => /changed|no longer pending|moved|review the (?:updated|refreshed)/i.test(message);

export const newTask = (id: string, text: string, mode: AssistantMode, stepTexts: string[], now: string, stepId: () => string): AssistantTask =>
  ({ id, text, mode, status: 'running', at: now, updatedAt: now, steps: stepTexts.map(t => ({ id: stepId(), text: t, status: 'pending' as const, attempts: 0, classes: [] })) });

export const patchStep = (task: AssistantTask, stepId: string, patch: Partial<AssistantTaskStep>, now: string): AssistantTask =>
  ({ ...task, updatedAt: now, steps: task.steps.map(s => s.id === stepId ? { ...s, ...patch } : s) });

/** Task status follows its steps. */
export function finishTask(task: AssistantTask, now: string): AssistantTask {
  const steps = task.steps;
  if (task.status === 'rejected') return { ...task, updatedAt: now };
  const status: AssistantTask['status'] = steps.some(s => s.status === 'running') ? 'running'
    : steps.some(s => s.status === 'failed') ? 'failed'
    : steps.every(s => s.status === 'undone' || s.status === 'skipped') && steps.some(s => s.status === 'undone') ? 'undone'
    : steps.every(s => s.status === 'done' || s.status === 'skipped') ? 'done'
    : 'review';
  return { ...task, status, updatedAt: now };
}

export function taskProgress(task: AssistantTask) {
  const total = task.steps.length, done = task.steps.filter(s => s.status === 'done').length;
  return { done, total, percent: total ? Math.round(done / total * 100) : 0 };
}

export const upsertTask = (state: RetailState, task: AssistantTask): RetailState =>
  ({ ...state, assistantTasks: [...(state.assistantTasks || []).filter(t => t.id !== task.id), task].slice(-50) });

/** Short, plain summary of the last 24 hours for the next person (or the next session) to pick up. Built from saved data, so it costs no model tokens. */
export function handoverSummary(state: RetailState, now: number): { lines: string[]; next: string[] } {
  const since = now - 24 * 3600 * 1000, recent = (at: string) => Date.parse(at) >= since;
  const requests = (state.assistantRequests || []).filter(r => recent(r.at));
  const tasks = (state.assistantTasks || []).filter(t => recent(t.updatedAt) || t.status === 'review' || t.status === 'running');
  const applied = requests.filter(r => r.status === 'applied'), undone = requests.filter(r => r.status === 'undone'), rejected = requests.filter(r => r.status === 'rejected');
  const pending = (state.assistantRequests || []).filter(r => r.status === 'pending');
  const failedSteps = tasks.flatMap(t => t.steps.filter(s => s.status === 'failed').map(s => `${s.text}: ${s.error || 'failed'}`));
  const lines: string[] = [];
  lines.push(`Last 24 hours: ${applied.length} change${applied.length === 1 ? '' : 's'} applied, ${undone.length} undone, ${rejected.length} rejected.`);
  for (const r of applied.slice(-5)) lines.push(`Done: ${r.text}`);
  if (tasks.length) lines.push(`Tasks: ${tasks.map(t => `${t.text.slice(0, 40)}${t.text.length > 40 ? '…' : ''} (${t.mode}, ${t.status}, ${taskProgress(t).done}/${t.steps.length})`).join(' · ')}`);
  const autoApplied = tasks.filter(t => t.mode === 'autopilot').reduce((n, t) => n + t.steps.filter(s => s.status === 'done' && recent(s.doneAt || '')).length, 0);
  if (autoApplied) lines.push(`Autopilot applied ${autoApplied} step${autoApplied === 1 ? '' : 's'} by itself. Each can be undone from History.`);
  const next: string[] = [];
  if (pending.length) next.push(`${pending.length} request${pending.length === 1 ? '' : 's'} waiting for your approval on Home.`);
  for (const f of failedSteps.slice(0, 3)) next.push(`Failed step: ${f}`);
  const routines = (state.assistantRoutines || []).filter(r => r.enabled).length;
  if (routines) next.push(`${routines} daily routine${routines === 1 ? '' : 's'} active.`);
  if (!next.length) next.push('Nothing is waiting. No open tasks.');
  return { lines, next };
}
