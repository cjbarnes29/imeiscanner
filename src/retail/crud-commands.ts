import { mentioned } from './people-commands';
import { addDays, findDates } from './calendar-commands';
import { emptySchedule, availabilityAt, availabilityLabel } from './availability';
import { setTargetLine } from './targets';
import { segmentDefs } from './segments';
import { itemFor } from './catalog';
import { isSold } from './sales';
import { luhnValid } from '../imei-validate';
import { monthOf, type RetailState } from './types';
import type { RetailRecord } from './ui-helpers';
import type { AssistantBusiness } from './assistant-actions';

/**
 * The rest of create / read / update / delete for each module, in everyday wording. Pure logic: it only builds a preview (lines, warnings, what would change);
 * a reviewed, confirmed request applies it, and Undo restores it. Reads change nothing. Removals are marked destructive by the tool registry, so they need the
 * explicit confirmation (press and hold, or type CONFIRM for a big change).
 */
type Person = { id: string; name: string };
export type CrudPreview = { handled: boolean; lines: string[]; blockers: string[]; warnings: string[]; business?: { before: AssistantBusiness; after: AssistantBusiness }; moves?: { id: string; from: string; to: string }[] };
const none = (): CrudPreview => ({ handled: false, lines: [], blockers: [], warnings: [] });
const done = (p: Partial<CrudPreview>): CrudPreview => ({ handled: true, lines: [], blockers: [], warnings: [], ...p });
const norm = (v: string) => v.toLowerCase().replace(/samsung|galaxy|\(demo\)|\(test\)/g, '').replace(/[^a-z0-9]/g, '');
const tidy = (text: string) => text.trim().replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/^(?:(?:ok(?:ay)?|hey|so|please|kindly|pls)[ ,]+)*(?:(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?|i\s+(?:want|need)\s+(?:you\s+)?to\s+)?/i, '').replace(/\s*[,;]?\s*(?:please|pls|thanks)\s*[.!]*$/i, '').replace(/[.!?]+$/, '');
const LEAVE = '(?:annual leave|leave|holidays?|time off|days? off|vacation)';
const range = (r: { start: string; end: string }) => (r.start === r.end ? r.start : `${r.start} to ${r.end}`);
const inRange = (r: { start: string; end: string }, from: string, to: string) => r.start <= to && r.end >= from;

type Ctx = { state: RetailState; records: RetailRecord[]; people: Person[]; today: string };

// ---- calendar -------------------------------------------------------------------------------------------------------------------------------
function calendar(t: string, c: Ctx): CrudPreview {
  const lower = t.toLowerCase();
  const who = mentioned(lower, c.people), schedule = (id: string) => c.state.workSchedules?.[id] || emptySchedule();
  // read: "when is asha off", "show asha's leave" (a named person; "who is off tomorrow" stays with the saved-data answers)
  if (who.length === 1 && new RegExp(`^(?:when|what days)\\s+(?:is|are)\\s+.+\\s+(?:off|away|on leave|on holiday|unavailable|not available)$|^(?:show|list)\\s+(?:me\\s+)?(?:.+?'?s?\\s+)?${LEAVE}$`).test(lower)) {
    const ranges = [...schedule(who[0].id).annualLeave].sort((a, b) => a.start.localeCompare(b.start));
    return done({ lines: ranges.length ? [`${who[0].name}'s saved leave:`, ...ranges.map(r => `- ${range(r)}`)] : [`No leave is saved for ${who[0].name}.`] });
  }
  const cancel = lower.match(new RegExp(`^(?:cancel|remove|delete|clear)\\s+(?:the\\s+)?(.+?)'?s?\\s+${LEAVE}(?:\\s+(.+))?$`)) || lower.match(new RegExp(`^(?:cancel|remove|delete|clear)\\s+(?:the\\s+)?${LEAVE}\\s+(?:for|of)\\s+(.+?)(?:\\s+(?:on|from)\\s+(.+))?$`));
  const move = lower.match(new RegExp(`^(?:move|shift|reschedule|change)\\s+(.+?)'?s?\\s+${LEAVE}\\s+(?:from|on)\\s+(.+?)\\s+(?:to|until|till)\\s+(.+)$`));
  const extend = lower.match(new RegExp(`^(extend|shorten)\\s+(.+?)'?s?\\s+${LEAVE}\\s+(?:until|to|till)\\s+(.+)$`));
  const match = cancel || move || extend;
  if (!match) return none();
  const personText = extend ? extend[2] : match[1], person = mentioned(personText, c.people);
  if (person.length !== 1) return done({ blockers: [`Choose one saved person for “${personText}”. Saved people: ${c.people.map(p => p.name).join(', ') || 'none'}.`] });
  const p = person[0], ranges = schedule(p.id).annualLeave;
  const before: AssistantBusiness = { workSchedules: c.state.workSchedules || {}, targets: c.state.targets, leaveTransfers: c.state.leaveTransfers || [] };
  const save = (next: typeof ranges, line: string): CrudPreview => ({ handled: true, lines: [line, 'Existing shifts and recurring days stay saved. Linked target changes are reviewed separately; calendar approval alone never applies them.'], blockers: [], warnings: [], business: { before, after: { workSchedules: { ...c.state.workSchedules, [p.id]: { ...schedule(p.id), annualLeave: next } }, targets: c.state.targets, leaveTransfers: c.state.leaveTransfers || [] } } });
  if (cancel) {
    const dates = findDates(cancel[2] || '', c.today).hits.map(h => h.date);
    let hit: typeof ranges;
    if (dates.length) { const from = dates[0], to = dates[1] || dates[0]; hit = ranges.filter(r => inRange(r, from, to)); if (!hit.length) return done({ blockers: [`${p.name} has no leave saved on ${from}${to !== from ? ' to ' + to : ''}.`] }); }
    else if (ranges.length === 1) hit = ranges;
    else return done({ blockers: [ranges.length ? `${p.name} has ${ranges.length} saved leaves (${ranges.map(range).join('; ')}). Say which: “cancel ${p.name}'s leave on ${ranges[0].start}”.` : `No leave is saved for ${p.name}.`] });
    return save(ranges.filter(r => !hit.includes(r)), `Cancel ${p.name}'s leave: ${hit.map(range).join('; ')}.`);
  }
  if (move) {
    const from = findDates(move[2], c.today).hits[0]?.date, target = findDates(move[3], c.today).hits;
    if (!from || !target.length) return done({ blockers: ['Say the dates: “move Asha’s leave from 2026-11-20 to 2026-11-23”.'] });
    const old = ranges.find(r => inRange(r, from, from));
    if (!old) return done({ blockers: [`${p.name} has no leave saved on ${from}.`] });
    const length = Math.round((new Date(`${old.end}T12:00:00Z`).getTime() - new Date(`${old.start}T12:00:00Z`).getTime()) / 86400000);
    const start = target[0].date, end = target[1]?.date || addDays(start, length);
    if (end < start) return done({ blockers: ['The new end is before the new start.'] });
    return save(ranges.map(r => r === old ? { ...r, start, end } : r), `Move ${p.name}'s leave: ${range(old)} → ${range({ start, end })}.`);
  }
  const until = findDates(extend![3], c.today).hits[0]?.date;
  if (!until) return done({ blockers: ['Say the new last day: “extend Asha’s leave until 2026-11-25”.'] });
  const open = [...ranges].filter(r => r.end >= c.today).sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!open) return done({ blockers: [`${p.name} has no upcoming leave to ${extend![1]}.`] });
  if (until < open.start) return done({ blockers: [`${until} is before the leave starts (${open.start}).`] });
  return save(ranges.map(r => r === open ? { ...r, end: until } : r), `${extend![1] === 'extend' ? 'Extend' : 'Shorten'} ${p.name}'s leave: ${range(open)} → ${range({ start: open.start, end: until })}.`);
}

// ---- targets --------------------------------------------------------------------------------------------------------------------------------
function targets(t: string, c: Ctx): CrudPreview {
  const lower = t.toLowerCase(), month = monthOf(c.today), flat = ` ${lower.replace(/[^a-z0-9]+/g, ' ')} `;
  const defs = segmentDefs(c.state), seg = defs.filter(s => flat.includes(` ${s.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `) || flat.includes(` ${s.id.toLowerCase()} `)).sort((a, b) => b.name.length - a.name.length)[0];
  const who = mentioned(lower, c.people);
  const read = /^(?:what(?:'s| is| are)|show|list|how (?:is|are))\b.*\btargets?\b/.test(lower) || /^show\b.*\btargets?\b/.test(lower);
  if (read && who.length && !/\b(?:set|change|make|update)\b/.test(lower)) { // only for a named person: "show my targets" stays with the saved-data answers
    const people = who, lines: string[] = [];
    for (const p of people) { const rows = (c.state.targets[month]?.[p.id]?.lines || []).filter(l => (!seg || l.segment === seg.id) && (seg || l.target > 0 || l.achieved > 0)); for (const l of rows) lines.push(`${p.name} · ${defs.find(d => d.id === l.segment)?.name || l.segment}: target ${l.target}, achieved ${l.achieved}`); }
    return done({ lines: lines.length ? [`Targets for ${month}:`, ...lines] : [`No targets are set for ${month}${who.length === 1 ? ' for ' + who[0].name : ''}${seg ? ' in ' + seg.name : ''}.`] });
  }
  const clear = lower.match(/^(?:clear|remove|delete|zero|reset|unset)\s+(?:the\s+)?(.+?)\s+targets?(?:\s+(?:for|of)\s+(.+))?$/);
  if (!clear) return none();
  if (!seg) return done({ blockers: ['Say which target to clear, for example: “clear Asha’s Flagship 1 target”.'] });
  if (who.length !== 1) return done({ blockers: [`Choose one saved person for the ${seg.name} target. Saved people: ${c.people.map(p => p.name).join(', ') || 'none'}.`] });
  const p = who[0], now = c.state.targets[month]?.[p.id]?.lines.find(l => l.segment === seg.id)?.target || 0;
  if (!now) return done({ blockers: [`${p.name} has no ${seg.name} target to clear.`] });
  const next = setTargetLine(c.state, month, p.id, seg.id, { target: 0 });
  return done({ lines: [`${p.name} · ${seg.name}: target ${now} → 0 (cleared). Sold and achieved numbers are not changed.`], business: { before: { targets: c.state.targets }, after: { targets: next.targets } } });
}

// ---- gives: who has what, move between people, take back ------------------------------------------------------------------------------------
const owned = (c: Ctx, personId: string) => c.records.filter(r => r.personId === personId && !isSold(c.state, r.id, r.imei));
function gives(t: string, c: Ctx): CrudPreview {
  const lower = t.toLowerCase();
  const read = lower.match(/^how many (?:phones? )?(?:does|has) (.+?) (?:have|got)$/) || lower.match(/^what (?:phones? )?(?:does|has) (.+?) (?:have|got)$/) || lower.match(/^(?:show|list) (.+?)'?s? phones$/);
  if (read) {
    const who = mentioned(read[1], c.people);
    if (who.length !== 1) return done({ blockers: [`Choose one saved person for “${read[1]}”.`] });
    const rows = owned(c, who[0].id), by = new Map<string, number>();
    for (const r of rows) { const name = itemFor(c.state, r.model)?.name || r.model || 'Unknown'; by.set(name, (by.get(name) || 0) + 1); }
    return done({ lines: [`${who[0].name} has ${rows.length} phone${rows.length === 1 ? '' : 's'}${rows.length ? ': ' + [...by].map(([n, k]) => `${n} × ${k}`).join(', ') : ''}.`] });
  }
  const move = lower.match(/^(?:move|transfer|shift|switch|reassign)\s+(\d{1,4})\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+)$/);
  const back = lower.match(/^(?:take back|take|return|unassign|pull|collect)\s+(\d{1,4})\s+(.+?)\s+(?:back\s+)?from\s+(.+)$/);
  const m = move || back;
  if (!m) return none();
  const fromText = move ? move[3] : back![3], from = mentioned(fromText, c.people), to = move ? mentioned(move[4], c.people) : [];
  if (from.length !== 1 || (move && to.length !== 1)) return done({ blockers: ['Name one saved person to take the phones from' + (move ? ' and one to give them to' : '') + `. Saved people: ${c.people.map(p => p.name).join(', ') || 'none'}.`] });
  if (move && from[0].id === to[0].id) return done({ blockers: ['The phones are already with that person.'] });
  const qty = +m[1], query = norm(m[2].replace(/\b(?:phones?|units?|of|the)\b/g, ' '));
  if (!qty || !query) return done({ blockers: ['Say how many and which model: “move 2 Fold6 from Asha to Bilal”.'] });
  const pool = owned(c, from[0].id).filter(r => !r.needsReview && luhnValid(r.imei) && !(r as { duplicate?: boolean }).duplicate && (norm(r.model).includes(query) || norm(itemFor(c.state, r.model)?.name || '').includes(query))).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
  const models = new Set(pool.map(r => r.model));
  if (models.size > 1) return done({ blockers: [`“${m[2]}” matches ${[...models].map(x => itemFor(c.state, x)?.name || x).join(', ')}. Say one exact model.`] });
  if (pool.length < qty) return done({ blockers: [`${from[0].name} has only ${pool.length} matching phone${pool.length === 1 ? '' : 's'} that can be moved. Nothing is changed partially.`] });
  const chosen = pool.slice(0, qty), name = itemFor(c.state, chosen[0].model)?.name || chosen[0].model, dest = move ? to[0] : undefined;
  const warnings = dest && availabilityAt(c.state, dest.id, c.today) !== 'working' ? [`${dest.name}: ${availabilityLabel(c.state, dest.id, c.today)}. A manual override is required and recorded.`] : [];
  return done({ moves: chosen.map(r => ({ id: r.id, from: from[0].id, to: dest?.id || '' })), warnings, lines: [dest ? `Move ${qty} ${name} from ${from[0].name} to ${dest.name}. Ownership only; true stock and sales unchanged.` : `Take back ${qty} ${name} from ${from[0].name}: they become Unassigned (the phones are not deleted).`] });
}

// ---- stock: bring removed phones back ---------------------------------------------------------------------------------------------------------
function stock(t: string, c: Ctx): CrudPreview {
  const m = t.toLowerCase().match(/^(?:restore|bring back|put back|return|reinstate)\s+(\d{1,4})\s+(.+?)\s+(?:to|into|in|back to|back into)\s+(?:the\s+|my\s+|our\s+)?(?:stock|inventory)$/);
  if (!m) return none();
  const qty = +m[1], query = norm(m[2].replace(/\b(?:phones?|units?|removed|of|the)\b/g, ' '));
  if (!qty || !query) return done({ blockers: ['Say how many and which model: “restore 2 Fold6 to stock”.'] });
  const removed = c.records.filter(r => c.state.recordMeta[r.id]?.status === 'given' && (norm(r.model).includes(query) || norm(itemFor(c.state, r.model)?.name || '').includes(query)));
  const models = new Set(removed.map(r => r.model));
  if (models.size > 1) return done({ blockers: [`“${m[2]}” matches ${[...models].map(x => itemFor(c.state, x)?.name || x).join(', ')}. Say one exact model.`] });
  if (removed.length < qty) return done({ blockers: [`Only ${removed.length} matching removed phone${removed.length === 1 ? ' is' : 's are'} recorded. Nothing is changed partially.`] });
  const meta = { ...c.state.recordMeta };
  for (const r of removed.slice(0, qty)) meta[r.id] = { ...meta[r.id], status: undefined };
  return done({ lines: [`${qty} ${itemFor(c.state, removed[0].model)?.name || removed[0].model} → back in stock (the removal status is cleared; records were never deleted).`], business: { before: { recordMeta: c.state.recordMeta }, after: { recordMeta: meta } } });
}

// ---- reports: discard a draft --------------------------------------------------------------------------------------------------------------------
function reports(t: string, c: Ctx): CrudPreview {
  const lower = t.toLowerCase();
  if (!/^(?:discard|delete|remove|clear|drop|scrap)\s+(?:the\s+)?(?:(?:today'?s|tomorrow'?s|saved|\d{4}-\d{2}-\d{2})\s+)*(?:report\s+)?draft\b/.test(lower)) return none();
  const date = findDates(lower, c.today).hits[0]?.date || (/tomorrow/.test(lower) ? addDays(c.today, 1) : c.today);
  if (!c.state.reportDrafts?.[date]) return done({ blockers: [`There is no saved report draft for ${date}.`] });
  const drafts = { ...c.state.reportDrafts }; delete drafts[date];
  return done({ lines: [`Discard the saved report draft for ${date}. Actual stock, sales and the calculated report are not changed; the draft can be made again.`], business: { before: { reportDrafts: c.state.reportDrafts }, after: { reportDrafts: drafts } } });
}

// ---- routines: list, pause, resume, delete -----------------------------------------------------------------------------------------------------
function routines(t: string, c: Ctx): CrudPreview {
  const lower = t.toLowerCase(), all = c.state.assistantRoutines || [];
  if (/^(?:list|show)\s+(?:me\s+)?(?:my\s+|the\s+|all\s+)?routines?$/.test(lower)) return done({ lines: all.length ? [`${all.length} routine${all.length === 1 ? '' : 's'}:`, ...all.map(r => `- ${r.text}${r.time ? ' · ' + r.time : ''}${r.enabled ? '' : ' (paused)'}`)] : ['No routines are saved.'] });
  const m = lower.match(/^(pause|resume|disable|enable|stop|delete|remove|cancel)\s+(?:the\s+|my\s+)?(.+?)\s+routine$/) || lower.match(/^(pause|resume|disable|enable|stop|delete|remove|cancel)\s+(?:the\s+|my\s+)?routine\s+(.+)$/);
  if (!m) return none();
  const query = m[2].replace(/\b(?:the|my|daily|every day)\b/g, ' ').replace(/\s+/g, ' ').trim(), time = query.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const hhmm = time ? `${String(((+time[1]) % 12) + (time[3] === 'pm' ? 12 : 0)).padStart(2, '0')}:${time[2] || '00'}` : '';
  const words = query.replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/g, ' ').split(' ').filter(w => w.length > 2);
  const hits = all.filter(r => (hhmm && r.time === hhmm) || (words.length > 0 && words.every(w => r.text.toLowerCase().includes(w))));
  if (hits.length !== 1) return done({ blockers: [hits.length ? `More than one routine matches “${query}”: ${hits.map(r => r.text).join('; ')}. Use more words.` : `No routine matches “${query}”. Say “list my routines” to see them.`] });
  const r = hits[0], verb = m[1], pausing = /^(?:pause|disable|stop)$/.test(verb), deleting = /^(?:delete|remove|cancel)$/.test(verb);
  if (!deleting && ((pausing && !r.enabled) || (!pausing && r.enabled))) return done({ blockers: [`That routine is already ${r.enabled ? 'running' : 'paused'}.`] });
  const after = deleting ? all.filter(x => x.id !== r.id) : all.map(x => x.id === r.id ? { ...x, enabled: !pausing } : x);
  return done({ lines: [deleting ? `Delete the routine “${r.text}”${r.time ? ' (' + r.time + ')' : ''}. Its history stays in the assistant log.` : `${pausing ? 'Pause' : 'Resume'} the routine “${r.text}”${r.time ? ' (' + r.time + ')' : ''}.`], business: { before: { assistantRoutines: all }, after: { assistantRoutines: after } } });
}

/** The one entry point. `handled` is false when the sentence is none of these operations. */
export function previewCrud(text: string, state: RetailState, records: RetailRecord[], people: Person[], today: string): CrudPreview {
  const t = tidy(text), c: Ctx = { state, records, people, today };
  if (!t) return none();
  for (const part of [calendar, targets, gives, stock, reports, routines]) { const r = part(t, c); if (r.handled) return r; }
  return none();
}
