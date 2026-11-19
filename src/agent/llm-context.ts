import { itemFor } from '../retail/catalog';
import { segmentDefs } from '../retail/segments';
import { monthOf, type RetailState } from '../retail/types';
import type { RetailRecord } from '../retail/ui-helpers';

/**
 * What the AI brain is allowed to see, built fresh for each question. Privacy rules, always on:
 *  - no IMEIs, no photos, no phone records, no file contents;
 *  - people are shown as "Person A, Person B…" (unless the person turned on sharing real names), and the answer is mapped back on this phone;
 *  - only counts and targets, capped in size.
 * Pure logic. The text it returns is exactly what is sent, and the Settings screen can show it before anything is sent.
 */
type Person = { id: string; name: string };
export type AiContext = { text: string; aliases: Map<string, string> };

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const labelFor = (index: number) => `Person ${LABELS[index] ?? String(index + 1)}`;
export const MAX_CONTEXT_CHARS = 6000;

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsOfName = (name: string) => new Set(name.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
/**
 * Replaces every real name in a piece of text with its "Person A" label: full names first, then single words of a name (3+ letters) that belong to only
 * one person ("Maya" for "Maya Demo"; a shared word like "Demo" is left alone). Used for the question and for free text such as routine sentences.
 */
export function maskNames(text: string, people: Person[], label: (index: number) => string = labelFor): string {
  const count = new Map<string, number>();
  for (const p of people) for (const w of wordsOfName(p.name)) count.set(w, (count.get(w) || 0) + 1);
  const bounded = (v: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, 'giu');
  let out = text;
  people.forEach((p, i) => { if (p.name.trim()) out = out.replace(bounded(p.name.trim()), label(i)); });
  people.forEach((p, i) => { for (const w of wordsOfName(p.name)) if (count.get(w) === 1) out = out.replace(bounded(w), label(i)); });
  return out;
}

export function buildAiContext(state: RetailState, records: RetailRecord[], people: Person[], today: string, opts: { shareNames?: boolean } = {}): AiContext {
  const aliases = new Map<string, string>(); // shown label -> real name
  const nameOf = new Map<string, string>(); // person id -> label sent to the AI
  people.slice(0, 26).forEach((p, i) => { const label = opts.shareNames ? p.name : labelFor(i); nameOf.set(p.id, label); aliases.set(label, p.name); });
  const removed = (id: string) => state.recordMeta?.[id]?.status === 'given';
  const perModel = new Map<string, { total: number; unassigned: number; owners: Map<string, number> }>();
  for (const r of records) {
    if (removed(r.id)) continue;
    const name = itemFor(state, r.model)?.name || r.model || 'Unknown model';
    const row = perModel.get(name) || { total: 0, unassigned: 0, owners: new Map<string, number>() };
    row.total++; if (!r.personId) row.unassigned++; else { const who = nameOf.get(r.personId) || 'someone else'; row.owners.set(who, (row.owners.get(who) || 0) + 1); }
    perModel.set(name, row);
  }
  const lines: string[] = [`Today: ${today}`, `People: ${people.length ? people.slice(0, 26).map(p => nameOf.get(p.id)).join(', ') : 'none saved'}`];
  lines.push('Phones in stock by model (counts only):');
  if (!perModel.size) lines.push('- none');
  for (const [name, row] of [...perModel].sort((a, b) => b[1].total - a[1].total).slice(0, 25)) lines.push(`- ${name}: ${row.total} total, ${row.unassigned} unassigned${row.owners.size ? '; with ' + [...row.owners].map(([w, n]) => `${w} ${n}`).join(', ') : ''}`);
  const month = monthOf(today), segs = segmentDefs(state), targets = state.targets?.[month] || {};
  lines.push(`Targets for ${month}:`);
  let any = false;
  for (const p of people.slice(0, 26)) {
    const entry = (targets as Record<string, { lines?: { segment: string; target: number; achieved: number }[] }>)[p.id];
    for (const l of entry?.lines || []) { if (l.target > 0 || l.achieved > 0) { any = true; lines.push(`- ${nameOf.get(p.id)} ${segs.find(s => s.id === l.segment)?.name || l.segment}: target ${l.target}, achieved ${l.achieved}`); } }
  }
  if (!any) lines.push('- none set');
  const leave: string[] = [];
  for (const p of people.slice(0, 26)) for (const r of state.workSchedules?.[p.id]?.annualLeave || []) leave.push(`${nameOf.get(p.id)} ${r.start}${r.end !== r.start ? ' to ' + r.end : ''}`);
  lines.push(`Saved leave: ${leave.length ? leave.slice(0, 20).join('; ') : 'none'}`);
  lines.push(`Routines: ${(state.assistantRoutines || []).slice(0, 10).map(r => `${r.time || 'any time'} “${r.text.slice(0, 50)}” (${r.enabled ? 'on' : 'paused'})`).join('; ') || 'none'}`);
  const draft = Object.keys(state.reportDrafts || {}).slice(-5);
  lines.push(`Saved report drafts: ${draft.length ? draft.join(', ') : 'none'}`);
  const joined = lines.join('\n');
  // names can also hide in free text (a routine sentence): mask them there too
  return { text: (opts.shareNames ? joined : maskNames(joined, people.slice(0, 26))).slice(0, MAX_CONTEXT_CHARS), aliases };
}

/** The label the model sees for each person: "Person A…", or the real name when sharing is on. */
export function labelMap(people: Person[], shareNames: boolean): (personId: string) => string {
  const m = new Map<string, string>(); people.slice(0, 26).forEach((p, i) => m.set(p.id, shareNames ? p.name : labelFor(i)));
  return id => m.get(id) || 'someone';
}

/** Turns "Person A" in the AI's reply back into the real name, on this phone only. Longest labels first so "Person A" never eats part of another. */
export function unalias(text: string, aliases: Map<string, string>): string {
  let out = text;
  for (const [label, name] of [...aliases].sort((a, b) => b[0].length - a[0].length)) out = out.replace(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), name);
  return out;
}
