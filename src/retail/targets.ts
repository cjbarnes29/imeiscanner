/**
 * Targets. Part 1 reads the text of a Samsung Promoter screenshot (the page's own offline reader supplies the text) into target lines; it is
 * deliberately tolerant (OCR slips, different wording) and says what it could not read instead of guessing. Part 2 does the arithmetic: achieved,
 * remaining units, units needed per day and estimated incentives at 70 %, 100 % and 120 %.
 */
import { daysLeft, isMonth, LEVELS, type DateKey, type IncentiveRates, type Level, type Month, type PersonTarget, type Segment, type TargetLine, SEGMENTS } from './types';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The segment named in a line, or null. Handles "Flagship 1", "F1", "Mid-range", "Tab", "Watch/Buds". */
export function segmentInLine(line: string): Segment | null {
  const text = line.toLowerCase();
  const flagship = text.match(/flag\s*ship\s*[-:#]?\s*([123Il])\b/) || text.match(/\bf\s*([123])\b/) || text.match(/\bfs\s*([123])\b/);
  if (flagship) return (`flagship${flagship[1] === 'I' || flagship[1] === 'l' ? '1' : flagship[1]}`) as Segment;
  if (/\bmid(?:\s*-?\s*range)?\b|\bmidrange\b/.test(text)) return 'mid';
  if (/\blow(?:\s*-?\s*end)?\b|\bentry\b/.test(text)) return 'low';
  if (/\btab(?:let)?s?\b/.test(text)) return 'tablet';
  if (/wearables?|\bwatch|\bbuds\b/.test(text)) return 'wearable';
  return null;
}

/** OCR often reads 0 as O and 1 as l/I inside a number: only repaired when the token is otherwise digits. */
export function repairNumber(token: string): string {
  const t = token.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  return /^\d+(?:\.\d+)?%?$/.test(t) && /\d/.test(token.replace(/[Oo]/g, '0')) ? t : token;
}

/** Repairs every number-looking word of a line (it must hold at least one real digit, so ordinary words are never touched). */
export const repairText = (text: string) => text.replace(/\b[0-9OoIl|SB]*\d[0-9OoIl|SB]*\b/g, token => repairNumber(token));

export type ParsedTargets = { month?: Month; personName?: string; lines: TargetLine[]; warnings: string[]; unparsed: string[] };

/** Month named in the text ("Nov 2026", "November 2026", "11/2026", "2026-11"). */
export function monthInText(text: string): Month | undefined {
  const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.,'-]*(20\d{2})\b/i);
  if (named) return `${named[2]}-${String(MONTHS.indexOf(named[1].toLowerCase()) + 1).padStart(2, '0')}`;
  const iso = text.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const us = text.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
  return us ? `${us[2]}-${us[1].padStart(2, '0')}` : undefined;
}

/**
 * Lines like "Flagship 1   Target 12   Achieved 7   58%" or "Mid  30  21  70%". With keywords the numbers follow their keyword; without, the order is
 * target, achieved, percent. A percent that does not match target/achieved is reported (the numbers are kept as read, the person decides).
 */
export function parseTargetText(text: string): ParsedTargets {
  const out: ParsedTargets = { month: monthInText(text), lines: [], warnings: [], unparsed: [] };
  const name = text.match(/^\s*(?:name|promoter|employee)\s*[:\-]\s*(.+)$/im);
  if (name) out.personName = name[1].trim().slice(0, 60);
  const seen = new Set<Segment>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const segment = segmentInLine(line);
    if (!segment) { if (/\d/.test(line) && /target|achiev/i.test(line)) out.unparsed.push(line.slice(0, 80)); continue; }
    // numbers after the segment name (so the "1" of "Flagship 1" is not a target)
    const after = repairText(line.replace(/^.*?(?:flag\s*ship\s*[-:#]?\s*[123Il]|\bf\s*[123]\b|\bfs\s*[123]\b|mid(?:\s*-?\s*range)?|midrange|low(?:\s*-?\s*end)?|entry|tab(?:let)?s?|wearables?|watch|buds)/i, ''));
    const tokens = (after.match(/[0-9OoIl|SB]+(?:\.\d+)?%?/g) || []).map(repairNumber).filter(token => /^\d+(?:\.\d+)?%?$/.test(token));
    const percent = tokens.find(token => token.endsWith('%'));
    const plain = tokens.filter(token => !token.endsWith('%')).map(Number);
    let target: number | undefined, achieved: number | undefined;
    const keyTarget = after.match(/(?:target|tgt)\D{0,6}(\d+)/i), keyDone = after.match(/(?:achiev\w*|ach\.?|sold|done|actual)\D{0,6}(\d+)/i);
    if (keyTarget || keyDone) { target = keyTarget ? Number(keyTarget[1]) : undefined; achieved = keyDone ? Number(keyDone[1]) : undefined; }
    else if (plain.length >= 2) { [target, achieved] = plain; }
    if (target === undefined || achieved === undefined) { out.unparsed.push(line.slice(0, 80)); continue; }
    if (seen.has(segment)) { out.warnings.push(`${segment}: two lines found, the first one was used`); continue; }
    seen.add(segment);
    if (percent && target > 0) {
      const shown = Number(percent.slice(0, -1)), actual = achieved / target * 100;
      if (Math.abs(shown - actual) > 2.5) out.warnings.push(`${segment}: the screen says ${percent} but ${achieved} of ${target} is ${Math.round(actual)}% (numbers kept as read)`);
    }
    out.lines.push({ segment, target, achieved });
  }
  if (!out.lines.length) out.warnings.push('No target lines were recognised. Check the screenshot, or enter the targets by hand.');
  return out;
}

/** Matches a name read from a screenshot to one of the people (case and spacing ignored; a unique prefix or contained name counts). */
export function matchPerson(name: string | undefined, people: { id: string; name: string }[]): string {
  const wanted = (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!wanted) return '';
  const exact = people.filter(p => p.name.toLowerCase().replace(/\s+/g, ' ').trim() === wanted);
  if (exact.length === 1) return exact[0].id;
  const loose = people.filter(p => { const n = p.name.toLowerCase().trim(); return n && (wanted.includes(n) || n.includes(wanted)); });
  return loose.length === 1 ? loose[0].id : '';
}

// ---- the arithmetic ---------------------------------------------------------------------------------------------------------------

export type Threshold = 70 | 100 | 120;
export const THRESHOLDS: Threshold[] = [70, 100, 120];
export type LineSummary = {
  /** achieved = the screenshot's figure plus sales submitted since it was imported (fromApp). */
  segment: Segment; target: number; achieved: number; fromApp: number; pending: number; projected: number; pct: number;
  at: Record<Level, { needed: number; remaining: number; perDay: number }>;
};
export type TargetSummary = {
  lines: LineSummary[]; daysLeft: number; totalTarget: number; totalAchieved: number; totalPct: number;
  /** The highest threshold the overall percent has reached (0 = below 70 %). */
  tier: 0 | Threshold;
  /** Incentive if every segment reaches exactly that threshold. */
  ifReached: Record<Threshold, number>;
  /** Incentive on what is achieved now at the tier reached now. */
  now: number;
};

const perDay = (remaining: number, days: number) => (remaining <= 0 ? 0 : days <= 0 ? remaining : Math.ceil(remaining / days * 10) / 10);

/**
 * @param pending sold but not yet submitted units per segment (they count toward `projected`, not toward `achieved`)
 * @param since units submitted to Samsung AFTER the screenshot was imported, per segment: the screenshot cannot include them, so they are added to `achieved`
 */
export function summarizeTarget(target: PersonTarget, pending: Partial<Record<Segment, number>>, today: DateKey, rates: IncentiveRates, since: Partial<Record<Segment, number>> = {}): TargetSummary {
  const days = daysLeft(target.month, today);
  const lines: LineSummary[] = target.lines.filter(l => l.target > 0 || l.achieved > 0).map(l => {
    const extra = pending[l.segment] || 0, fromApp = since[l.segment] || 0, achieved = l.achieved + fromApp;
    const at = {} as LineSummary['at'];
    for (const t of LEVELS) {
      // the pieces typed from the Promoter screen win; blank = target x level, rounded up. A segment that stops at 100 % counts 100 % for every higher level.
      const level = effectiveLevel(l, t);
      const typed = l.levels?.[level];
      const needed = typeof typed === 'number' && typed >= 0 ? typed : Math.ceil(l.target * level / 100);
      const remaining = Math.max(0, needed - achieved - extra);
      at[t] = { needed, remaining, perDay: perDay(remaining, days) };
    }
    return { segment: l.segment, target: l.target, achieved, fromApp, pending: extra, projected: achieved + extra, pct: l.target > 0 ? Math.round(achieved / l.target * 1000) / 10 : 0, at };
  });
  const totalTarget = lines.reduce((s, l) => s + l.target, 0), totalAchieved = lines.reduce((s, l) => s + l.achieved, 0);
  const totalPct = totalTarget > 0 ? Math.round(totalAchieved / totalTarget * 1000) / 10 : 0;
  const tier: TargetSummary['tier'] = totalPct >= 120 ? 120 : totalPct >= 100 ? 100 : totalPct >= 70 ? 70 : 0;
  const ifReached = { 70: 0, 100: 0, 120: 0 } as Record<Threshold, number>;
  for (const t of THRESHOLDS) ifReached[t] = Math.round(target.lines.filter(l => l.target > 0 || l.achieved > 0).reduce((sum, l) => sum + Math.ceil(l.target * effectiveLevel(l, t) / 100) * (rates.perUnit[l.segment] || 0), 0) * rates.multiplier[t]);
  const now = tier ? Math.round(lines.reduce((sum, l) => sum + l.achieved * (rates.perUnit[l.segment] || 0), 0) * rates.multiplier[tier]) : 0;
  return { lines, daysLeft: days, totalTarget, totalAchieved, totalPct, tier, ifReached, now };
}

/** The person's overall percent, used to rank who needs units most. */
export const overallPct = (target?: PersonTarget) => {
  const t = target?.lines.reduce((s, l) => s + l.target, 0) || 0;
  return t > 0 ? (target!.lines.reduce((s, l) => s + l.achieved, 0) / t) * 100 : 100;
};

export const emptyTarget = (personId: string, month: Month, source: PersonTarget['source'] = 'manual', at = new Date().toISOString(), segments: Segment[] = SEGMENTS): PersonTarget =>
  ({ personId, month, lines: segments.map(segment => ({ segment, target: 0, achieved: 0 })), source, importedAt: at });

/** The level a line really counts: the asked level, or the line's top level when it stops lower (some segments stop at 100 %). */
export const effectiveLevel = (line: Pick<TargetLine, 'cap'>, level: Level): Level => (line.cap !== undefined && level > line.cap ? line.cap : level);
/** True when this line stops below the asked level. */
export const isCapped = (line: Pick<TargetLine, 'cap'>, level: Level): boolean => line.cap !== undefined && level > line.cap;

/** Pieces still needed at a level for one line of a target (sold counted), and per day for the days left. */
export function needAt(line: TargetLine, level: Level, days: number): { needed: number; remaining: number; perDay: number } {
  const used = effectiveLevel(line, level);
  const typed = line.levels?.[used];
  const needed = typeof typed === 'number' && typed >= 0 ? typed : Math.ceil(line.target * used / 100);
  const remaining = Math.max(0, needed - line.achieved);
  return { needed, remaining, perDay: perDay(remaining, days) };
}

/** Saves a target for a person and month; refuses a bad month. Replacing keeps nothing of the old lines (the screenshot is the truth at that time). */
export function putTarget<S extends { targets: Record<Month, Record<string, PersonTarget>> }>(state: S, target: PersonTarget): S {
  if (!isMonth(target.month) || !target.personId) return state;
  return { ...state, targets: { ...state.targets, [target.month]: { ...(state.targets[target.month] || {}), [target.personId]: target } } };
}

// ---- less typing: levels and months -----------------------------------------------------------------------------------------------------------------

export const prevMonth = (month: Month): Month => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** The six levels filled in with target x level, rounded up (what a blank level already means): for the person to write down and then change the few that differ. */
export const suggestedLevels = (target: number): Partial<Record<Level, number>> => Object.fromEntries(LEVELS.map(level => [level, Math.ceil(Math.max(0, target) * level / 100)])) as Partial<Record<Level, number>>;

/** This person's line for a segment in the month before (target and levels; never sold), when there is one. */
export const lastMonthLine = (state: { targets: Record<Month, Record<string, PersonTarget>> }, month: Month, personId: string, segment: Segment): TargetLine | undefined =>
  state.targets[prevMonth(month)]?.[personId]?.lines.find(l => l.segment === segment && l.target > 0);

/**
 * A new month starts from the last one: every person's target and levels of last month are copied into this month where this month has none yet.
 * Sold always starts at 0 (it is counted again from the phones). Nothing that is already typed for this month is touched.
 */
export function startFromLastMonth<S extends { targets: Record<Month, Record<string, PersonTarget>> }>(state: S, month: Month, knownPeople?: string[]): { state: S; added: number } {
  const last = state.targets[prevMonth(month)] || {};
  let next = state, added = 0;
  for (const [personId, person] of Object.entries(last)) {
    if (knownPeople && !knownPeople.includes(personId)) continue; // a person who was deleted since
    const base = next.targets[month]?.[personId] || emptyTarget(personId, month, 'manual', new Date().toISOString(), []);
    let lines = base.lines;
    for (const line of person.lines) {
      if (!(line.target > 0)) continue;
      const have = lines.find(l => l.segment === line.segment);
      if (have && have.target > 0) continue;
      const copy = { segment: line.segment, target: line.target, achieved: have?.achieved || 0, ...(line.levels ? { levels: { ...line.levels } } : {}), ...(line.cap ? { cap: line.cap } : {}) };
      lines = have ? lines.map(l => (l.segment === line.segment ? copy : l)) : [...lines, copy];
      added++;
    }
    if (lines !== base.lines) next = putTarget(next, { ...base, lines });
  }
  return { state: next, added };
}

// ---- one line of a target, set in one place (the Targets screens and the Edit all grid both use it) -----------------------------------------------------

/** Sets values on one segment line of a person's target for a month. Creates the person's target and the line when they are missing. An undefined value removes it. */
export function setTargetLine<S extends { targets: Record<Month, Record<string, PersonTarget>> }>(state: S, month: Month, personId: string, segment: Segment, patch: Partial<TargetLine>): S {
  const base = state.targets[month]?.[personId] || emptyTarget(personId, month, 'manual', new Date().toISOString(), []);
  const merge = (line: TargetLine): TargetLine => {
    const out = { ...line, ...patch } as TargetLine;
    if (out.cap === undefined) delete out.cap;
    if (out.levels === undefined) delete out.levels;
    return out;
  };
  const exists = base.lines.some(l => l.segment === segment);
  const lines = exists ? base.lines.map(l => (l.segment === segment ? merge(l) : l)) : [...base.lines, merge({ segment, target: 0, achieved: 0 })];
  return putTarget(state, { ...base, lines });
}

// ---- who a screenshot or pasted text is for -------------------------------------------------------------------------------------------------------------

/** Lower case, letters and digits only, single spaces: how names and IDs are compared. */
export const normKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const LABEL = /^\s*(?:name|promoter(?:\s*(?:name|id|code))?|employee(?:\s*(?:name|id|code))?|emp(?:loyee)?\.?\s*(?:name|id|code)|user(?:\s*(?:name|id))?|id|code)\s*[:#\-]\s*(.+)$/i;

export type WhoGuess = { personId: string; /** The name or ID printed on the text (lower case), so a confirmed choice can be remembered. */ key: string; how: 'learned' | 'name' | 'none' };

/**
 * Finds which person a Promoter screenshot (or pasted text) is for, from the name or ID printed on it. A choice the person confirmed earlier (aliases)
 * wins; a whole name of exactly one person found anywhere in the text counts too. When it is not sure it says 'none': it never picks someone.
 */
export function findWho(text: string, people: { id: string; name: string }[], aliases: Record<string, string> = {}): WhoGuess {
  const known = (id: string | undefined) => (id && people.some(p => p.id === id) ? id : '');
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) { const m = line.match(LABEL); if (m) { const key = normKey(m[1]); if (key.length >= 2) keys.push(key); } }
  for (const key of keys) { const id = known(aliases[key]); if (id) return { personId: id, key, how: 'learned' }; }
  const flat = ` ${normKey(text)} `;
  const learnedHits = new Set(Object.entries(aliases).filter(([k, id]) => k.length >= 3 && known(id) && flat.includes(` ${k} `)).map(([, id]) => id));
  if (learnedHits.size === 1) { const id = [...learnedHits][0]; return { personId: id, key: Object.keys(aliases).find(k => aliases[k] === id && flat.includes(` ${k} `)) || '', how: 'learned' }; }
  for (const key of keys) { const id = matchPerson(key, people); if (id) return { personId: id, key, how: 'name' }; }
  const named = people.filter(p => { const n = normKey(p.name); return n.length >= 3 && flat.includes(` ${n} `); });
  if (named.length === 1) return { personId: named[0].id, key: normKey(named[0].name), how: 'name' };
  return { personId: '', key: keys[0] || '', how: 'none' };
}

export type ImportBlock = { text: string; who: WhoGuess; parsed: ParsedTargets };

/**
 * Reads a screenshot's text, or a pasted text that may hold several people (a name or ID line starts each person's part), into one block per person.
 * Each block is read with parseTargetText and gets its own guess of who it is for. Parts with no target line are dropped when there are several.
 */
export function readTargets(text: string, people: { id: string; name: string }[], aliases: Record<string, string> = {}): ImportBlock[] {
  const names = new Set(people.map(p => normKey(p.name)));
  const isHeader = (line: string) => {
    if (LABEL.test(line)) return true;
    const key = normKey(line);
    return !!key && !segmentInLine(line) && !/\d/.test(line) && (names.has(key) || !!aliases[key]);
  };
  const parts: string[][] = [[]];
  let previousHeader = false;
  for (const line of text.split(/\r?\n/)) {
    const header = isHeader(line);
    if (header && !previousHeader && parts[parts.length - 1].some(l => segmentInLine(l))) parts.push([]);
    parts[parts.length - 1].push(line);
    if (line.trim()) previousHeader = header;
  }
  const blocks = parts.map(lines => lines.join('\n')).map(chunk => ({ text: chunk, who: findWho(chunk, people, aliases), parsed: parseTargetText(chunk) }));
  const useful = blocks.filter(b => b.parsed.lines.length);
  return blocks.length > 1 && useful.length ? useful : blocks;
}

/** Remembers that the name or ID printed on a screenshot belongs to this person (only when it is a real key and not already known). */
export function learnWho<S extends { targetAliases?: Record<string, string> }>(state: S, key: string, personId: string): S {
  const k = normKey(key);
  if (k.length < 2 || !personId || state.targetAliases?.[k] === personId) return state;
  return { ...state, targetAliases: { ...(state.targetAliases || {}), [k]: personId } };
}
