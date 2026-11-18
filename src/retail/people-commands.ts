import { UNASSIGNED } from '../people';
import type { PeopleOp } from './types';

/**
 * The assistant's wording for the list of people: add, rename, delete (and list). Pure logic: nothing is changed here, a reviewed request does that.
 * Everyday wording is accepted ("can you add maya to the team", "get rid of bilal", "asha should be called ashley"), but a person is only ever matched
 * strictly (the whole name, or a word of it that only one person has), and questions, "what if" sentences and negations are never read as commands.
 */
type Person = { id: string; name: string };
type Owned = { id: string; personId: string };
export type PeoplePreview = { handled: boolean; lines: string[]; blockers: string[]; warnings: string[]; ops: PeopleOp[]; moves: { id: string; personId: string }[] };

const KIND = '(?:persons?|people|promoters?|promotors?|staff(?:\\s+members?)?|team\\s*members?|members?)';
const COUNT = '(\\d{1,2}|one more|another|an?|one|two|three|four|five|six|seven|eight|nine|ten)';
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, 'one more': 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const MAX_PEOPLE_AT_ONCE = 10;

// polite or chatty beginnings and endings that do not change the meaning
const LEAD = /^(?:(?:ok(?:ay)?|hey|hi|so|well|also|and|then)[ ,]+)*(?:(?:please|kindly|pls)\s+)?(?:(?:can|could|would|will)\s+(?:you|u|ya)\s+(?:please\s+)?|i(?:'d| would)?\s+(?:want|like|need)\s+(?:you\s+)?to\s+|let'?s\s+|we\s+(?:need|have)\s+to\s+)?/i;
const TAIL = /\s*[,;]?\s*(?:(?:for me|please|pls|thanks|thank you|now|ok(?:ay)?|right now|for us|if you can|if possible)\s*)+[.!]*$/i;
// "what happens if I delete Bilal", "should I remove Asha", "how do I add a person": questions, never commands
const HYPOTHETICAL = /\b(?:what (?:happens|if|does|will|would)|should i|how (?:do|can|could|would|to) (?:i|you)?|can i|could i|if i|why\b|tell me about|explain|is it possible|what is)\b/i;
// "do not remove Asha", "never delete anyone", "i don't want to delete Bilal", "cancel", "undo"
const NEGATED = /\b(?:don'?t|do not|never|not|no)\s+(?:\w+\s+){0,2}(?:add|create|register|rename|delete|remove|drop|get rid of|change|call)\b|\b(?:cancel|undo|stop)\b/i;
const STOCKISH = /\b(?:stock|phones?|imeis?|models?|targets?|routines?|reports?|photos?|pictures?|records?|tasks?|calendar|leave|shift|available|unavailable|stored|held|settings?)\b/i;
const NOT_A_PERSON = new RegExp(`\\d|${STOCKISH.source}`, 'i');
const NOT_A_NAME = /^(?:stock|phones?|imeis?|a|an|the|routine|report|target|task|model|models|fold\d*|flip\d*|flagship|mid|low|tablet|photo|picture|file|settings?|galaxy|samsung|buds|watch)\b/i;
const BAD_NEW_NAME = /\b(?:available|unavailable|away|off|sick|leave|working|late|here|back|gone|ready|done|stored|held|now|today|tomorrow)\b/i;

const VERB = '(?:add|create|register|include|hire|welcome|make|set up|enrol|enroll|put in|(?:i|we)\\s+(?:need|want|have|got|hired|are hiring))';
const CREATE = new RegExp(`^${VERB}\\s+(?:${COUNT}\\s+)?(?:new\\s+)?${KIND}\\b[\\s,:-]*(?:called|named)?[\\s,:-]*(.*)$|^new\\s+${KIND}\\b[\\s,:-]*(?:called|named)?[\\s,:-]*(.*)$`, 'i');
const CREATE_AS = new RegExp(`^(?:add|create|register|enrol|enroll|put|hire)\\s+(.+?)(?:\\s+on\\s+(?:the\\s+|my\\s+)?(?:list|team))?\\s+(?:as|to be)\\s+(?:a\\s+|an\\s+)?(?:new\\s+)?${KIND}$`, 'i');
const TO_TEAM = /^(?:add|include|register|enrol|enroll|put|place)\s+(.+?)\s+(?:to|into|in|on)\s+(?:the\s+|my\s+|our\s+)?(?:(?:people|team|staff|promoters?)\s+)?(?:team|list|app|staff|people|promoters?)$/i;
const BARE_ADD = /^add\s+([a-z][a-z' .-]{0,38})$/i;

const RENAME_A = /^rename\s+(?:the\s+)?(?:(?:person|promoter|promotor)\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i;
const RENAME_B = /^(?:change|edit|update|set|correct)\s+(?:the\s+)?name\s+of\s+(?:(?:person|promoter|promotor)\s+)?(.+?)\s+to\s+(.+)$/i;
const RENAME_C = /^(?:change|edit|update|set|correct|rename)\s+(.+?)(?:'s|’s)?\s+name\s+(?:to|as)\s+(.+)$/i;
const RENAME_D = /^(?:change|edit|update|correct)\s+(?:the\s+)?(?:person|promoter|promotor)\s+(.+?)\s+to\s+(.+)$/i;
const RENAME_E = /^(.+?)\s+(?:should|must|will|is going to|wants to|want to|would like to|likes to|prefers to)\s+be\s+called\s+(.+)$/i;
const RENAME_M = /^make\s+(.+?)(?:'s|’s)\s+name\s+(.+)$/i;
const RENAME_F = /^(.+?)\s+is\s+(?:now|actually|really)\s+(?:called\s+)?(.+)$/i;
const RENAME_I = /^(?:change|switch|turn)\s+(.+?)\s+(?:to|into)\s+(.+)$/i;
const RENAME_K = /^(.+?)(?:'s|’s)\s+name\s+(?:(?:is\s+)?(?:wrong|incorrect|misspelled|spelled wrong|not right)[,;]?\s+)?(?:(?:it\s+)?(?:should|must)\s+be|is)\s+(.+)$/i;
const RENAME_L = /^rename\s+(.+?)\s*[,;]\s*(?:(?:she|he|they|it)\s+)?(?:is|are|should be|goes by|is called|is named)\s+(.+)$/i;
const RENAME_G = /^call\s+(.+?)\s+(?:instead|from now on|from today|going forward)$/i;
const RENAME_H = /^fix\s+(?:the\s+)?(?:spelling|name)\s+of\s+(.+?)\s*[,;]?\s+(?:it\s+is|it's|to|as)\s+(.+)$/i;

const DELETE_FROM = new RegExp(`^(?:delete|remove)\\s+(.+?)\\s+from\\s+(?:the\\s+|my\\s+)?(?:${KIND}|team|list)(?:\\s+list)?$`, 'i');
const DELETE_KIND = new RegExp(`^(?:delete|remove|drop)\\s+(?:the\\s+)?${KIND}\\s+(.+)$`, 'i');
const DELETE_VERB = /\b(?:delete|remove|drop|erase|get rid of|kick out|take\b.*\b(?:off|out of) (?:the\s+|my\s+)?(?:list|team|app|people))\b/i;
const LIST = new RegExp(`^(?:list|show|give|who are|who is on|who's on|what are)\\s+(?:me\\s+)?(?:a\\s+list\\s+of\\s+)?(?:all\\s+)?(?:the\\s+|my\\s+|our\\s+)*(?:${KIND}|team)\\s*(?:list)?\\s*[?.!]*$|^how many ${KIND}\\b.*$|^who (?:is|are)\\s+(?:on\\s+)?(?:the\\s+|my\\s+)?(?:team|staff)$|^who\\s+(?:works?|is working|are working)\\s+(?:for|with|under)\\s+me$`, 'i');

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const tidy = (v: string) => v.trim().replace(/^["“'‘]+|["”'’]+$/g, '').trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').slice(0, 40);
const titled = (v: string) => (v === v.toLowerCase() ? v.replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : v);
const splitList = (v: string) => v.split(/\s*(?:,|;|&|\+|\band\b)\s*/i).map(tidy).filter(Boolean);
const badName = (v: string) => !v || /[<>{}[\]\\/@#$%^*=|~`]/.test(v);
const wordsOf = (v: string) => v.toLowerCase().match(/[a-z0-9]+/g) || ([] as string[]);
const idFor = (name: string, taken: Set<string>) => { let h = 0; for (const c of norm(name)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; let id = 'person-a-' + (h >>> 0).toString(36); while (taken.has(id)) id += 'x'; taken.add(id); return id; };

function findPerson(text: string, people: Person[]): Person | 'ambiguous' | undefined {
  const clean = tidy(text).replace(/^(?:the\s+)?(?:person|promoter|promotor)\s+/i, '');
  const key = flat(clean);
  if (!key) return undefined;
  const exact = people.filter(p => flat(p.name) === key);
  if (exact.length) return exact.length === 1 ? exact[0] : 'ambiguous';
  const byWord = people.filter(p => wordsOf(p.name).includes(clean.toLowerCase()));
  return byWord.length === 1 ? byWord[0] : byWord.length > 1 ? 'ambiguous' : undefined;
}
/** "asha ashley" -> Asha + "ashley": the longest start of the words that is exactly one saved person. */
function splitPerson(text: string, people: Person[]): { person: Person; rest: string } | undefined {
  const parts = tidy(text).split(' ');
  for (let k = Math.min(parts.length - 1, 3); k >= 1; k--) { const p = findPerson(parts.slice(0, k).join(' '), people); if (p && p !== 'ambiguous') return { person: p, rest: parts.slice(k).join(' ') }; }
  return undefined;
}
/** Saved people named anywhere in the sentence (the whole name, or a word of it that nobody else has). */
export function mentioned(text: string, people: Person[]): Person[] {
  const words = new Set(wordsOf(text));
  return people.filter(p => {
    const mine = wordsOf(p.name);
    if (!mine.length) return false;
    if (mine.every(w => words.has(w))) return true;
    return mine.some(w => w.length >= 3 && words.has(w) && people.filter(o => wordsOf(o.name).includes(w)).length === 1);
  });
}

const empty = (): PeoplePreview => ({ handled: false, lines: [], blockers: [], warnings: [], ops: [], moves: [] });
const names = (people: Person[]) => people.map(p => p.name).slice(0, 12).join(', ') || 'none yet';

function create(rest: string, count: number | undefined, people: Person[]): PeoplePreview {
  const out = { ...empty(), handled: true };
  const example = 'Example: add 3 people Asha, Bilal and Chen.';
  const text = tidy(rest).replace(/^(?:names?|for|called|named)\s*[:\-]?\s*/i, '').replace(/\s+(?:to|into|in|on)\s+(?:the\s+|my\s+|our\s+)?(?:team|list|app|staff)$/i, '');
  if (!text) { out.blockers.push(`Say the name${count && count > 1 ? 's' : ''}. ${example}`); return out; }
  if (STOCKISH.test(text)) { out.handled = false; return out; }
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
  let t = text.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i++) { const next = t.replace(LEAD, '').replace(TAIL, '').trim(); if (next === t) break; t = next; }
  if (!t) return empty();
  if (HYPOTHETICAL.test(t) && !LIST.test(t)) return empty();
  // checked before the polite endings are removed, because "who works for me" ends in "for me"
  if (LIST.test(t) || LIST.test(text.trim().replace(/\s+/g, ' ').replace(LEAD, '').trim())) return list(people, records);
  if (NEGATED.test(t)) return empty();

  const created = CREATE.exec(t);
  if (created) { const c = created[1]?.toLowerCase(); return create(created[2] ?? created[3] ?? '', c === undefined ? undefined : (NUMBER_WORDS[c] ?? +c), people); }
  const as = CREATE_AS.exec(t);
  if (as) return create(as[1], undefined, people);
  const toTeam = TO_TEAM.exec(t);
  if (toTeam && !STOCKISH.test(toTeam[1])) return create(toTeam[1], undefined, people);

  for (const [re, explicit] of [[RENAME_B, true], [RENAME_C, true], [RENAME_M, true], [RENAME_D, true], [RENAME_H, true], [RENAME_L, true], [RENAME_A, /\b(?:person|promoter|promotor)\b/i.test(t)]] as const) {
    const m = re.exec(t);
    if (m) { const r = rename(m[1], m[2], people, explicit); if (r.handled) return r; }
  }
  for (const re of [RENAME_E, RENAME_F, RENAME_I, RENAME_K]) {
    const m = re.exec(t);
    if (m && !BAD_NEW_NAME.test(m[2]) && wordsOf(m[2]).length <= 3) { const r = rename(m[1], m[2], people, false); if (r.handled) return r; }
  }
  const call = RENAME_G.exec(t);
  if (call) { const s = splitPerson(call[1], people); if (s && !BAD_NEW_NAME.test(s.rest)) return rename(s.person.name, s.rest, people, false); }

  const from = DELETE_FROM.exec(t);
  if (from) return remove(splitList(from[1]), true, people, records, myPersonId);
  const kind = DELETE_KIND.exec(t);
  if (kind) return remove(splitList(kind[1]), true, people, records, myPersonId);
  if (DELETE_VERB.test(t)) {
    const who = mentioned(t, people);
    const rest = wordsOf(t).filter(w => !who.some(p => wordsOf(p.name).includes(w))).join(' ');
    if (who.length && !NOT_A_PERSON.test(rest)) return remove(who.map(p => p.name), false, people, records, myPersonId);
  }

  const bare = BARE_ADD.exec(t);
  if (bare && !NOT_A_NAME.test(bare[1].trim()) && !STOCKISH.test(bare[1]) && wordsOf(bare[1]).length <= 3 && !findPerson(bare[1], people)) return create(bare[1], undefined, people);
  return empty();
}

/** What the opposite of each change is: used by Undo. A deleted person comes back with the same id so the phones can go back to them. */
export function inversePeopleOps(ops: PeopleOp[]): PeopleOp[] {
  return [...ops].reverse().map((op): PeopleOp => op.kind === 'add' ? { kind: 'delete', id: op.id, name: op.name, moved: [] } : op.kind === 'rename' ? { kind: 'rename', id: op.id, from: op.to, to: op.from } : { kind: 'add', id: op.id, name: op.name });
}
