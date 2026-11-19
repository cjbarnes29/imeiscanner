import type { AgentLogEntry } from '../retail/types';
import { maskImeis } from './log';

/** Pure helpers for the assistant's history screen: filter, one plain line per entry, and a text export. IMEIs are always masked. */
export type LogFilter = 'all' | 'changes' | 'problems' | 'unconfirmed';

export const FILTER_LABEL: Record<LogFilter, string> = { all: 'Everything', changes: 'Changes made', problems: 'Stopped / failed', unconfirmed: 'Not confirmed saved' };

export function filterLog(log: readonly AgentLogEntry[], filter: LogFilter): AgentLogEntry[] {
  const list = [...log].reverse(); // newest first
  if (filter === 'changes') return list.filter(e => e.outcome === 'applied' || e.outcome === 'undone');
  if (filter === 'problems') return list.filter(e => e.outcome === 'failed' || e.outcome === 'blocked' || e.outcome === 'held' || e.outcome === 'rejected');
  if (filter === 'unconfirmed') return list.filter(e => e.verify === 'unverified');
  return list;
}

const WHO = { you: 'You', agent: 'Autopilot', routine: 'Routine' } as const;
const WHAT = { applied: 'Applied', undone: 'Undone', failed: 'Failed', blocked: 'Blocked', rejected: 'Rejected', held: 'Waiting for you' } as const;

export const logWhen = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`; };

/** "2026-11-19 10:02 UTC · You · Applied · people.create · add person Zed · saved data checked (2)" */
export function logLine(e: AgentLogEntry): string {
  const check = e.verify === 'verified' ? `saved data checked (${e.checks})` : e.verify === 'unverified' ? `NOT confirmed saved${e.failed?.length ? `: ${e.failed.slice(0, 2).join('; ')}` : ''}` : 'no save to check';
  return maskImeis(`${logWhen(e.at)} · ${WHO[e.actor] || e.actor} · ${WHAT[e.outcome] || e.outcome} · ${e.tool} · ${e.summary} · ${check}`);
}

export function exportLog(log: readonly AgentLogEntry[], filter: LogFilter = 'all', limit = 200): string {
  const rows = filterLog(log, filter).slice(0, limit);
  return [`AI LENS assistant history · ${FILTER_LABEL[filter]} · ${rows.length} of ${log.length} entries (newest first, IMEIs masked)`, ...rows.map(logLine)].join('\n');
}

export function logTotals(log: readonly AgentLogEntry[]) {
  return { total: log.length, applied: log.filter(e => e.outcome === 'applied').length, undone: log.filter(e => e.outcome === 'undone').length, problems: filterLog(log, 'problems').length, unconfirmed: log.filter(e => e.verify === 'unverified').length };
}
