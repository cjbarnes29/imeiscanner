import { UNASSIGNED } from '../people';
import type { PeopleOp } from './types';

/**
 * The assistant's wording for the list of people: add, rename, delete (and list). Pure logic: nothing is changed here, a reviewed request does that.
 * Matching a person is strict (the whole name, or one word of it that only one person has) so a delete can never land on the wrong person.
 */
type Person = { id: string; name: string };
type Owned = { id: string; personId: string };
export type PeoplePreview = { handled: boolean; lines: string[]; blockers: string[]; warnings: string[]; ops: PeopleOp[]; moves: { id: string; personId: string }[] };

const KIND = '(?:persons?|people|promoters?|promotors?|staff(?:\\s+members?)?|team\\s*members?|members?)';
const COUNT = '(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)';
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const MAX_PEOPLE_AT_ONCE = 10;
const PLEASE = '(?:please\\s+|can you\\s+|could you\\s+)?';

const CREATE = new RegExp(`^${PLEASE}(?:add|create)\\s+(?:${COUNT}\\s+)?(?:new\\s+)?${KIND}\\b\\s*(?:called|named|are|is|:|-)?\\s*(.*)$`, 'i');
const CREATE_AS = new RegExp(`^${PLEASE}(?:add|create)\\s+(.+?)\\s+as\\s+(?:a\\s+|an\\s+)?(?:new\\s+)?${KIND}\\s*$`, 'i');
const RENAME_A = /^(?:please\s+|can you\s+|could you\s+)?rename\s+(?:the\s+)?(?:(?:person|promoter|promotor)\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i;
const RENAME_B = /^(?:please\s+|can you\s+|could you\s+)?(?:change|edit|update|set|correct)\s+(?:the\s+)?name\s+of\s+(?:(?:person|promoter|promotor)\s+)?(.+?)\s+to\s+(.+)$/i;
const RENAME_C = /^(?:please\s+|can you\s+|could you\s+)?(?:change|edit|update|set|correct)\s+(.+?)(?:'s|’s)\s+name\s+(?:to|as)\s+(.+)$/i;
const RENAME_D = /^(?:please\s+|can you\s+|could you\s+)?(?:change|edit|update|correct)\s+(?:the\s+)?(?:person|promoter|promotor)\s+(.+?)\s+to\s+(.+)$/i;
const DELETE_KIND = new RegExp(`^${PLEASE}(?:delete|remove|drop)\\s+(?:the\\s+)?${KIND}\\s+(.+)$`, 'i');
const DELETE_FROM = new RegExp(`^${PLEASE}(?:delete|remove)\\s+(.+?)\\s+from\\s+(?:the\\s+|my\\s+)?(?:${KIND}|team|list)(?:\\s+list)?\\s*$`, 'i');
const DELETE_BARE = /^(?:please\s+|can you\s+|could you\s+)?(?:delete|remove)\s+(.+)$/i;
const NOT_A_PERSON = /\d|\b(?:stock|phones?|imeis?|models?|targets?|routines?|reports?|photos?|pictures?|records?|tasks?|calendar|leave|shift)\b/i;
const LIST = new RegExp(`^${PLEASE}(?:list|show|who are|who is on|what are)\\s+(?:me\\s+)?(?:all\\s+)?(?:the\\s+|my\\s+)?${KIND}\\s*(?:list)?\\s*[?.!]*$|^how many ${KIND}\\b.*$`, 'i');

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const tidy = (v: string) => v.trim().replace(/^["“'‘]+|["”'’]+$/g, '').trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').slice(0, 40);
const titled = (v: string) => (v === v.toLowerCase() ? v.replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : v);
const splitList = (v: string) => v.split(/\s*(?:,|;|&|\+|\band\b)\s*/i).map(tidy).filter(Boolean);
const badName = (v: string) => !v || /[<>{}[\]\\/@#$%^*=|~`]/.test(v);
const idFor = (name: string, taken: Set<string>) => { let h = 0; for (const c of norm(name)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; let id = 'person-a-' + (h >>> 0).toString(36); while (taken.has(id)) id += 'x'; taken.add(id); return id; };

function findPerson(text: string, people: Person[]): Person | 'ambiguous' | undefined {
  const clean = tidy(text).replace(/^(?:the\s+)?(?:person|promoter|promotor)\s+/i, '');
  const key = flat(clean);
  if (!key) return undefined;
  const exact = people.filter(p => flat(p.name) === key);
  if (exact.length) return exact.length === 1 ? exact[0] : 'ambiguous';
  const byWord = people.filter(p => (p.name.toLowerCase().match(/[a-z0-9]+/g) || ([] as string[])).includes(clean.toLowerCase()));
  return byWord.length === 1 ? byWord[0] : byWord.length > 1 ? 'ambiguous' : undefined;
}

const empty = (): PeoplePreview => ({ handled: false, lines: [], blockers: [], warnings: [], ops: [], moves: [] });
const names = (people: Person[]) => people.map(p => p.name).slice(0, 12).join(', ') || 'none yet';

function create(rest: string, count: number | undefined, people: Person[]): PeoplePreview {
  const out = { ...empty(), handled: true };
  const example = 'Example: add 3 people Asha, Bilal and Chen.';
  const text = tidy(rest).replace(/^names?\s*[:\-]?\s*/i, '');
  if (!text) { out.blockers.push(`Say the name${count && count > 1 ? 's' : ''}. ${example}`); return out; }
  let list = splitList(text);
  if (count !== undefined && list.length !== count) {
    const words = text.replace(/[,;&+]|\band\b/gi, ' ').split(/\s+/).filter(Boolean);
    if (words.length === count) list = words;
    else { out.blockers.push(`You said ${count} but I found ${list.length} name${list.length === 1 ? '' : 's'}: ${list.join(' | ') || 'none'}. Separate the names with commas. ${example}`); return out; }
  }
  if (!list.length) { out.blockers.push(`Say the name. ${example}`); return out; }
  if (list.length > MAX_PEOPLE_AT_ONCE) { out.blockers.push(`Add at most ${MAX_PEOPLE_AT_ONCE} people in one request.`); return out; }
  const taken = new Set(people.map(p => p.id)), seen = new Set(people.map(p => norm(p.name))), added: string[] = [];
  for (const raw of list) {
    const name = titled(raw);
    if (badName(name)) { out.blockers.push(`“${raw}” is not a usable name.`); continue; }
    if (seen.has(norm(name))) { out.blockers.push(`There is already a person called ${name}.`); continue; }
    seen.add(norm(name)); added.push(name);
    out.ops.push({ kind: 'add', id: idFor(name, taken), name });
  }
  if (out.blockers.length) { out.ops = []; return out; }
  out.lines.push(`Add ${added.length === 1 ? 'person' : `${added.length} people`}: ${added.join(', ')}.`, 'They start with no phones, targets or calendar days. Undo removes them again while they have no phones.');
  return out;
}

function rename(who: string, to: string, people: Person[], explicit: boolean): PeoplePreview {
  const out = empty();
  const person = findPerson(who, people);
  if (!explicit && !person) return out;
  out.handled = true;
  if (!person || person === 'ambiguous') { out.blockers.push(person === 'ambiguous' ? `More than one person matches “${tidy(who)}”. Use the full name.` : `Choose one saved person for “${tidy(who)}”. Saved people: ${names(people)}.`); return out; }
  const name = titled(tidy(to));
  if (badName(name)) { out.blockers.push('Say the new name. Example: rename Asha to Asha K.'); return out; }
  if (name === person.name) { out.blockers.push(`${person.name} already has that name.`); return out; }
  if (people.some(p => p.id !== person.id && norm(p.name) === norm(name))) { out.blockers.push(`There is already a person called ${name}.`); return out; }
  out.ops.push({ kind: 'rename', id: person.id, from: person.name, to: name });
  out.lines.push(`Rename ${person.name} → ${name}.`, 'Phones, targets, calendar and history stay with this person.');
  return out;
}

function remove(list: string[], strict: boolean, people: Person[], records: Owned[], myPersonId?: string): PeoplePreview {
  const out = empty();
  const found: Person[] = [], problems: string[] = [];
  for (const raw of list) {
    const person = findPerson(raw, people);
    if (!person || person === 'ambiguous') { problems.push(person === 'ambiguous' ? `More than one person matches “${raw}”. Use the full name.` : `Choose one saved person for “${raw}”. Saved people: ${names(people)}.`); continue; }
    if (!found.some(p => p.id === person.id)) found.push(person);
  }
  if (!strict && (problems.length || !found.length)) return out;
  out.handled = true;
  if (problems.length) { out.blockers.push(...problems); return out; }
  if (found.length > MAX_PEOPLE_AT_ONCE) { out.blockers.push(`Delete at most ${MAX_PEOPLE_AT_ONCE} people in one request.`); return out; }
  if (found.length >= people.length) { out.blockers.push('At least one person must remain. Add the new person first.'); return out; }
  for (const person of found) {
    const phones = records.filter(r => r.personId === person.id).map(r => r.id);
    out.ops.push({ kind: 'delete', id: person.id, name: person.name, moved: phones });
    for (const id of phones) out.moves.push({ id, personId: UNASSIGNED });
    out.lines.push(`Delete ${person.name}.${phones.length ? ` ${phones.length} phone${phones.length === 1 ? '' : 's'} move to Unassigned (phones are never deleted).` : ' They have no phones.'}`);
    if (person.id === myPersonId) out.warnings.push(`${person.name} is marked as you (My person). Choose another My person in Settings afterwards.`);
  }
  out.lines.push('Saved targets and calendar for a deleted person stay saved. Undo restores the person and gives the phones back.');
  return out;
}

function list(people: Person[], records: Owned[]): PeoplePreview {
  const out = { ...empty(), handled: true };
  if (!people.length) { out.lines.push('There are no people yet. Say: add 3 people Asha, Bilal and Chen.'); return out; }
  out.lines.push(`${people.length} ${people.length === 1 ? 'person' : 'people'}:`, ...people.map(p => `${p.name}: ${records.filter(r => r.personId === p.id).length} phones`), `Unassigned: ${records.filter(r => !r.personId).length} phones`);
  return out;
}

/** The one entry point: `handled` is false when the text is not about the list of people. */
export function previewPeople(text: string, people: Person[], records: Owned[], myPersonId?: string): PeoplePreview {
  const t = text.trim().replace(/\s+/g, ' ');
  if (LIST.test(t)) return list(people, records);
  const created = CREATE.exec(t);
  if (created) { const c = created[1]?.toLowerCase(); return create(created[2] || '', c === undefined ? undefined : (NUMBER_WORDS[c] ?? +c), people); }
  const as = CREATE_AS.exec(t);
  if (as) return create(as[1], undefined, people);
  for (const [re, explicit] of [[RENAME_B, true], [RENAME_C, true], [RENAME_D, true], [RENAME_A, /\b(?:person|promoter|promotor)\b/i.test(t)]] as const) {
    const m = re.exec(t);
    if (m) { const r = rename(m[1], m[2], people, explicit); if (r.handled) return r; }
  }
  const from = DELETE_FROM.exec(t);
  if (from) return remove(splitList(from[1]), true, people, records, myPersonId);
  const kind = DELETE_KIND.exec(t);
  if (kind) return remove(splitList(kind[1]), true, people, records, myPersonId);
  const bare = DELETE_BARE.exec(t);
  if (bare && !NOT_A_PERSON.test(bare[1])) return remove(splitList(bare[1]), false, people, records, myPersonId);
  return empty();
}

/** What the opposite of each change is: used by Undo. A deleted person comes back with the same id so the phones can go back to them. */
export function inversePeopleOps(ops: PeopleOp[]): PeopleOp[] {
  return [...ops].reverse().map((op): PeopleOp => op.kind === 'add' ? { kind: 'delete', id: op.id, name: op.name, moved: [] } : op.kind === 'rename' ? { kind: 'rename', id: op.id, from: op.to, to: op.from } : { kind: 'add', id: op.id, name: op.name });
}
