// The app learns two things on this phone only:
//  1. Verified corrections: when you change a model code in review (for example a misread SM-A1O5F to SM-A165F),
//     the same misread is fixed automatically next time.
//  2. Repeated model references: a code that is one character away from a code seen on at least two other
//     phones is almost certainly the same model misread.
export const LEARNED_KEY = 'imei-lens-learned-models-v1';
export type Learned = Record<string, { to: string; count: number }>;

const CODE = /\bS\s*M\s*-?\s*([A-Z][A-Z0-9]{3}[A-Z0-9]?)/i;
/** "SM-A165F" from any text containing a Samsung model code, or ''. */
export function modelCodeOf(text: string): string {
  const match = text.match(CODE);
  return match ? match[1].toUpperCase() : '';
}
const isBareCode = (model: string) => /^\s*SM\s*-?\s*[A-Z][A-Z0-9]{3}[A-Z0-9]?\s*$/i.test(model);

export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return row[b.length];
}

/** Record a correction (from the old model text to the new one). Only code-to-code corrections are learned. */
export function learnCorrection(learned: Learned, oldModel: string, newModel: string): Learned {
  const from = modelCodeOf(oldModel), to = modelCodeOf(newModel);
  if (!from || !to || from === to || distance(from, to) > 2) return learned;
  const known = learned[from];
  return { ...learned, [from]: { to, count: known && known.to === to ? known.count + 1 : 1 } };
}

/**
 * Fix a read model: first by a learned correction, then by what the other phones in the list say.
 * Only a bare code ("SM-A1O5F") is touched; a model already named from the Samsung catalog is left alone.
 */
export function refineModel(model: string, otherModels: string[], learned: Learned): { model: string; source: 'read' | 'learned' | 'consensus' } {
  if (!isBareCode(model)) return { model, source: 'read' };
  const code = modelCodeOf(model);
  const fix = learned[code];
  if (fix) return { model: `SM-${fix.to}`, source: 'learned' };
  const counts = new Map<string, number>();
  for (const other of otherModels) { const c = modelCodeOf(other); if (c) counts.set(c, (counts.get(c) || 0) + 1); }
  if ((counts.get(code) || 0) >= 2) return { model, source: 'read' };
  const near = [...counts.entries()].filter(([c, n]) => n >= 2 && c.length === code.length && distance(c, code) === 1).sort((a, b) => b[1] - a[1]);
  if (near.length === 1 || (near.length > 1 && near[0][1] > near[1][1])) return { model: `SM-${near[0][0]}`, source: 'consensus' };
  return { model, source: 'read' };
}

export function readLearned(): Learned {
  try { return JSON.parse(localStorage.getItem(LEARNED_KEY) || '{}') as Learned; } catch { return {}; }
}
export function writeLearned(learned: Learned) {
  try { localStorage.setItem(LEARNED_KEY, JSON.stringify(learned)); } catch { /* learning is a convenience */ }
}
