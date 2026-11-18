/**
 * Voice input, pure part: audio helpers and transcript clean-up. No browser APIs here, so it is fully unit-tested.
 * The model (Whisper tiny, English) is in voice.worker.ts. The person always sees and can edit the transcript before anything runs.
 */
export const SAMPLE_RATE = 16000;
export const MAX_VOICE_SECONDS = 45;

/** Mixes channels to mono and resamples to 16 kHz (linear), which is what the speech model expects. */
export function toMono16k(channels: Float32Array[], sourceRate: number): Float32Array {
  if (!channels.length || !channels[0].length || sourceRate <= 0) return new Float32Array(0);
  const length = channels[0].length, mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += (channel[i] || 0) / channels.length;
  if (sourceRate === SAMPLE_RATE) return mono;
  const ratio = sourceRate / SAMPLE_RATE, out = new Float32Array(Math.max(1, Math.floor(length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const position = i * ratio, left = Math.floor(position), right = Math.min(length - 1, left + 1), fraction = position - left;
    out[i] = mono[left] * (1 - fraction) + mono[right] * fraction;
  }
  return out;
}

/** The first `seconds` of the audio (the clip is capped so a forgotten recording cannot grow without limit). */
export const clipAudio = (audio: Float32Array, seconds = MAX_VOICE_SECONDS) => audio.length > seconds * SAMPLE_RATE ? audio.slice(0, seconds * SAMPLE_RATE) : audio;

/** Loudness of the clip (root mean square). A near-zero value means nothing was said. */
export function loudness(audio: Float32Array): number {
  if (!audio.length) return 0;
  let sum = 0;
  for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
  return Math.sqrt(sum / audio.length);
}
export const isSilent = (audio: Float32Array) => audio.length < SAMPLE_RATE * 0.3 || loudness(audio) < 0.004;

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumberWord = (w: string) => w in ONES || w in TENS || w === 'hundred';

/** "one hundred and twenty" -> 120, "twenty five" -> 25. Only up to 999. Returns the value and how many words it used. */
function readNumber(words: string[], from: number): { value: number; used: number } | null {
  let i = from, value = 0, seen = false;
  const take = (): boolean => {
    const w = words[i]?.toLowerCase();
    if (w && w in TENS) { value += TENS[w]; i++; seen = true; const next = words[i]?.toLowerCase(); if (next && next in ONES && ONES[next] > 0 && ONES[next] < 10) { value += ONES[next]; i++; } return true; }
    if (w && w in ONES) { value += ONES[w]; i++; seen = true; return true; }
    return false;
  };
  if (!take()) return null;
  if (words[i]?.toLowerCase() === 'hundred') {
    value *= 100; i++;
    let j = i;
    if (words[j]?.toLowerCase() === 'and') j++;
    const w = words[j]?.toLowerCase();
    if (w && (w in TENS || (w in ONES && ONES[w] > 0))) { i = j; take(); }
  }
  return seen ? { value, used: i - from } : null;
}

/** Spoken number words become digits ("four" -> 4). The model usually writes digits already; this catches the rest. */
export function spokenNumbersToDigits(text: string): string {
  const words = text.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/gi, '$1 $2').split(/\s+/).filter(Boolean), out: string[] = [];
  for (let i = 0; i < words.length;) {
    const bare = words[i].replace(/[.,!?;:]+$/, '').toLowerCase();
    if (isNumberWord(bare) && bare !== 'hundred') {
      const stripped = words.slice(i).map(w => w.replace(/[.,!?;:]+$/, ''));
      const read = readNumber(stripped, 0);
      if (read) { const trailing = words[i + read.used - 1].match(/[.,!?;:]+$/)?.[0] || ''; out.push(String(read.value) + trailing); i += read.used; continue; }
    }
    out.push(words[i]); i++;
  }
  return out.join(' ');
}

const NON_SPEECH = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪[^♪]*♪?/g;
/** Removes what the model writes for silence and noise ("[BLANK_AUDIO]", "(music)"), fixes spacing, and the final full stop. */
export function cleanTranscript(raw: string): string {
  return raw.replace(NON_SPEECH, ' ').replace(/\s+/g, ' ').replace(/(\d)-(?=[A-Za-z])/g, '$1 ').replace(/\bhand over summary\b/gi, 'handover summary').replace(/\s+([.,!?;:])/g, '$1').replace(/[.\s]+$/g, '').trim();
}

export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase(), y = b.toLowerCase();
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    row = next;
  }
  return row[y.length];
}

// Everyday words that must never be "corrected" into a name.
const COMMON = new Set('the and for you your with that this from have are was were will can could would should please give store hold make mark set split prepare create add remove show tell what when where which who whom how all any each every one two three four five six seven eight nine ten report reports phone phones stock target targets today yesterday tomorrow week month day days time unavailable available leave summary hand over among everyone person people team group same them they then than there here more most some into onto also just only like want need going about after before again once auto every daily weekday weekdays monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december'.split(' '));

/**
 * Fixes a mis-heard person to the closest known name ("Nore" -> "Noor"). Whisper writes names with a capital letter, so only a capitalised word in the
 * MIDDLE of a sentence is considered: ordinary words ("many", "mark") and the first word of a sentence are never changed. Names under 4 letters are never produced.
 */
export function correctNames(text: string, names: string[]): string {
  const vocab = [...new Set(names.map(n => n.trim()).filter(n => /^[A-Za-z]{4,}$/.test(n)))];
  if (!vocab.length) return text;
  return text.replace(/[A-Za-z]{4,}/g, (token, offset: number) => {
    const lower = token.toLowerCase();
    if (!/^[A-Z]/.test(token) || COMMON.has(lower) || vocab.some(n => n.toLowerCase() === lower)) return token;
    if (offset === 0 || /(^|[.!?]\s+)$/.test(text.slice(0, offset))) return token; // the first word of a sentence: could be any verb
    let best = '', bestDistance = 99;
    for (const name of vocab) { const d = editDistance(token, name); if (d < bestDistance) { best = name; bestDistance = d; } }
    const sameStart = best && best[0].toLowerCase() === lower[0];
    return best && (bestDistance <= 1 || (sameStart && bestDistance <= 2)) ? best : token;
  });
}

/** "Fold 6" -> "Fold6": the product families the team sells (Fold, Flip, Note, Tab) always, plus any code the catalog knows. */
export function joinProductCodes(text: string, products: string[]): string {
  let out = text.replace(/\b(fold|flip)s\s+(\d{1,2})\b/gi, '$1 $2').replace(/\b(fold|flip|note|tab)\s+(\d{1,2})\b/gi, (_match, family: string, number: string) => family[0].toUpperCase() + family.slice(1).toLowerCase() + number);
  for (const code of products) {
    const match = code.match(/^([A-Za-z]+)(\d+)$/);
    if (match) out = out.replace(new RegExp(`\\b${match[1]}\\s+${match[2]}\\b`, 'gi'), code);
  }
  return out;
}

/** The whole clean-up, in order. `names` are the people in the app, `products` codes like "Fold6". */
export function normalizeTranscript(raw: string, names: string[] = [], products: string[] = []): string {
  return joinProductCodes(correctNames(spokenNumbersToDigits(cleanTranscript(raw)), names), products);
}
