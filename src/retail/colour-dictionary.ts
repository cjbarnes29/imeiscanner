/**
 * The colour names Samsung phones come in, with the short forms a WhatsApp report uses for them ("CRM" = Cream, "GRPH" = Graphite, "S.B" = Silver Blue).
 * It is only a fallback: what the person taught, and the colours of the model's own scanned phones, always come first. A short form that could mean two
 * colours is not listed at all (never a guess), so those are left for the person to answer once.
 */
export type DictColour = { name: string; abbr: string[] };

export const COLOUR_DICTIONARY: DictColour[] = [
  { name: 'Black', abbr: ['blk', 'bk', 'blck', 'black'] },
  { name: 'White', abbr: ['wht', 'wt', 'wh', 'white'] },
  { name: 'Silver', abbr: ['slv', 'sil', 'slvr', 'silver'] },
  { name: 'Gray', abbr: ['gry', 'grey', 'gray'] },
  { name: 'Graphite', abbr: ['grph', 'graph', 'graphite'] },
  { name: 'Charcoal', abbr: ['char', 'chrcl', 'chcl', 'charcoal'] },
  { name: 'Blue', abbr: ['blu', 'blue'] },
  { name: 'Navy', abbr: ['nvy', 'navy'] },
  { name: 'Icy Blue', abbr: ['iblu', 'icyblu', 'ibl', 'icy', 'icyblue'] },
  { name: 'Light Blue', abbr: ['lblu', 'lbl', 'lightblue'] },
  { name: 'Sky Blue', abbr: ['sky', 'skyblu', 'skyblue'] },
  { name: 'Silver Blue', abbr: ['sb', 'sblu', 'svrblu', 'slvblu', 'silverblue'] },
  { name: 'Green', abbr: ['grn', 'green'] },
  { name: 'Light Green', abbr: ['lgrn', 'lightgreen'] },
  { name: 'Mint', abbr: ['mnt', 'mint'] },
  { name: 'Lime', abbr: ['lme', 'lime'] },
  { name: 'Lavender', abbr: ['lvnd', 'lvd', 'lav', 'lavender'] },
  { name: 'Lilac', abbr: ['lilc', 'lilac', 'llc'] },
  { name: 'Violet', abbr: ['vlt', 'vio', 'vlet', 'violet'] },
  { name: 'Cosmic Violet', abbr: ['cvlt', 'cvio', 'cosmicvlt', 'cosmicviolet'] },
  { name: 'Purple', abbr: ['prp', 'purp', 'purple'] },
  { name: 'Pink', abbr: ['pnk', 'pink'] },
  { name: 'Light Pink', abbr: ['lpnk', 'lpink', 'lightpink'] },
  { name: 'Rose', abbr: ['rose', 'rse'] },
  { name: 'Cream', abbr: ['crm', 'cream'] },
  { name: 'Gold', abbr: ['gld', 'gold'] },
  { name: 'Yellow', abbr: ['ylw', 'yel', 'yellow'] },
  { name: 'Orange', abbr: ['org', 'orng', 'orange'] },
  { name: 'Red', abbr: ['red'] },
  { name: 'Coral', abbr: ['crl', 'coral'] },
  { name: 'Titanium', abbr: ['ti', 'tit', 'titan', 'titanium'] },
  { name: 'Titanium Black', abbr: ['tblk', 'tiblk', 'titblk', 'titaniumblack'] },
  { name: 'Titanium Gray', abbr: ['tgry', 'tigry', 'titaniumgray'] },
  { name: 'Titanium Silver', abbr: ['tslv', 'tislv', 'titaniumsilver'] },
  { name: 'Titanium Blue', abbr: ['tblu', 'titaniumblue'] },
  { name: 'Titanium Violet', abbr: ['tvlt', 'titaniumviolet'] },
  { name: 'Titanium Green', abbr: ['tgrn', 'titaniumgreen'] },
  { name: 'Titanium Yellow', abbr: ['tylw', 'titaniumyellow'] },
  { name: 'Phantom Black', abbr: ['pblk', 'phblk', 'phantomblack'] },
  { name: 'Jet Black', abbr: ['jblk', 'jet', 'jetblack'] },
  { name: 'Onyx Black', abbr: ['oblk', 'onyx', 'onyxblack'] },
  { name: 'Blue Black', abbr: ['bblk', 'blueblk', 'blueblack'] },
  { name: 'Mint Green', abbr: ['mgrn', 'mintgreen'] },
  { name: 'Ice Blue', abbr: ['iceblu', 'iceblue'] }
];

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const byAbbr = new Map<string, Set<string>>();
for (const c of COLOUR_DICTIONARY) for (const a of c.abbr) { const set = byAbbr.get(a) || new Set<string>(); set.add(c.name); byAbbr.set(a, set); }

/** The one colour a short form stands for, or null (not listed, or it could mean two). */
export function dictionaryExact(label: string): string | null {
  const names = byAbbr.get(letters(label));
  return names && names.size === 1 ? [...names][0] : null;
}
/** Every dictionary colour whose short form starts like the label or is started by it (a guess list for the person to tap, never applied by itself). */
export function dictionaryNear(label: string): string[] {
  const key = letters(label);
  if (!key) return [];
  const out = new Set<string>();
  for (const c of COLOUR_DICTIONARY) if (c.abbr.some(a => a.startsWith(key) || (key.length >= 3 && key.startsWith(a)))) out.add(c.name);
  return [...out];
}
