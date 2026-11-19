import type { AssistantPreview } from '../retail/assistant-actions';

/**
 * The assistant's tools, one list for every module. Each tool the assistant can use is a module + an operation (create / read / update / delete) with a risk:
 * read = changes nothing, low = reversible and small, medium = moves phones or stock, destructive = removes something (needs an explicit confirmation).
 * The existing validated functions stay the implementation; this list names them, so permissions, the audit log and verification can speak about them.
 */
export type ToolModule = 'people' | 'calendar' | 'targets' | 'gives' | 'stock' | 'reports' | 'routines' | 'settings' | 'whatsapp' | 'accessories';
export type ToolOp = 'create' | 'read' | 'update' | 'delete';
export type ToolRisk = 'read' | 'low' | 'medium' | 'destructive';
export type ToolInfo = { name: string; module: ToolModule; op: ToolOp; risk: ToolRisk; summary: string };

const t = (module: ToolModule, op: ToolOp, risk: ToolRisk, summary: string): ToolInfo => ({ name: `${module}.${op}`, module, op, risk, summary });
export const TOOL_REGISTRY: ToolInfo[] = [
  t('people', 'create', 'low', 'Add people'), t('people', 'read', 'read', 'List people and their phones'), t('people', 'update', 'low', 'Rename a person'), t('people', 'delete', 'destructive', 'Delete a person (phones move to Unassigned)'),
  t('calendar', 'create', 'low', 'Mark a person not available'), t('calendar', 'read', 'read', 'Show who is away'), t('calendar', 'update', 'low', 'Change leave dates'), t('calendar', 'delete', 'destructive', 'Cancel a leave'),
  t('targets', 'read', 'read', 'Show targets'), t('targets', 'update', 'low', 'Set a person target or split a store target'), t('targets', 'delete', 'destructive', 'Clear a person target line'),
  t('gives', 'create', 'medium', 'Give phones to a person'), t('gives', 'read', 'read', 'Show who has which phones'), t('gives', 'update', 'medium', 'Move phones between people'), t('gives', 'delete', 'destructive', 'Take phones back (Unassigned)'),
  t('stock', 'create', 'medium', 'Add manual phones (valid IMEI only)'), t('stock', 'read', 'read', 'Show stock counts'), t('stock', 'update', 'low', 'Store, hold or make phones available'), t('stock', 'delete', 'destructive', 'Remove from stock (a status; records are kept)'),
  t('reports', 'create', 'low', 'Prepare a dated report draft'), t('reports', 'read', 'read', 'Check or show a report'), t('reports', 'update', 'low', 'Set a sold quantity in a draft'), t('reports', 'delete', 'destructive', 'Discard a report draft'),
  t('routines', 'create', 'low', 'Save a routine'), t('routines', 'read', 'read', 'List routines'), t('routines', 'update', 'low', 'Edit or pause a routine'), t('routines', 'delete', 'destructive', 'Delete a routine'),
  t('settings', 'update', 'low', 'Change an app setting'), t('whatsapp', 'create', 'low', 'Prepare a WhatsApp report (never sent)'), t('accessories', 'update', 'low', 'Change tablet/accessory stock'),
];
export const toolNamed = (name: string) => TOOL_REGISTRY.find(x => x.name === name);

/** Which tool a previewed change uses. Null when the preview changes nothing. */
export function toolOf(preview: AssistantPreview, text: string): ToolInfo | null {
  const find = (module: ToolModule, op: ToolOp) => toolNamed(`${module}.${op}`)!;
  const first = preview.people?.ops[0];
  if (first) return find('people', first.kind === 'add' ? 'create' : first.kind === 'rename' ? 'update' : 'delete');
  if (preview.giving.length) return find('gives', 'create');
  if (preview.additions?.length) return find('stock', 'create');
  if (preview.report) return find('reports', 'update');
  if (preview.settings) return find('settings', 'update');
  if (preview.moves?.length) return find('gives', preview.moves.every(m => m.to === '') ? 'delete' : 'update');
  const keys = Object.keys(preview.business?.after || {});
  if (keys.includes('workSchedules')) return find('calendar', /\b(?:cancel|remove|delete|clear)\b/i.test(text) ? 'delete' : /\b(?:move|shift|reschedule|extend|shorten|change)\b/i.test(text) ? 'update' : 'create');
  if (keys.includes('targets') || keys.includes('storeTargets')) return find('targets', /\b(?:clear|remove|delete|zero|reset|unset)\b/i.test(text) ? 'delete' : 'update');
  if (keys.includes('reportDrafts')) return find('reports', 'delete');
  if (keys.includes('recordMeta')) return find('stock', /\b(?:remove|delete|take)\b/i.test(text) ? 'delete' : 'update');
  if (keys.includes('assistantRoutines')) return find('routines', /\b(?:delete|remove|cancel)\b/i.test(text) ? 'delete' : /\b(?:pause|resume|enable|disable|stop|turn)\b/i.test(text) ? 'update' : 'create');
  if (keys.includes('deliveryPackets')) return find('whatsapp', 'create');
  if (keys.includes('accessoryStock') || keys.includes('accessoryReport')) return find('accessories', 'update');
  return null;
}

/**
 * How firmly a removal must be confirmed. Minor: press and hold the button for a moment. Major: type CONFIRM. Not destructive: null (the normal Approve).
 * Major = more than one person, a person who holds phones, more than 5 phones, or more than one saved leave/target line.
 */
export type ConfirmLevel = 'minor' | 'major';
export function confirmLevel(tool: ToolInfo | null, preview: AssistantPreview): ConfirmLevel | null {
  if (!tool || tool.risk !== 'destructive') return null;
  const deletes = preview.people?.ops.filter(op => op.kind === 'delete') || [];
  if (deletes.length > 1 || deletes.some(op => op.kind === 'delete' && op.moved.length > 0)) return 'major';
  if ((preview.moves?.length || 0) > 5) return 'major';
  if (tool.name === 'stock.delete') {
    const before = (preview.business?.before.recordMeta || {}) as Record<string, { status?: string }>, after = (preview.business?.after.recordMeta || {}) as Record<string, { status?: string }>;
    if (Object.keys(after).filter(id => after[id]?.status !== before[id]?.status).length > 5) return 'major';
  }
  return 'minor';
}
