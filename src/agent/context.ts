import { mentioned } from '../retail/people-commands';
import { MAX_MEMORY_ITEMS, hasImeiLike, memoryText } from '../retail/data';
import type { AgentChatState, RetailState } from '../retail/types';

/**
 * Conversation context and memory. Follow-ups ("and for bilal too", "make it 5", "yes", "undo that") are turned into a plain, complete sentence that goes through the
 * same safety gate, preview and approval as anything typed; nothing here applies a change. Memory is opt-in, visible, editable and deletable, and never holds IMEIs.
 */
type Person = { id: string; name: string };
type Segment = { id: string; name: string };
export type Frame = { command: string; person?: string; qty?: string; segment?: string };
export type FollowUp = { kind: 'none' } | { kind: 'approve' | 'reject' | 'undo' } | { kind: 'command'; text: string; note: string };
export type TalkContext = { people: Person[]; segments: Segment[]; pending: boolean; applied: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tidy = (text: string) => text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/^(?:(?:ok(?:ay)?|hey|so|please|kindly|pls)[ ,]+)+/, '').replace(/\s*[,;]?\s*(?:please|pls|thanks|thank you)\s*[.!]*$/, '').replace(/[.!?]+$/, '').trim();
const flatName = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** What the last understood command was about, so a follow-up can change one part of it. */
export function frameFrom(command: string, people: Person[], segments: Segment[]): Frame {
  const flat = flatName(command);
  const seg = segments.filter(s => flat.includes(flatName(s.name))).sort((a, b) => b.name.length - a.name.length)[0];
  const rest = seg ? flat.replace(flatName(seg.name), ' ') : flat;
  return { command, person: mentioned(command, people)[0]?.name, qty: rest.match(/(?<![\w.-])(\d{1,5})(?![\w.-])/)?.[1], segment: seg?.name };
}

const APPROVE = /^(?:yes|yep|yeah|yup|ok(?:ay)?|sure|do it|go ahead|confirm(?: it)?|approve(?: it)?|apply(?: it)?|please do|that'?s right|looks good)$/;
const REJECT = /^(?:no|nope|nah|cancel(?: it| that)?|never ?mind|forget it|reject(?: it)?|don'?t(?: do it)?|stop)$/;
const UNDO = /^(?:undo(?: that| it| the last (?:one|change|action))?|take that back|revert(?: that| it)?|put it back)$/;

export function resolveFollowUp(text: string, frame: Frame | undefined, ctx: TalkContext): FollowUp {
  const t = tidy(text);
  if (!t) return { kind: 'none' };
  if (APPROVE.test(t)) return ctx.pending ? { kind: 'approve' } : { kind: 'none' };
  if (REJECT.test(t)) return ctx.pending ? { kind: 'reject' } : { kind: 'none' };
  if (UNDO.test(t)) return ctx.applied ? { kind: 'undo' } : { kind: 'none' };
  if (!frame?.command || t.split(' ').length > 6) return { kind: 'none' };

  // "and for bilal too" / "same for bilal" / "now bilal": the same command for someone else
  const cue = t.match(/^(?:(?:and|also|now|then)\s+)*(?:(?:the\s+)?same\s+)?(?:for\s+|to\s+)?(.+?)(?:\s+too|\s+as well|\s+also)?$/);
  if (cue && frame.person && /\b(?:and|also|now|then|same|for|to|too|as well)\b/.test(t)) {
    const who = mentioned(cue[1], ctx.people), spoken = cue[1].trim();
    if (who.length === 1 && (spoken === who[0].name.toLowerCase() || who[0].name.toLowerCase().split(/\s+/).includes(spoken)) && who[0].name.toLowerCase() !== frame.person.toLowerCase() && new RegExp(`\\b${escape(frame.person)}\\b`, 'i').test(frame.command)) {
      const rewritten = frame.command.replace(new RegExp(`\\b${escape(frame.person)}\\b`, 'ig'), who[0].name);
      return { kind: 'command', text: rewritten, note: `Same as before, for ${who[0].name}` };
    }
  }
  // "make it 5" / "actually 8" / "change it to 12": the same command with another number
  const num = t.match(/^(?:make it|make that|change it to|change that to|set it to|actually|instead|no,? make it|how about|what about)\s+(\d{1,5})$/);
  if (num && frame.qty) {
    const rewritten = frame.command.replace(new RegExp(`(?<![\\w.-])${frame.qty}(?![\\w.-])`), num[1]);
    if (rewritten !== frame.command) return { kind: 'command', text: rewritten, note: `Same as before, with ${num[1]}` };
  }
  // "and for mid" / "same on flagship 2": the same command for another segment
  const seg = t.match(/^(?:(?:and|also|now|then)\s+)*(?:(?:the\s+)?same\s+)?(?:for|on)\s+(.+)$/);
  if (seg && frame.segment) {
    const flat = flatName(seg[1]), hit = ctx.segments.filter(s => flat === flatName(s.name) || flat.trim() === s.id.toLowerCase());
    if (hit.length === 1 && hit[0].name.toLowerCase() !== frame.segment.toLowerCase()) return { kind: 'command', text: frame.command.replace(new RegExp(escape(frame.segment), 'ig'), hit[0].name), note: `Same as before, for ${hit[0].name}` };
  }
  return { kind: 'none' };
}

// ---- memory and preferences ---------------------------------------------------------------------------------------------------------------------
export type MemoryCommand =
  | { kind: 'remember'; note: string } | { kind: 'show' } | { kind: 'forget'; what: string }
  | { kind: 'pref'; key: 'defaultModel'; value: string } | { kind: 'pref'; key: 'shortAnswers'; value: boolean };

export function parseMemoryCommand(text: string): MemoryCommand | null {
  const raw = text.trim().replace(/\s+/g, ' '), t = tidy(text);
  const remember = raw.match(/^(?:please\s+)?(?:remember|make a note|keep in mind|note)(?:\s+that|\s*:)?\s+(.+)$/i);
  if (remember) return { kind: 'remember', note: remember[1] };
  if (/^(?:what (?:do you|did you) remember|show (?:me )?(?:my |the |your )?(?:memory|notes)|list (?:my |the |your )?(?:memory|notes)|what(?:'s| is) in (?:your |my )?memory)$/.test(t)) return { kind: 'show' };
  const forget = raw.match(/^(?:please\s+)?forget\s+(?:that\s+|about\s+)?(.+)$/i);
  if (forget) return { kind: 'forget', what: forget[1].trim() };
  const model = t.match(/^(?:always\s+)?use (.+?) (?:when|if) i (?:don'?t|do not) (?:say|give|name|mention) (?:a|the) model$/) || t.match(/^my default model is (.+)$/);
  if (model) return { kind: 'pref', key: 'defaultModel', value: model[1].replace(/[^a-z0-9 \-]/gi, '').trim().slice(0, 40) };
  if (/^(?:answer|reply|talk|keep (?:answers|replies))\s*(?:short(?:ly)?|brief(?:ly)?|concise(?:ly)?)$/.test(t)) return { kind: 'pref', key: 'shortAnswers', value: true };
  if (/^(?:answer|reply|talk)\s*(?:in detail|fully|long(?:er)?)$/.test(t)) return { kind: 'pref', key: 'shortAnswers', value: false };
  return null;
}

export const chatOf = (state: RetailState): AgentChatState => state.agentChat || { memoryOn: false, memory: [], prefs: {} };
const withChat = (state: RetailState, chat: AgentChatState): RetailState => ({ ...state, agentChat: chat });
export const setMemoryOn = (state: RetailState, on: boolean) => withChat(state, { ...chatOf(state), memoryOn: on });
export type MemoryResult = { state: RetailState; message: string; changed: boolean };

export function rememberNote(state: RetailState, note: string, id: string, at: string): MemoryResult {
  const chat = chatOf(state);
  if (!chat.memoryOn) return { state, changed: false, message: 'Memory is off, so I did not save that. Turn it on in Settings > Local AI & model settings > Memory & preferences.' };
  const text = memoryText(note);
  if (!text) return { state, changed: false, message: 'There was nothing to remember.' };
  if (hasImeiLike(text)) return { state, changed: false, message: 'I never remember IMEI numbers, so I did not save that.' };
  if (chat.memory.some(m => m.text.toLowerCase() === text.toLowerCase())) return { state, changed: false, message: 'I already remember that.' };
  if (chat.memory.length >= MAX_MEMORY_ITEMS) return { state, changed: false, message: `Memory is full (${MAX_MEMORY_ITEMS} notes). Delete one first.` };
  return { state: withChat(state, { ...chat, memory: [...chat.memory, { id, text, at }] }), changed: true, message: `Remembered: “${text}”. You can see, edit or delete it in Settings > Local AI & model settings > Memory & preferences.` };
}
export function forgetNote(state: RetailState, what: string): MemoryResult {
  const chat = chatOf(state), key = what.trim().toLowerCase();
  if (!chat.memory.length && !Object.keys(chat.prefs).length) return { state, changed: false, message: 'There is nothing in memory.' };
  if (/^(?:everything|all|all of it|all notes|it all)$/.test(key)) return { state: withChat(state, { ...chat, memory: [], prefs: {} }), changed: true, message: 'Forgot everything: all notes and preferences are deleted.' };
  const hits = chat.memory.filter(m => m.text.toLowerCase().includes(key));
  if (hits.length !== 1) return { state, changed: false, message: hits.length ? `More than one note matches “${what}”. Delete the exact one in Settings > Local AI & model settings > Memory & preferences.` : `I could not find a note about “${what}”.` };
  return { state: withChat(state, { ...chat, memory: chat.memory.filter(m => m.id !== hits[0].id) }), changed: true, message: `Forgot: “${hits[0].text}”.` };
}
export function setPref(state: RetailState, key: 'defaultModel' | 'shortAnswers', value: string | boolean): MemoryResult {
  const chat = chatOf(state);
  if (!chat.memoryOn) return { state, changed: false, message: 'Preferences are saved with memory, which is off. Turn it on in Settings > Local AI & model settings > Memory & preferences.' };
  const prefs = { ...chat.prefs };
  if (key === 'defaultModel') { if (!value) delete prefs.defaultModel; else prefs.defaultModel = String(value); } else { if (value) prefs.shortAnswers = true; else delete prefs.shortAnswers; }
  return { state: withChat(state, { ...chat, prefs }), changed: true, message: key === 'defaultModel' ? (value ? `From now on I will use ${value} when you do not name a model.` : 'Default model cleared.') : value ? 'I will keep answers short.' : 'I will answer in full again.' };
}
export const editNote = (state: RetailState, id: string, text: string): RetailState => { const chat = chatOf(state), t = memoryText(text); return !t || hasImeiLike(t) ? state : withChat(state, { ...chat, memory: chat.memory.map(m => m.id === id ? { ...m, text: t } : m) }); };
export const deleteNote = (state: RetailState, id: string): RetailState => withChat(state, { ...chatOf(state), memory: chatOf(state).memory.filter(m => m.id !== id) });
export const clearMemory = (state: RetailState): RetailState => withChat(state, { ...chatOf(state), memory: [], prefs: {} });
export function describeMemory(state: RetailState): string {
  const chat = chatOf(state), lines: string[] = [];
  if (!chat.memoryOn) return 'Memory is off. Nothing is remembered. Turn it on in Settings > Local AI & model settings > Memory & preferences.';
  if (!chat.memory.length && !Object.keys(chat.prefs).length) return 'Memory is on, and it is empty.';
  lines.push(`I remember ${chat.memory.length} note${chat.memory.length === 1 ? '' : 's'}:`, ...chat.memory.map(m => `- ${m.text}`));
  if (chat.prefs.defaultModel) lines.push(`Preference: use ${chat.prefs.defaultModel} when no model is named.`);
  if (chat.prefs.shortAnswers) lines.push('Preference: short answers.');
  return lines.join('\n');
}
