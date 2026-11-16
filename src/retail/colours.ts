/**
 * Colours of each model. A model's colours come from three places, all kept apart from the scan records: what the person typed for the model (names and
 * the abbreviations their report uses: "CRM" = Cream), what the model's catalog variants list, and the colours read from the labels of scanned phones.
 * A report abbreviation is resolved by what the person taught first, then by a fit rule against those names; two equally good fits are never guessed.
 */
import { itemFor } from './catalog';
import type { ModelColours, RetailState } from './types';

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** One spelling for one colour: "grey" and "Gray" are the same, words start with a capital ("icy blue" -> "Icy Blue"). */
export function canonColour(name: string): string {
  const t = (name || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').replace(/\bGrey\b/g, 'Gray');
}

const subsequence = (a: string, b: string) => { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; };
/** How well a report colour abbreviation ("Vlt", "C.VLT", "L.Pink") fits a colour name ("Violet", "Cosmic Violet", "Light Pink"). 0 = no fit. */
export function colourScore(label: string, name: string): number {
  const a = letters(label), b = letters(name);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.startsWith(a)) return 80;
  if (a[0] === b[0] && subsequence(a, b)) return 40 + a.length;
  return 0;
}
/** The best colour name for an abbreviation, or null when none fits or two fit equally well (never a guess between two). */
export function bestColour(label: string, names: string[]): string | null {
  let best: string | null = null, top = 0, tie = false;
  for (const name of new Set(names)) {
    const score = colourScore(label, name);
    if (score > top) { top = score; best = name; tie = false; } else if (score === top && score > 0) tie = true;
  }
  return tie ? null : best;
}

const entry = (state: Pick<RetailState, 'colours'>, code: string): ModelColours => state.colours?.[code] || { names: [], aliases: {} };

/** Every colour known for a model: what the person typed, what the catalog variants list, and `seen` (colours read from scanned phones). Sorted, one spelling. */
export function modelColourNames(state: Pick<RetailState, 'colours' | 'catalog'>, code: string, seen: string[] = []): string[] {
  const fromCatalog = (itemFor(state, code)?.variants || []).flatMap(v => v.colors);
  const all = [...entry(state, code).names, ...fromCatalog, ...seen].map(canonColour).filter(Boolean);
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}

/** What a report abbreviation means for this model: what the person taught, else the best fit among `names`, else null. */
export function resolveColour(state: Pick<RetailState, 'colours'>, code: string, label: string, names: string[]): string | null {
  const taught = entry(state, code).aliases[letters(label)];
  if (taught) return taught;
  return bestColour(label, names);
}

/** Adds colours to a model (names only). */
export function addColours<S extends Pick<RetailState, 'colours'>>(state: S, code: string, names: string[]): S {
  const cur = entry(state, code);
  const merged = [...new Set([...cur.names, ...names.map(canonColour).filter(Boolean)])];
  return { ...state, colours: { ...state.colours, [code]: { ...cur, names: merged } } };
}

/** The person said what a report abbreviation means for this model: remembered (and the colour is added to the model). */
export function teachColour<S extends Pick<RetailState, 'colours'>>(state: S, code: string, label: string, name: string): S {
  const key = letters(label), colour = canonColour(name);
  if (!key || !colour || !code) return state;
  const cur = entry(state, code);
  return { ...state, colours: { ...state.colours, [code]: { names: [...new Set([...cur.names, colour])], aliases: { ...cur.aliases, [key]: colour } } } };
}

/** "Cream = CRM, CREAM" per line -> the model's names and abbreviations (replaces what was typed before; the catalog variants and scans are untouched). */
export function parseColoursText(text: string): ModelColours {
  const names: string[] = [], aliases: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const [left, right = ''] = raw.split('=');
    const name = canonColour(left);
    if (!name) continue;
    names.push(name);
    for (const a of right.split(',')) { const key = letters(a); if (key) aliases[key] = name; }
  }
  return { names: [...new Set(names)], aliases };
}
/** The text form of a model's typed colours, for the edit box. */
export function coloursText(state: Pick<RetailState, 'colours'>, code: string): string {
  const cur = entry(state, code);
  return cur.names.map(n => { const abbr = Object.entries(cur.aliases).filter(([, v]) => v === n).map(([k]) => k.toUpperCase()); return abbr.length ? `${n} = ${abbr.join(', ')}` : n; }).join('\n');
}
/** Saves the typed colours of a model (empty = removes the entry). */
export function setModelColours<S extends Pick<RetailState, 'colours'>>(state: S, code: string, value: ModelColours): S {
  const next = { ...(state.colours || {}) };
  if (!value.names.length && !Object.keys(value.aliases).length) delete next[code]; else next[code] = value;
  return { ...state, colours: Object.keys(next).length ? next : undefined };
}
