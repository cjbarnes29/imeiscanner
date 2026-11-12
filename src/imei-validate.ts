// IMEI validation, repair and voting. Pure functions, no DOM.
// Several reads of the same label (different image treatments, a barcode) are combined here:
// a checksum-valid number that more than one read agrees on wins, a near miss is repaired by the
// checksum only when it is safe, and anything uncertain is handed back for a manual look.

export type RepairKind = 'swap' | 'insert';
export type Repair = { value: string; kind: RepairKind; index: number; from: string; to: string; tacKnown: boolean };
export type Judgement = {
  imei: string;
  /** 0-100 */
  confidence: number;
  method: 'barcode' | 'checksum' | 'vote' | 'repair' | 'none';
  /** Other numbers worth showing as "did you mean". Never includes `imei`. */
  alternatives: string[];
  needsReview: boolean;
  reason: string;
  /** The OCR reading a repair started from. */
  repairedFrom?: string;
};

/** The Luhn checksum every IMEI must satisfy. */
export function luhnValid(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = Number(value[14 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

/** The check digit that completes a 14-digit body. */
export function luhnCheckDigit(body14: string): string {
  for (let d = 0; d <= 9; d++) if (luhnValid(body14 + d)) return String(d);
  return '0';
}

/** Digits that printed numerals and OCR confuse most often (blur, small print, glare). Each digit lists what it may really be. */
export const CONFUSIONS: Record<string, string[]> = {
  '0': ['8', '6', '9'], '1': ['7'], '2': ['7'], '3': ['8', '5'], '4': ['9'],
  '5': ['6', '3', '8'], '6': ['5', '8', '0'], '7': ['1', '2'], '8': ['0', '3', '6', '9', '5'], '9': ['4', '8', '0']
};

/** Letters OCR returns for digits inside a number. */
const LOOKALIKE: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', '!': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', G: '6', b: '6', T: '7', B: '8', g: '9', q: '9' };

/** A string of digits and lookalike letters turned into digits only. */
export const normalizeDigits = (text: string) => text.replace(/[\s-]/g, '').replace(/[A-Za-z|!]/g, ch => LOOKALIKE[ch] ?? '').replace(/\D/g, '');

/**
 * Every number a label's text claims as IMEI 1 (or a bare "IMEI:"), 14-16 digits, with lookalike
 * letters turned into digits. IMEI 2 lines are skipped. Order of appearance, no repeats.
 */
export function imeiReadings(text: string): string[] {
  const found: string[] = [];
  const pattern = /\bIM[E3][I1!|l]\s*(0?[12])?\s*[:#;.-]?\s*((?:(?:[0-9]|[OoDQIl|!SsZzGbTBgq](?![A-Za-z]))[ \t-]?){13,17})/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[1] && /2$/.test(match[1])) continue;
    const value = normalizeDigits(match[2]);
    if (value.length >= 14 && value.length <= 16 && !found.includes(value)) found.push(value);
  }
  return found;
}

/**
 * Per-position majority over reads of the same number. Needs at least two 15-digit reads;
 * a position with no clear winner (tie) keeps the first read's digit.
 */
export function voteDigits(readings: string[]): { value: string; agreement: number } {
  const same = readings.filter(r => /^\d{15}$/.test(r));
  if (same.length < 2) return { value: same[0] || '', agreement: same.length ? 1 : 0 };
  let value = '', agree = 0;
  for (let i = 0; i < 15; i++) {
    const counts = new Map<string, number>();
    for (const r of same) counts.set(r[i], (counts.get(r[i]) || 0) + 1);
    let best = same[0][i], top = 0;
    for (const [digit, count] of counts) if (count > top || (count === top && digit === same[0][i])) { best = digit; top = count; }
    value += best; agree += top / same.length;
  }
  return { value, agreement: agree / 15 };
}

/** The first 8 digits (type allocation code) identify the phone model. */
export const tacOf = (imei: string) => imei.slice(0, 8);

/**
 * Checksum-valid numbers one confusable digit away from a reading (or, for a 14-digit reading, with one
 * digit missing). A repair that changes the model code is only offered when it lands on a known code.
 */
export function repairCandidates(reading: string, knownTacs: ReadonlySet<string> = new Set()): Repair[] {
  const out: Repair[] = [];
  const readTacKnown = reading.length >= 8 && knownTacs.has(tacOf(reading));
  if (/^\d{15}$/.test(reading)) {
    if (luhnValid(reading)) return out;
    for (let i = 0; i < 15; i++) {
      for (const to of CONFUSIONS[reading[i]] || []) {
        const value = reading.slice(0, i) + to + reading.slice(i + 1);
        if (!luhnValid(value)) continue;
        const tacKnown = knownTacs.has(tacOf(value));
        // The model code read as a known one: do not "repair" it into another model.
        if (i < 8 && readTacKnown && !tacKnown) continue;
        out.push({ value, kind: 'swap', index: i, from: reading[i], to, tacKnown });
      }
    }
  } else if (/^\d{14}$/.test(reading) && knownTacs.size) {
    // A dropped digit is only filled in when the result lands on a known model code: otherwise a tenth of all guesses pass.
    for (let i = 0; i <= 14; i++) {
      for (let d = 0; d <= 9; d++) {
        const value = reading.slice(0, i) + d + reading.slice(i);
        if (luhnValid(value) && knownTacs.has(tacOf(value))) out.push({ value, kind: 'insert', index: i, from: '', to: String(d), tacKnown: true });
      }
    }
  }
  return out;
}

type JudgeInput = {
  /** IMEI 1 readings from every pass (any length; use `imeiReadings` on the OCR text). */
  readings: string[];
  /** Number decoded from the label's barcode, when the barcode is known to be IMEI 1. */
  barcode?: string;
  knownTacs?: ReadonlySet<string>;
};

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Decide the IMEI 1 of one label from all its readings, with a confidence and whether a person should look. */
export function judgeImei({ readings, barcode = '', knownTacs = new Set() }: JudgeInput): Judgement {
  const counts = new Map<string, number>();
  for (const r of readings) counts.set(r, (counts.get(r) || 0) + 1);
  const valid = [...counts.entries()].filter(([value]) => luhnValid(value)).sort((a, b) => b[1] - a[1]);
  const othersOf = (chosen: string) => [...new Set([...valid.map(([v]) => v), ...[...counts.keys()].filter(luhnValid)])].filter(v => v !== chosen);

  if (luhnValid(barcode)) {
    const agreeing = counts.get(barcode) || 0;
    return { imei: barcode, confidence: clampScore(96 + Math.min(agreeing, 2)), method: 'barcode', alternatives: othersOf(barcode), needsReview: false, reason: 'Barcode confirmed' };
  }

  if (valid.length === 1) {
    const [value, votes] = valid[0];
    const tac = knownTacs.has(tacOf(value));
    return { imei: value, confidence: clampScore(78 + Math.min(votes - 1, 3) * 5 + (tac ? 4 : 0)), method: 'checksum', alternatives: [], needsReview: false, reason: votes > 1 ? `${votes} reads agree, checksum valid` : 'Checksum valid' };
  }
  if (valid.length > 1) {
    const [first, second] = valid;
    if (first[1] > second[1] && first[1] >= 2) {
      return { imei: first[0], confidence: clampScore(70 + Math.min(first[1], 4) * 3), method: 'vote', alternatives: othersOf(first[0]), needsReview: false, reason: `${first[1]} of ${readings.length} reads agree` };
    }
    // Several different valid numbers and no clear winner: two products' numbers got mixed, or the read is unstable.
    const known = valid.filter(([v]) => knownTacs.has(tacOf(v)));
    return { imei: '', confidence: 25, method: 'none', alternatives: valid.map(([v]) => v), needsReview: true, reason: known.length === 1 ? 'Several valid numbers, only one has a known model' : 'Several different valid numbers were read' };
  }

  // Nothing passes the checksum: vote digit by digit, then try the safe repairs.
  const fifteen = [...counts.keys()].filter(r => r.length === 15);
  const voted = voteDigits(readings.filter(r => r.length === 15));
  if (voted.value && luhnValid(voted.value)) {
    return { imei: voted.value, confidence: clampScore(60 + voted.agreement * 15), method: 'vote', alternatives: [], needsReview: false, reason: 'Combined from several reads, checksum valid', repairedFrom: fifteen[0] };
  }
  const pool = new Map<string, Repair & { from15: string }>();
  for (const r of [...new Set([voted.value, ...[...counts.keys()]].filter(Boolean))]) {
    for (const repair of repairCandidates(r, knownTacs)) if (!pool.has(repair.value)) pool.set(repair.value, { ...repair, from15: r });
  }
  const repairs = [...pool.values()];
  const knownRepairs = repairs.filter(r => r.tacKnown);
  // Safe: exactly one repair lands on a known model code. It is accepted but still flagged for a quick look.
  const safe = knownRepairs.length === 1 ? knownRepairs[0] : null;
  if (safe) {
    return { imei: safe.value, confidence: 58, method: 'repair', alternatives: repairs.filter(r => r.value !== safe.value).map(r => r.value), needsReview: true, reason: `One digit fixed by the checksum (${safe.from || '·'}→${safe.to})`, repairedFrom: safe.from15 };
  }
  if (repairs.length) {
    return { imei: '', confidence: 20, method: 'none', alternatives: repairs.slice(0, 4).map(r => r.value), needsReview: true, reason: repairs.length === 1 ? 'Checksum failed; one possible fix' : `Checksum failed; ${repairs.length} possible fixes` };
  }
  return { imei: '', confidence: fifteen.length ? 10 : 0, method: 'none', alternatives: [], needsReview: true, reason: fifteen.length ? 'Checksum failed and no safe fix' : 'No IMEI 1 read' };
}

/** True when the same number was read for two labels in one photo: one box is probably on the wrong label. */
export function repeatedAcrossBoxes(imeis: string[]): Set<number> {
  const out = new Set<number>();
  imeis.forEach((imei, i) => { if (imei && imeis.some((other, j) => j !== i && other === imei)) out.add(i); });
  return out;
}

/**
 * An IMEI 2 is kept only when it can belong to this IMEI 1: it must pass the checksum and, on Samsung labels, share the six serial
 * digits (positions 9-14) with IMEI 1. A number that fails either was misread or comes from the neighbouring product.
 */
export function pairedImei2(imei1: string, imei2: string, model: string): string {
  if (!imei2) return '';
  if (!luhnValid(imei2)) return '';
  if (imei1 && /^SM-/i.test(model.trim()) && imei1.slice(8, 14) !== imei2.slice(8, 14)) return '';
  return imei2;
}


