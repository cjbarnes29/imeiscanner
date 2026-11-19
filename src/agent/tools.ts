import { segmentDefs } from '../retail/segments';
import { itemFor } from '../retail/catalog';
import { monthOf, type RetailState } from '../retail/types';
import type { RetailRecord } from '../retail/ui-helpers';
import { unalias } from './llm-context';

/**
 * The agent's tools. One entry per module operation. A tool is never run by the model: the model only NAMES a tool and gives arguments; this file checks every
 * argument against the real data (people, models, segments, dates, numbers) and turns a valid call into the assistant's own command wording, which then goes
 * through the same safety gate, preview, Approve, verified save and Undo as a typed command. Read tools only look at the data and return small, masked results.
 * Pure logic, no network.
 */
type Person = { id: string; name: string };
export type ToolEnv = { state: RetailState; records: RetailRecord[]; people: Person[]; today: string; aliases: Map<string, string>; labelOf: (personId: string) => string };

export type ArgType = 'person' | 'model' | 'segment' | 'qty' | 'int' | 'date' | 'name' | 'time' | 'enum';
export type ArgSpec = { type: ArgType; required?: boolean; values?: string[]; min?: number; max?: number; hint?: string };
export type ToolSpec = { name: string; kind: 'write' | 'read'; module: string; summary: string; args: Record<string, ArgSpec>; build: (a: Record<string, string | number>) => string };

const P = (hint = 'a person label or name from the data'): ArgSpec => ({ type: 'person', required: true, hint });
const M: ArgSpec = { type: 'model', required: true, hint: 'a phone model name exactly as in the data' };
const Q: ArgSpec = { type: 'qty', required: true, min: 1, max: 500 };
const S: ArgSpec = { type: 'segment', required: true, hint: 'a target segment such as Flagship 1' };
const D = (required = false): ArgSpec => ({ type: 'date', required, hint: 'YYYY-MM-DD, or today / tomorrow' });

const w = (name: string, module: string, summary: string, args: Record<string, ArgSpec>, build: ToolSpec['build']): ToolSpec => ({ name, kind: 'write', module, summary, args, build });
const r = (name: string, module: string, summary: string, args: Record<string, ArgSpec>): ToolSpec => ({ name, kind: 'read', module, summary, args, build: () => '' });

export const TOOLS: ToolSpec[] = [
  // gives and stock
  w('give_phones', 'gives', 'Give phones to a person', { person: P(), qty: Q, model: M }, a => `give ${a.qty} ${a.model} to ${a.person}`),
  w('move_phones', 'gives', 'Move phones from one person to another', { from: P('the current holder'), to: P('the new holder'), qty: Q, model: M }, a => `move ${a.qty} ${a.model} from ${a.from} to ${a.to}`),
  w('take_back_phones', 'gives', 'Take phones back from a person (they become unassigned)', { person: P(), qty: Q, model: M }, a => `take back ${a.qty} ${a.model} from ${a.person}`),
  w('store_phones', 'stock', 'Store / hold phones so they are not given out', { qty: Q, model: M }, a => `store ${a.qty} ${a.model}`),
  w('make_available', 'stock', 'Make stored phones available to give', { qty: Q, model: M }, a => `make ${a.qty} ${a.model} available`),
  w('remove_from_stock', 'stock', 'Remove phones from stock (marks them removed; never deletes records)', { qty: Q, model: M }, a => `remove ${a.qty} ${a.model} from stock`),
  w('restore_to_stock', 'stock', 'Put removed phones back in stock', { qty: Q, model: M }, a => `restore ${a.qty} ${a.model} to stock`),
  // targets
  w('set_target', 'targets', 'Set a person target for a segment', { person: P(), segment: S, value: { type: 'int', required: true, min: 0, max: 100000 } }, a => `set ${a.person} ${a.segment} target to ${a.value}`),
  w('clear_target', 'targets', 'Clear a person target line', { person: P(), segment: S }, a => `clear ${a.person}'s ${a.segment} target`),
  w('split_store_target', 'targets', 'Split a store target equally among everyone', { segment: S, value: { type: 'int', required: true, min: 1, max: 100000 } }, a => `split store target ${a.value} for ${a.segment} among everyone`),
  // reports
  w('set_report_line', 'reports', 'Set the sold quantity of a model in a report draft', { model: M, value: { type: 'int', required: true, min: 0, max: 100000 }, date: D() }, a => `set report ${a.model} to ${a.value}${a.date ? ' ' + a.date : ''}`),
  w('prepare_report', 'reports', 'Prepare the report for a day (today by default)', { date: D() }, a => a.date ? `create the report for ${a.date}` : "prepare today's report"),
  w('discard_report_draft', 'reports', 'Discard a saved report draft', { date: D(true) }, a => `discard the report draft for ${a.date}`),
  w('prepare_whatsapp_report', 'whatsapp', 'Prepare the WhatsApp report text (never sends it)', {}, () => "prepare today's WhatsApp report"),
  // people
  w('add_person', 'people', 'Add a person', { name: { type: 'name', required: true } }, a => `add person ${a.name}`),
  w('rename_person', 'people', 'Rename a person', { person: P(), name: { type: 'name', required: true, hint: 'the new name' } }, a => `rename ${a.person} to ${a.name}`),
  w('delete_person', 'people', 'Delete a person (their phones become unassigned)', { person: P() }, a => `delete ${a.person}`),
  // calendar
  w('mark_leave', 'calendar', 'Mark a person away on a day', { person: P(), date: D(true) }, a => `mark ${a.person} off on ${a.date}`),
  w('cancel_leave', 'calendar', 'Cancel a person’s saved leave', { person: P(), date: D() }, a => `cancel ${a.person}'s leave${a.date ? ' on ' + a.date : ''}`),
  w('move_leave', 'calendar', 'Move a leave to start on another day', { person: P(), from: D(true), to: D(true) }, a => `move ${a.person}'s leave from ${a.from} to ${a.to}`),
  w('extend_leave', 'calendar', 'Extend a leave until a day', { person: P(), date: D(true) }, a => `extend ${a.person}'s leave until ${a.date}`),
  // routines and settings
  w('pause_routine', 'routines', 'Pause a daily routine', { time: { type: 'time', required: true } }, a => `pause the ${a.time} routine`),
  w('resume_routine', 'routines', 'Resume a daily routine', { time: { type: 'time', required: true } }, a => `resume the ${a.time} routine`),
  w('delete_routine', 'routines', 'Delete a daily routine', { time: { type: 'time', required: true } }, a => `delete the ${a.time} routine`),
  w('create_routine', 'routines', 'Create a daily routine', { schedule: { type: 'enum', required: true, values: ['every day', 'weekdays'] }, time: { type: 'time', required: true }, task: { type: 'enum', required: true, values: ['auto give', "prepare today's report"] } }, a => `${a.schedule} at ${a.time} ${a.task}`),
  w('auto_give', 'gives', 'Give phones to everyone by their limits (Give & share rules)', {}, () => 'auto give'),
  w('toggle_setting', 'settings', 'Turn an app setting on or off', { feature: { type: 'enum', required: true, values: ['automatic detection', 'auto retry'] }, on: { type: 'enum', required: true, values: ['on', 'off'] } }, a => `turn ${a.on} ${a.feature}`),
  // read tools (look only; run locally)
  r('get_person', 'people', 'Phones, targets and leave of one person', { person: P() }),
  r('get_stock', 'stock', 'Phone counts by model (optionally one model)', { model: { type: 'model' } }),
  r('get_report_status', 'reports', 'Whether a report draft exists for a day', { date: D() }),
  r('get_recent_history', 'history', 'What the assistant did recently', { count: { type: 'int', min: 1, max: 10 } })
];
export const toolNamed = (name: string) => TOOLS.find(t => t.name === name);
export const MAX_PLAN_STEPS = 8;

/** The tool list as compact text for the model's instructions. */
export function describeTools(): string {
  return TOOLS.map(t => `- ${t.name}(${Object.entries(t.args).map(([k, s]) => `${k}${s.required ? '' : '?'}${s.values ? ':' + s.values.join('|') : ''}`).join(', ')}) ${t.kind === 'read' ? '[read]' : ''} ${t.summary}`).join('\n');
}

const flat = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export type CallResult = { ok: true; tool: ToolSpec; args: Record<string, string | number>; command: string } | { ok: false; error: string; clarify?: { question: string; options: string[] } };

/** A person from a label ("Person A") or a name. Ambiguous or unknown means a question back, never a guess. */
export function resolvePerson(raw: string, env: ToolEnv): { person?: Person; error?: string; options?: string[] } {
  const text = unalias(String(raw || '').trim(), env.aliases).trim(), f = flat(text);
  if (!f) return { error: 'No person was named.' };
  const exact = env.people.filter(p => flat(p.name) === f);
  if (exact.length === 1) return { person: exact[0] };
  const part = env.people.filter(p => flat(p.name).includes(f) || p.name.toLowerCase().split(/\s+/).some(wd => flat(wd) === f));
  if (part.length === 1) return { person: part[0] };
  if (part.length > 1) return { error: `More than one person matches “${text}”.`, options: part.map(p => env.labelOf(p.id)) };
  return { error: `No saved person matches “${text}”.`, options: env.people.slice(0, 8).map(p => env.labelOf(p.id)) };
}
const dateOf = (v: string, today: string): string | null => {
  const t = v.trim().toLowerCase();
  if (t === 'today') return today; if (t === 'tomorrow') return new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + 'T12:00:00Z'); return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
};
const timeOf = (v: string): string | null => { const m = v.trim().match(/^(\d{1,2}):(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? `${+m[1]}:${m[2]}` : null; };

/** Checks one tool call from the model and builds the command. Nothing here changes data. */
export function validateCall(call: { tool?: unknown; args?: unknown }, env: ToolEnv): CallResult {
  const spec = typeof call.tool === 'string' ? toolNamed(call.tool) : undefined;
  if (!spec) return { ok: false, error: 'That is not a tool I have.' };
  const given = (call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {}) as Record<string, unknown>;
  for (const k of Object.keys(given)) if (!(k in spec.args)) return { ok: false, error: `Unexpected argument “${k.slice(0, 20)}” for ${spec.name}.` };
  const out: Record<string, string | number> = {};
  for (const [name, a] of Object.entries(spec.args)) {
    const v = given[name];
    if (v === undefined || v === null || v === '') { if (a.required) return { ok: false, error: `Missing “${name}” for ${spec.name}.` }; continue; }
    if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, error: `“${name}” must be text or a number.` };
    const s = String(v).trim();
    if (s.length > 80 || /[\n\r;]/.test(s)) return { ok: false, error: `“${name}” is not valid.` };
    if (a.type === 'person') {
      const p = resolvePerson(s, env);
      if (!p.person) return { ok: false, error: p.error || 'Unknown person.', clarify: { question: p.error || 'Which person?', options: p.options || [] } };
      out[name] = p.person.name;
    } else if (a.type === 'qty' || a.type === 'int') {
      const n = Number(s); if (!Number.isInteger(n) || n < (a.min ?? 0) || n > (a.max ?? 100000)) return { ok: false, error: `“${name}” must be a whole number from ${a.min ?? 0} to ${a.max ?? 100000}.` };
      out[name] = n;
    } else if (a.type === 'date') { const d = dateOf(s, env.today); if (!d) return { ok: false, error: `“${name}” must be a real date (YYYY-MM-DD).` }; out[name] = d; }
    else if (a.type === 'time') { const t = timeOf(s); if (!t) return { ok: false, error: `“${name}” must be a time like 9:00.` }; out[name] = t; }
    else if (a.type === 'enum') { if (!a.values?.includes(s)) return { ok: false, error: `“${name}” must be one of: ${a.values?.join(', ')}.` }; out[name] = s; }
    else if (a.type === 'segment') {
      const seg = segmentDefs(env.state).find(x => flat(x.name) === flat(s) || flat(x.id) === flat(s));
      if (!seg) return { ok: false, error: `No target segment matches “${s}”.`, clarify: { question: 'Which target segment?', options: segmentDefs(env.state).map(x => x.name) } };
      out[name] = seg.name;
    } else if (a.type === 'model') {
      if (!/^[\p{L}\p{N} .+/-]{2,60}$/u.test(s) || /^\d+$/.test(s)) return { ok: false, error: `“${name}” is not a phone model name.` };
      out[name] = s;
    } else if (a.type === 'name') {
      if (!/^[\p{L}\p{N} .'’-]{1,40}$/u.test(s)) return { ok: false, error: `“${name}” is not a usable name.` };
      out[name] = s;
    }
  }
  return { ok: true, tool: spec, args: out, command: spec.kind === 'write' ? spec.build(out) : '' };
}

/** Runs a read tool on the real data and returns a small, masked result for the model. Names appear only as labels. */
export function runRead(spec: ToolSpec, args: Record<string, string | number>, env: ToolEnv): unknown {
  const removed = (id: string) => env.state.recordMeta?.[id]?.status === 'given';
  const modelName = (rec: RetailRecord) => itemFor(env.state, rec.model)?.name || rec.model || 'Unknown model';
  if (spec.name === 'get_stock') {
    const only = args.model ? flat(String(args.model)) : '';
    const rows = new Map<string, { total: number; unassigned: number }>();
    for (const rec of env.records) { if (removed(rec.id)) continue; const n = modelName(rec); if (only && !flat(n).includes(only)) continue; const row = rows.get(n) || { total: 0, unassigned: 0 }; row.total++; if (!rec.personId) row.unassigned++; rows.set(n, row); }
    return [...rows].slice(0, 30).map(([model, v]) => ({ model, ...v }));
  }
  if (spec.name === 'get_person') {
    const p = env.people.find(x => x.name === args.person); if (!p) return { error: 'unknown person' };
    const mine = env.records.filter(rec => rec.personId === p.id && !removed(rec.id)), byModel = new Map<string, number>();
    for (const rec of mine) byModel.set(modelName(rec), (byModel.get(modelName(rec)) || 0) + 1);
    const lines = ((env.state.targets?.[monthOf(env.today)] || {}) as Record<string, { lines?: { segment: string; target: number; achieved: number }[] }>)[p.id]?.lines || [];
    return { person: env.labelOf(p.id), phones: mine.length, byModel: [...byModel].map(([model, count]) => ({ model, count })), targets: lines.filter(l => l.target || l.achieved).map(l => ({ segment: l.segment, target: l.target, achieved: l.achieved })), leave: (env.state.workSchedules?.[p.id]?.annualLeave || []).map(l => `${l.start}..${l.end}`) };
  }
  if (spec.name === 'get_report_status') { const d = String(args.date || env.today); const draft = env.state.reportDrafts?.[d]; return { date: d, draftSaved: !!draft, mode: draft?.mode || null, updatedAt: draft?.updatedAt || null }; }
  if (spec.name === 'get_recent_history') return (env.state.agentLog || []).slice(-Number(args.count || 5)).map(e => ({ at: e.at, what: e.summary.slice(0, 80), outcome: e.outcome, saved: e.verify }));
  return { error: 'unknown read tool' };
}
