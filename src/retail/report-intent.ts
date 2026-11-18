/**
 * Understands a typed request for an app report ("make a PowerPoint report for last month", "excel report for Asha", "give me simple notes of my targets").
 * Pure functions. It is deliberately strict: the word "report" already means the WhatsApp stock report ("set report Fold6 to 6", "prepare today report"), so
 * a text is only taken as a request for an app report file when it asks to make something AND names a kind of file (Excel, PowerPoint, notes) or a kind
 * of overview (summary, performance, monthly, targets, business). Anything else is left to the other assistant rules. It never guesses a person: a name
 * that is not clearly one saved person leaves the report for everyone and says so.
 */
import { normKey } from './targets';
import type { Month } from './types';

export type ReportFormat = 'xlsx' | 'pptx' | 'notes';
export type ReportIntent = { format: ReportFormat; /** a month the text asked for, or '' for the current one */ month: Month | ''; /** a saved person, or '' for everyone */ personId: string; /** what was understood, in words */ summary: string; /** a person name was in the text but matched nobody or more than one */ personUnclear: boolean };

const MAKE = /\b(make|create|build|prepare|generate|write|produce|export|give\s+me|get\s+me|send\s+me|i\s+need|can\s+you\s+(?:make|create|prepare))\b/i;
const FORMAT: [ReportFormat, RegExp][] = [
  ['xlsx', /\b(excel|xlsx|spreadsheet|work\s*sheet)\b/i],
  ['pptx', /\b(power\s*point|pptx?|slides?|slide\s*deck|presentation|deck)\b/i],
  ['notes', /\b(simple\s+notes?|notes?|plain\s+text|text\s+summary|written\s+summary)\b/i]
];
const OVERVIEW = /\b(overview|summary|performance|monthly|month(?:ly)?\s+report|business|progress|achievement|app\s+report|targets?\s+report|report\s+(?:of|on|about|for)\s+(?:my\s+|the\s+|our\s+)?(?:targets?|sales|stock|month|team|store))\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const FORMAT_WORDS: Record<ReportFormat, string> = { xlsx: 'an Excel file', pptx: 'a PowerPoint file', notes: 'simple notes' };

const prevMonth = (month: Month): Month => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** The month named in a text: "last month", "2026-10", "October" / "October 2026" (a month still to come this year means last year's). */
export function monthInRequest(text: string, today: string): Month | '' {
  const current = today.slice(0, 7);
  if (/\blast\s+month\b|\bprevious\s+month\b/i.test(text)) return prevMonth(current);
  const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const named = text.match(new RegExp(`\\b(${MONTHS.join('|')})\\b(?:\\s+(20\\d{2}))?`, 'i'));
  if (named) {
    const index = MONTHS.indexOf(named[1].toLowerCase());
    const [cy, cm] = current.split('-').map(Number);
    const year = named[2] ? Number(named[2]) : index + 1 > cm ? cy - 1 : cy;
    return `${year}-${String(index + 1).padStart(2, '0')}`;
  }
  return '';
}

export function parseReportIntent(text: string, people: { id: string; name: string }[], today: string): ReportIntent | null {
  const raw = text.trim();
  if (!raw || raw.length > 400 || !MAKE.test(raw)) return null;
  // the existing report commands win: editing a report line, or the dated WhatsApp stock report without a file kind
  if (/\b(?:set|edit|update|change)\b[^.]*\breport\b/i.test(raw) && !FORMAT.some(([, re]) => re.test(raw))) return null;
  if (/\bwhats\s*app\b|\bstock\s+report\b|\bdated\s+report\b/i.test(raw)) return null;
  const hit = FORMAT.find(([, re]) => re.test(raw));
  const overview = OVERVIEW.test(raw);
  if (!hit && !overview) return null;
  if (!/\b(report|overview|summary|notes?|presentation|slides?|power\s*point|pptx?|excel|xlsx|spreadsheet|deck)\b/i.test(raw)) return null;
  // "prepare today report" alone is the dated stock report: it needs a file kind or an overview word to count here
  const format: ReportFormat = hit ? hit[0] : 'notes';

  const flat = ` ${normKey(raw)} `;
  const named = people.filter(p => { const n = normKey(p.name); return n.length >= 3 && flat.includes(` ${n} `); });
  const firstNames = named.length ? named : people.filter(p => { const first = normKey(p.name).split(' ')[0]; return first.length >= 3 && flat.includes(` ${first} `); });
  const personId = firstNames.length === 1 ? firstNames[0].id : '';
  // "for <someone>" with a word that is not a saved person (and not "everyone", "last month", a month name…) is reported, never guessed
  const forWord = raw.match(/\bfor\s+([a-z][a-z'-]{2,})/i)?.[1].toLowerCase() || '';
  const NOT_A_NAME = new Set(['everyone', 'everybody', 'all', 'the', 'my', 'our', 'last', 'this', 'each', 'every', 'next', 'today', 'now', 'me', 'us', 'team', 'store', 'month', 'week', 'year', ...MONTHS, ...MONTHS.map(m => m.slice(0, 3))]);
  const personUnclear = firstNames.length > 1 || (!personId && !!forWord && !NOT_A_NAME.has(forWord));
  const month = monthInRequest(raw, today);
  const who = personId ? people.find(p => p.id === personId)!.name : 'everyone';
  return { format, month, personId, personUnclear, summary: `${FORMAT_WORDS[format]} for ${who}, ${month ? month : 'this month'}` };
}
