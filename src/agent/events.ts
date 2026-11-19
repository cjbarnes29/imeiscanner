/** Progress events from the assistant's executor. The progress panel (and anything else) listens; nothing depends on a listener being there. */
export type AgentPhase = 'thinking' | 'planning' | 'step-start' | 'step-done' | 'step-error' | 'verifying' | 'verified' | 'unverified' | 'failed' | 'cancelled' | 'idle';
export type AgentEvent = { phase: AgentPhase; taskId?: string; stepId?: string; text?: string; done?: number; total?: number; at: number };
export const AGENT_EVENT = 'retaillens-agent-event';
export function emitAgent(event: Omit<AgentEvent, 'at'>) {
  try { window.dispatchEvent(new CustomEvent(AGENT_EVENT, { detail: { ...event, at: Date.now() } })); } catch { /* no window (tests): nobody is listening */ }
}
export function onAgent(listener: (event: AgentEvent) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AgentEvent>).detail);
  try { window.addEventListener(AGENT_EVENT, handler); return () => window.removeEventListener(AGENT_EVENT, handler); } catch { return () => {}; }
}
