/**
 * The one safety gate in front of every assistant action. A sentence is only a COMMAND when it is a plain request to do something.
 * Questions ("what if I give 4 Fold6 to Asha"), hypotheticals, conditionals ("if ..."), plans and maybes, statements about the past,
 * negations ("don't remove Asha") and unclear requests (fuzzy numbers, "or" choices, "delete everything") are never turned into a change.
 * Pure logic. Used by the preview (so by chat, tasks, routines and Autopilot alike) and again by the task runner before a step is applied.
 */
export type GuardKind = 'command' | 'question' | 'hypothetical' | 'negated' | 'ambiguous' | 'statement';
export type GuardVerdict = { kind: GuardKind; message: string };

export const PROHIBITION_MESSAGE = 'This sounds like a prohibition or cancellation. Nothing is prepared for execution. Use Reject/Undo for a saved request, or clarify the exact change.';

const ACTION = "(?:give|giving|put|putting|assign|assigning|transfer|transferring|hand|send|sending|move|moving|allocate|allocating|store|storing|hold|holding|keep|keeping|release|releasing|remove|removing|delete|deleting|drop|dropping|erase|erasing|set|change|changing|update|updating|make(?!\\s+it\\b)|making|edit|editing|add|adding|create|creating|register|registering|mark|marking|prepare|preparing|split|splitting|divide|dividing|share|sharing|turn|turning|switch|switching|rename|renaming|call|calling|take|taking|clear|clearing|reset|resetting|wipe|wiping)";
const BASE_ACTION = '(?:give|put|assign|transfer|hand|send|move|allocate|store|hold|keep|release|remove|delete|drop|erase|set|change|update|make|edit|add|create|register|mark|prepare|split|divide|share|turn|switch|rename|call|take|clear|reset|wipe)';

const POLITE = /^(?:(?:ok(?:ay)?|hey|hi|so|please|kindly|pls)[ ,]+)*(?:can|could|would|will)\s+(?:you|u|ya)\b/i;
const NEGATION = new RegExp(`\\b(?:don'?t|don’t|do not|doesn'?t|never|no need to|stop|avoid|shouldn'?t|should not|won'?t|will not|can'?t|can’t|cannot|can not|wouldn'?t|mustn'?t)\\s+(?:[\\w'’-]+\\s+){0,2}?${ACTION}\\b|\\bnot\\s+(?:to\\s+)?${ACTION}\\b|^(?:cancel|abort)(?:\\s+(?:it|that|this|everything|all))?\\s*[.!]*$|^(?:undo|never ?mind|forget (?:it|that))\\b|^stop(?:\\s+(?:it|that|this|please))?\\s*[.!]*$`, 'i');
const HYPOTHETICAL = /\b(?:what if|what happens|what would|what will|if i|if we|if you|if it|if they|suppose|supposing|imagine|let'?s say|say i|in case|hypothetically|would it|would that|would this|might|maybe|perhaps|possibly|i could|we could|you could|thinking (?:about|of)|considering|wondering|wonder if|not sure (?:if|whether)|tell me (?:how|what|if|about|why)|how (?:do|can|could|would|should|to) (?:i|we|you)|is it possible|is there a way|going to|gonna|plan to|planning to|about to|someday|eventually|one day|planned to|wanted to|meant to|intended to|decided to|hoped to|tried to|was going to|were going to|used to|(?:would|could|should|might|must) have (?:\w+(?:ed|en)|given|sold|set|put|made|done|gone|got|kept|held|sent|left|met|paid|taken)\b|forgot to)\b|\bif\b|\b(?:i|we)(?:'ll|’ll|\s+(?:will|shall|might|may))\b|\bi (?:think|guess|believe|suppose|reckon)\b|\bnot sure\b|\bprobably\b/i;
const WH_QUESTION = /^(?:what|who|whom|whose|when|where|why|how|which)(?:['’]?s)?\b/i;
const AUX_QUESTION = /^(?:is|are|was|were|am|have|has|had|did|does|will|shall|may|might)\b/i;
const MODAL_QUESTION = /^(?:can|could|should|would|must)\b/i;
const DO_QUESTION = /^do\s+(?:you|i|we|they)\b/i;
const PAST_START = /^(?:i|we|he|she|they)\s+(?:already\s+|just\s+)?(?:gave|given|stored|held|removed|deleted|added|set|sold|marked|changed|updated|moved|put|assigned|transferred|renamed|prepared|sent|took)\b/i;
const LATER_IMPERATIVE = new RegExp(`[,;]\\s*(?:and\\s+|then\\s+|so\\s+|please\\s+)*${BASE_ACTION}\\b|\\b(?:and|then)\\s+(?:please\\s+)?${BASE_ACTION}\\b`, 'i');
const PAST_TIME = /\b(?:yesterday|last (?:night|week|month|year)|earlier today|previously|a (?:while|week|month) ago|\d+ (?:days?|weeks?|months?) ago)\b/i;
const STARTS_WITH_ACTION = new RegExp(`^(?:(?:ok(?:ay)?|hey|so|also|please|kindly|pls)[ ,]+)*(?:(?:can|could|would|will)\\s+(?:you|u|ya)\\s+(?:please\\s+)?)?${BASE_ACTION}\\b`, 'i');
const HAS_ACTION = new RegExp(`\\b${BASE_ACTION}\\b`, 'i');
const BULK = /\b(?:delete|remove|clear|wipe|erase|reset|purge|drop)\s+(?:all|every|everything|everyone|everybody|the whole|the entire|entire|whole)\b|\b(?:wipe|purge|factory reset)\b/i;
const FUZZY = /\b(?:about|around|roughly|approximately|approx\.?|some|a few|a couple(?: of)?|several|a bunch of|loads of|plenty of|most of|many|few)\s+(?:\d+\s+|of\s+)?(?:the\s+)?(?:phones?|fold\w*|flip\w*|galaxy|samsung|sm-?\w+|units?|imeis?|models?|\d+)\b/i;
const CHOICE = /\b(?:either|or)\b/i;

const clean = (text: string) => text.trim().replace(/\s+/g, ' ');
const is = (kind: GuardKind, message = ''): GuardVerdict => ({ kind, message });

export function guardVerdict(text: string): GuardVerdict {
  const t = clean(text);
  if (!t) return is('command');
  const polite = POLITE.test(t);
  if (NEGATION.test(t)) return is('negated', PROHIBITION_MESSAGE);
  if (HYPOTHETICAL.test(t)) return is('hypothetical');
  if (!polite && (WH_QUESTION.test(t) || AUX_QUESTION.test(t) || MODAL_QUESTION.test(t) || DO_QUESTION.test(t) || /\?\s*$/.test(t))) return is('question');
  if (PAST_START.test(t) && !LATER_IMPERATIVE.test(t)) return is('statement');
  if (PAST_TIME.test(t) && !STARTS_WITH_ACTION.test(t) && !LATER_IMPERATIVE.test(t)) return is('statement');
  if (BULK.test(t)) return is('ambiguous', 'I do not delete, clear or reset everything by chat. Name the exact person, model and quantity. Nothing was changed.');
  if (FUZZY.test(t)) return is('ambiguous', 'Say an exact number, not “about” or “some”. Nothing was changed.');
  if ((HAS_ACTION.test(t) || /\b\d{1,5}\b/.test(t)) && CHOICE.test(t)) return is('ambiguous', 'This offers a choice (“or”). Say exactly which one. Nothing was changed.');
  return is('command');
}
