import { mentioned } from './people-commands';
import { parseSchedule } from './routine-schedule';

/**
 * Everyday wording -> the sentence shapes the assistant's validated readers already understand ("give asha 4 fold6" -> "give 4 fold6 to asha").
 * Nothing is applied here and nothing new can happen: a rewrite only ever produces one of the existing, previewed, approved commands. The assistant tries a
 * rewrite only when the sentence as written was not understood, and it shows "Understood as: ..." so the person sees how it was read.
 */
type Person = { id: string; name: string };
export type CanonContext = { people: Person[]; segments: { id: string; name: string }[]; defaultModel?: string };

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const digits = (t: string) => t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/gi, w => String(WORD_NUMBERS[w.toLowerCase()]));
const LEAD = /^(?:(?:ok(?:ay)?|hey|hi|so|please|kindly|pls)[ ,]+)*(?:(?:can|could|would|will)\s+(?:you|u|ya)\s+(?:please\s+)?|i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+|let'?s\s+)?/;
const tidy = (text: string) => text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(LEAD, '').replace(/\s*[,;]?\s*(?:please|pls|thanks|thank you|for me|now)\s*[.!]*$/, '').replace(/[.!?]+$/, '').trim();
const wordsOf = (t: string) => t.toLowerCase().match(/[a-z0-9][a-z0-9'.-]*/g) || ([] as string[]);

const EVERYONE = /\b(?:everyone|everybody|all (?:the )?(?:people|promoters?|promotors?|staff)|the team|team members|promoters?|promotors?|each person|per person)\b/;
const SPLIT = /\b(?:divide|divided|split|share|distribute|spread|allocate)\b/;
const STOP = new Set(('to for with from the a an of and please phones phone units unit pieces piece pcs pc new more out in on at aside away back available stock stored store again into by per everyone everybody team promoters promoter persons person people staff ' +
  'give giving gives hand send assign allocate transfer move put let have get gets needs need wants want takes take should will must i we release keep set hold make remove delete pull drop off sold today todays today\'s tomorrow report my our his her their its it them elsewhere then also just only some').split(' '));

/** The people named in the sentence, in the order they are written (strict names only). */
function peopleIn(text: string, people: Person[]): Person[] {
  const where = (p: Person) => { const w = new Set(wordsOf(p.name)); const ws = wordsOf(text); const i = ws.findIndex(x => w.has(x)); return i < 0 ? 9999 : i; };
  return mentioned(text, people).sort((a, b) => where(a) - where(b));
}
const FAMILY = new Set(['galaxy', 'samsung', 'z', 'fold', 'flip', 'ultra', 'plus', 'note', 'tab', 'buds', 'watch', 'fit', 'edge', 'fe', 'pro', 'max', 'mini', 'neo', 'lite']);
const modelish = (w: string) => FAMILY.has(w) || /^(?=.*[a-z])(?=.*\d)[a-z0-9-]+$/.test(w);
/** The phone model words ("fold6", "galaxy z fold6"): the longest run of words that look like a model; if none does, whatever is left after verbs, numbers and filler. */
function modelOf(text: string, who: Person[]): string {
  const skip = new Set(who.flatMap(p => wordsOf(p.name)));
  const words = wordsOf(text).filter(w => !skip.has(w) && !/^\d+$/.test(w) && !/^\d{15}$/.test(w) && !/^20\d\d-\d\d-\d\d$/.test(w));
  let best: string[] = [], run: string[] = [];
  for (const w of words) { if (modelish(w)) { run.push(w); if (run.length > best.length) best = [...run]; } else run = []; }
  if (best.length) return best.join(' ');
  return words.filter(w => !STOP.has(w)).join(' ').trim();
}
const firstNumber = (text: string) => text.match(/(?<![\w.-])(\d{1,5})(?![\w.-])/)?.[1];

// ---- giving ---------------------------------------------------------------------------------------------------------------------------------
const GIVE_WORD = /\b(?:give|giving|gives|hand|send|assign|allocate|transfer|move|put|let|allot|issue|pass|provide|supply|needs?|gets?|getting|takes?|taking|receives?|receiving|wants?|have|has|should get|will get)\b|^\d+\s+\S.*\s(?:to|for)\s/;
function give(t: string, ctx: CanonContext): string | null {
  if (/\bfrom\b/.test(t) || /\b(?:report|target|targets|stock|leave|available|sick|absent|routine)\b/.test(t)) return null;
  const named = peopleIn(t, ctx.people);
  if (!named.length) return null;
  if (!GIVE_WORD.test(t) && !(/\b\d{1,5}\b/.test(t) && modelOf(t, named))) return null;
  const parts = t.split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean);
  const pairs: { who: Person; qty: string; model: string }[] = [];
  for (const part of parts) {
    let inPart = peopleIn(part, ctx.people);
    if (inPart.length === 0 && pairs.length > 0 && named.length === 1 && /\d/.test(part)) inPart = named; // "give asha 5 fold6 and 3 flip6": the same person
    if (inPart.length !== 1) { if (inPart.length === 0 && (pairs.length === 0 || !/\d/.test(part))) continue; return null; }
    const qty = firstNumber(part); if (!qty) return null;
    pairs.push({ who: inPart[0], qty, model: modelOf(part, inPart) });
  }
  if (!pairs.length || new Set(pairs.map(p => p.who.id)).size !== named.length) return null;
  let last = pairs.find(p => p.model)?.model || modelOf(t, named) || ctx.defaultModel || '';
  if (!last) return null;
  return 'give ' + pairs.map(p => { last = p.model || last; return `${p.qty} ${last} to ${p.who.name}`; }).join(' and ');
}
const AUTO_GIVE = /\b(?:give|hand|share|divide|distribute|split|allocate|send)\b(?:\s+out)?\b.*\b(?:phones?|stock|imeis?)\b/;
function autoGive(t: string, ctx: CanonContext): string | null {
  if (!/\d/.test(t) && !peopleIn(t, ctx.people).length) {
    if (/\bauto[- ]?give\b/.test(t) && !/\b(?:on|off|enable|disable|stop|turn|switch|start|setting|settings|option|options)\b/.test(t)) return 'auto give';
    if (/\b(?:give|allocate|distribute|assign|hand|share)\b.*\b(?:phones?|stock)\b.*\b(?:automatic(?:ally)?|auto|by (?:the )?(?:limits?|rules?))\b/.test(t)) return 'auto give';
  }
  if (/\d/.test(t) || !AUTO_GIVE.test(t) || peopleIn(t, ctx.people).length) return null;
  return /\b(?:out|everyone|everybody|team|promoters?|each|per person|limits?|rules?|today'?s?|available)\b/.test(t) ? 'auto give' : null;
}

// ---- targets --------------------------------------------------------------------------------------------------------------------------------
function target(t: string, ctx: CanonContext): string | null {
  const flat = ` ${t.replace(/[^a-z0-9]+/g, ' ')} `;
  const segs = ctx.segments.filter(s => flat.includes(` ${s.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `) || flat.includes(` ${s.id.toLowerCase()} `));
  if (!segs.length) return null;
  const seg = segs.sort((a, b) => b.name.length - a.name.length)[0];
  const rest = flat.replace(` ${seg.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `, ' ').replace(` ${seg.id.toLowerCase()} `, ' ');
  const n = firstNumber(rest.trim()); if (!n) return null;
  const named = peopleIn(t, ctx.people), everyone = EVERYONE.test(t);
  if (SPLIT.test(t)) return !named.length || everyone ? `split store target ${n} for ${seg.name} among everyone` : null; // dividing is only ever a store split among everyone; "divide it to Maya" stays an unclear request
  if (named.length > 1 || (named.length && everyone)) return null;
  const targetWord = /\b(?:targets?|goals?)\b/.test(t);
  if (!targetWord && !(named.length === 1 && wordsOf(rest).filter(w => !/^\d+$/.test(w) && !new Set(wordsOf(named[0].name)).has(w) && !/^(?:on|for|at|to|is|of|the|a|set|put|make|give|change|update|edit|assign|please|needs?|should|must|will|be|in|equals?|gets?|has|bump|raise|lift|increase|up|hit|reach|aim|goal|goals|on)$/.test(w)).length === 0)) return null;
  if (/\b(?:report|stock|phones?|leave|available)\b/.test(t)) return null;
  if (named.length === 1) return `set ${named[0].name} ${seg.name} target to ${n}`;
  if (everyone && targetWord) return `set everyone's ${seg.name} target to ${n}`;
  return null;
}

// ---- stock ----------------------------------------------------------------------------------------------------------------------------------
function stock(t: string, ctx: CanonContext): string | null {
  const imeis = t.match(/\b\d{15}\b/g);
  if (imeis && /\b(?:add|received|got|new|stock|imei)\b/.test(t) && !peopleIn(t, ctx.people).length) {
    const model = modelOf(t.replace(/\b(?:imeis?|received|add|got|stock|with|phone|phones|device)\b/g, ' '), []);
    return model ? `add phone stock ${model} IMEIs ${imeis.join(' ')}` : null;
  }
  if (peopleIn(t, ctx.people).length) return null;
  const qty = firstNumber(t), model = modelOf(t, []);
  if (!qty || !model) return null;
  if (/\b(?:take|pull|remove|delete|drop|write off|scrap|discard|dispose of|strike|cross|knock)\b.*\b(?:out of|off|from)\s+(?:the\s+|my\s+|our\s+)?(?:stock|inventory)\b|\bout of circulation\b/.test(t)) return `remove ${qty} ${model} from stock`;
  if (/\b(?:free up|unlock|unblock|open up)\b.*\b(?:for giving|to give|for the team|for promoters|for sale)\b|\bmake\b.*\bready\s+(?:to give|for giving|to be given)\b/.test(t)) return `make ${qty} ${model} available`;
  if (/\b(?:lock|tuck|stash|stow|put|keep|store)\b.*\baway\b/.test(t)) return `store ${qty} ${model}`;
  if (/\b(?:mark|set|flag|show)\b.*\bas\s+(?:sold out|sold|gone)\b|\bsold out\b/.test(t)) return `remove ${qty} ${model} from stock`;
  if (/\b(?:bring|put|move|return|add|get)\b.*\bback\b.*\b(?:in|into|to|on)\s+(?:the\s+)?(?:stock|inventory)\b|\bre-?stock\b/.test(t)) return `restore ${qty} ${model} to stock`;
  if (/\b(?:release|return|bring)\b.*\bavailable\b|\bmake\b.*\bavailable\b|\b(?:move|put)\b.*\b(?:to|on|as|in)\s+(?:the\s+)?available\b/.test(t)) return `make ${qty} ${model} available`;
  if (/\b(?:reserve|stash|set aside|put aside|keep aside|hold back|keep back|hold on(?: to)?)\b|\b(?:set|put|keep|hold)\b.*\baside\b|\b(?:hold|keep)\b.*\bback\b/.test(t)) return `store ${qty} ${model}`;
  if (/^(?:release|free|unlock)\s+\d+\s+\S+$/.test(t)) return `make ${qty} ${model} available`;
  if (/\b(?:set aside|keep|reserve|stash|hold|store|put|make)\b/.test(t) && /\b(?:aside|in (?:the )?store|into (?:the )?store|away|on hold|stored|for now)\b/.test(t)) return `store ${qty} ${model}`;
  return null;
}

// ---- reports --------------------------------------------------------------------------------------------------------------------------------
function report(t: string, ctx: CanonContext): string | null {
  if (!/\breports?\b/.test(t)) return null;
  const date = t.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (/^(?:the\s+|my\s+|our\s+)?(?:daily\s+)?report\s+(?:for\s+)?(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/.test(t)) return date ? `create the report for ${date}` : /tomorrow/.test(t) ? "prepare tomorrow's report" : "prepare today's report";
  if (/whats\s?app/.test(t)) return /\b(?:make|get|prepare|create|draft|build|do|ready|send|share|compile|generate|need|want)\b|^whats\s?app\b|^(?:the |a |my |today'?s |daily )*whats\s?app (?:daily )?report(?: for (?:the )?(?:group|team|everyone))?$/.test(t) ? `prepare today's WhatsApp report${/\b(?:group|team|everyone)\b/.test(t) ? ' for the group' : ''}` : null;
  const stripped = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  const qty = firstNumber(stripped), model = modelOf(stripped.replace(/\b(?:report|daily|so|is|sold|change|edit|update|numbers?|quantity)\b/g, ' '), []);
  if (qty && model && (!/\b(?:prepare|make|draft|build|produce|generate|create)\b.*\breport\b/.test(t) || /\b(?:show|shows|showing|say|says|read|reads)\b/.test(t)) && !peopleIn(t, ctx.people).length) return `set report ${model} to ${qty}${date ? ' ' + date : ''}`;
  if (qty) return null;
  if (/\b(?:accessor\w*|tablets?|osr)\b/.test(t)) return /\b(?:make|draft|build|produce|get|do|write|compile|generate|prepare|create)\b/.test(t) ? 'prepare the accessories report' : null;
  if (/\b(?:make|draft|build|produce|get|do|write|compile|generate|prepare|create|put together|need|want|require|start|begin|kick off)\b/.test(t)) return date ? `create the report for ${date}` : /\btomorrow\b/.test(t) ? "prepare tomorrow's report" : "prepare today's report";
  return null;
}

// ---- settings and routines ------------------------------------------------------------------------------------------------------------------
function settings(t: string): string | null {
  if (/\buploads?\b.*\bstor(?:e|ed|ing)\b.*\bautomatically\b|\bautomatically\b.*\bstor(?:e|ed|ing)\b.*\buploads?\b/.test(t) && !/\b(?:not|never|off|stop|don't)\b/.test(t)) return 'store uploads automatically';
  const feature = /\b(?:auto(?:matic)?|background)[- ]?crop(?:ping)?\b/.test(t) ? 'automatic detection' : /\bauto(?:matic(?:ally)?)?[- ]?retr(?:y|ies)\b/.test(t) ? 'auto retry' : '';
  if (!feature) return null;
  const off = /\b(?:off|disable|stop|switch off|turn off)\b/.test(t), on = /\b(?:on|enable|start|switch on|turn on)\b/.test(t);
  return off !== on ? `turn ${off ? 'off' : 'on'} ${feature}` : null;
}
function routine(t: string): string | null {
  if (parseSchedule(t)) return null;
  const rewritten = t.replace(/\b(?:each|every)\s+(?:morning|evening|afternoon|night)\b/, 'every day').replace(/\beach\s+(?=week\s*day|weekend|sun|mon|tue|wed|thu|fri|sat)/, 'every ');
  return rewritten !== t && parseSchedule(rewritten) ? rewritten : null;
}

/** Candidate rewrites for a sentence the assistant did not understand as written, most specific first. Never includes the sentence itself. */
const VERB_KIND: [string, RegExp][] = [
  ['set', /\b(?:set|change|update|make|edit|split|divide|share|distribute|spread)\b/], // "set the mid target to 80 and share equally" is one command
  ['give', /\b(?:give|put|assign|transfer|hand|send|move|allocate)\b/],
  ['stock', /\b(?:store|hold|keep|release|remove|delete|drop|erase|take)\b/],
  ['add', /\b(?:add|create|register|prepare)\b/],
  ['other', /\b(?:mark|turn|switch|rename|call|clear|reset|wipe)\b/],
];
/** True when the sentence holds more than one separate KIND of command ("store 4 fold6 and set report fold6 to 6"). Those are refused as a whole, never read as one of them. */
export function hasSeveralCommands(t: string): boolean {
  const kinds = new Set<string>();
  for (const part of t.replace(/\b(?:put|place)\b(?=[^,;]*\b(?:on hold|aside|away)\b)/g, 'keep').replace(/\bstore targets?\b/g, 'storetarget').replace(/\b(?:in|into|to)\s+(?:the\s+)?store\b/g, 'instore').split(/\s*(?:,|;|\bthen\b|\band\b)\s*/)) for (const [kind, re] of VERB_KIND) if (re.test(part)) kinds.add(kind);
  return kinds.size > 1;
}
export function canonicalCandidates(text: string, ctx: CanonContext): string[] {
  let t = digits(tidy(text));
  // "bilals flagship 2 goal" is bilal's; "bilal, 5 fold6 please" is bilal 5 fold6
  for (const p of ctx.people) for (const w of wordsOf(p.name)) if (w.length > 2) t = t.replace(new RegExp(`\\b${w}s\\b`, 'g'), w).replace(new RegExp(`^${w},\\s*(?=\\d)`), `${w} `);
  if (!t || hasSeveralCommands(t)) return [];
  const out: string[] = [];
  for (const attempt of [() => routine(t), () => report(t, ctx), () => target(t, ctx), () => give(t, ctx), () => autoGive(t, ctx), () => stock(t, ctx), () => settings(t)]) {
    let candidate: string | null = null;
    try { candidate = attempt(); } catch { candidate = null; }
    if (candidate && candidate !== t && !out.includes(candidate)) out.push(candidate);
  }
  const plain = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t !== plain && !out.includes(t) && !hasSeveralCommands(t)) out.push(t);
  return out;
}
