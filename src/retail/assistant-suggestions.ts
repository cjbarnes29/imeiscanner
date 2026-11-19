/**
 * What to suggest in the small assistant chat, taken from what the person has actually asked before: things asked more than once first, then the latest
 * ones, then saved questions, and a few starters only to fill the gaps. Pure function, no React. Texts that hold a 15-digit number (an IMEI) or a fixed
 * date are never suggested, because they would not make sense again tomorrow and must not be shown back on screen.
 */
import type { RetailState } from './types';

export type SuggestionKind = 'Often asked' | 'Recent' | 'Saved' | 'Try';
export type Suggestion = { text: string; kind: SuggestionKind };
export const STARTER_QUESTIONS = ['Check my report', 'Plan to reach 70 percent today', 'How much real stock do we have?', 'Make a PowerPoint report for this month', 'Check and explain my settings'];

const keyOf = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
/** A text worth suggesting again: a sentence, not an IMEI list or a one-off date. */
export const reusable = (text: string) => { const t = text.trim(); return t.length >= 4 && t.length <= 120 && !/\d{15}/.test(t) && !/\b20\d{2}-\d{2}-\d{2}\b/.test(t) && !/^report requested:/i.test(t) && !CHAT_ONLY.test(t); };
/** Memory notes and one-word follow-ups ("yes", "undo that", "make it 5") only make sense inside one conversation, so they are never suggested back. */
const CHAT_ONLY = /^(?:(?:please\s+)?(?:remember|make a note|keep in mind|note|forget)\b|what (?:do you|did you) remember|(?:show|list) (?:me )?(?:my |the |your )?(?:memory|notes)|(?:yes|no|nope|yep|ok(?:ay)?|sure|undo(?: that| it)?|never ?mind|go ahead|do it)[.!]*$|(?:make it|actually|instead|change it to) \d+$|(?:and|also|now|same)\b.{0,30}\b(?:too|as well)$)/i;

export function suggestFromHistory(state: Pick<RetailState, 'assistantRequests' | 'savedQuestions'>, limit = 6): Suggestion[] {
  const counts = new Map<string, { text: string; count: number; last: number }>();
  (state.assistantRequests || []).forEach((request, index) => {
    const text = (request.text || '').trim();
    if (!reusable(text)) return;
    const key = keyOf(text), seen = counts.get(key);
    counts.set(key, { text: seen?.text || text, count: (seen?.count || 0) + 1, last: index });
  });
  const out: Suggestion[] = [], used = new Set<string>();
  const add = (text: string, kind: SuggestionKind) => { const key = keyOf(text); if (out.length >= limit || used.has(key) || !reusable(text)) return; used.add(key); out.push({ text: text.trim(), kind }); };
  const rows = [...counts.values()];
  rows.filter(r => r.count >= 2).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 2).forEach(r => add(r.text, 'Often asked'));
  rows.sort((a, b) => b.last - a.last).slice(0, 8).forEach(r => { if (out.filter(s => s.kind === 'Recent').length < 3) add(r.text, 'Recent'); });
  [...(state.savedQuestions || [])].reverse().forEach(q => { if (out.filter(s => s.kind === 'Saved').length < 2) add(q, 'Saved'); });
  STARTER_QUESTIONS.forEach(q => add(q, 'Try'));
  return out;
}
