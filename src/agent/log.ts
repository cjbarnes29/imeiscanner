import type { AgentLogEntry, RetailState } from '../retail/types';

export const MAX_AGENT_LOG = 2000;
/** Full IMEIs never go into the log: first 8 and last 4 digits only. */
export const maskImeis = (text: string) => text.replace(/\b(\d{8})\d{3}(\d{4})\b/g, '$1***$2');
let counter = 0;
const newId = () => `log-${Date.now().toString(36)}-${(++counter).toString(36)}`;
export type NewLogEntry = Omit<AgentLogEntry, 'id' | 'at'> & { id?: string; at?: string };
export function appendAgentLog(state: RetailState, entry: NewLogEntry): { state: RetailState; id: string } {
  const id = entry.id || newId();
  const row: AgentLogEntry = { id, at: entry.at || new Date().toISOString(), actor: entry.actor, mode: entry.mode, tool: entry.tool, op: entry.op, risk: entry.risk, summary: maskImeis(entry.summary).slice(0, 240), requestId: entry.requestId, taskId: entry.taskId, outcome: entry.outcome, verify: entry.verify, checks: entry.checks, failed: entry.failed || [] };
  return { state: { ...state, agentLog: [...(state.agentLog || []), row].slice(-MAX_AGENT_LOG) }, id };
}
export function updateAgentLog(state: RetailState, id: string, patch: Partial<AgentLogEntry>): RetailState {
  if (!state.agentLog?.some(e => e.id === id)) return state;
  return { ...state, agentLog: state.agentLog.map(e => e.id === id ? { ...e, ...patch } : e) };
}
