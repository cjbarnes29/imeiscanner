// Friendly phone names for the simple list: "Galaxy S25 Ultra" under "S25 series" instead
// of a model code like SM-S938B. The Samsung catalog is used first; codes it does not list
// are decoded with Samsung's numbering rules.
import { SAMSUNG_MODELS } from './samsung-models';
export type CatalogEntry = { name: string; modelCode: string };
export type PhoneInfo = { name: string; series: string };

const S_GENERATION: Record<string, string> = { '90': 'S22', '91': 'S23', '92': 'S24', '93': 'S25', '94': 'S26' };
const S_FAN_EDITION: Record<string, string> = { '71': 'S23 FE', '72': 'S24 FE', '73': 'S25 FE', '74': 'S26 FE' };
const FOLDS: Record<string, string> = { F946: 'Z Fold5', F956: 'Z Fold6', F966: 'Z Fold7', F971: 'Z Fold8', F976: 'Z Fold8', F978: 'Z Fold8 Ultra' };
const FLIPS: Record<string, string> = { F731: 'Z Flip5', F741: 'Z Flip6', F761: 'Z Flip7 FE', F766: 'Z Flip7', F776: 'Z Flip8' };

/** "Galaxy S26 Ultra 512GB (Unlocked)" -> "Galaxy S26 Ultra". */
export function cleanPhoneName(name: string): string {
  return name.replace(/^Samsung\s+/i, '').replace(/Certified Re-?Newed/gi, '').replace(/\(.*?\)/g, '').replace(/\b\d+\s?(?:GB|TB)\b.*$/i, '').replace(/[|,–-]\s*$/g, '').replace(/\s+/g, ' ').trim();
}

/** The series a phone name belongs to: "Galaxy S25 Ultra" -> "S25 series", folds -> "Fold series". */
export function seriesOfName(name: string): string {
  const n = name.trim();
  let m: RegExpMatchArray | null;
  if (/Z\s*Fold/i.test(n)) return 'Fold series';
  if (/Z\s*Flip/i.test(n)) return 'Flip series';
  if ((m = n.match(/Galaxy\s+S(\d{2})\b/i))) return `S${m[1]} series`;
  if ((m = n.match(/Galaxy\s+A(\d{2})\b/i))) return `A${m[1]} series`;
  if ((m = n.match(/Galaxy\s+M(\d{2})\b/i))) return `M${m[1]} series`;
  if (/Galaxy\s+(?:Tab|XR)/i.test(n)) return /XR/i.test(n) ? 'XR series' : 'Tab series';
  if (/Watch/i.test(n)) return 'Watch series';
  if (/Buds/i.test(n)) return 'Buds series';
  if ((m = n.match(/iPhone\s+(\d{1,2})/i))) return `iPhone ${m[1]} series`;
  if ((m = n.match(/Pixel\s+(\d{1,2})/i))) return `Pixel ${m[1]} series`;
  return 'Other phones';
}

/** Name from the model code alone (Samsung numbering rules). Empty when the code is not understood. */
function nameFromCode(code4: string): string {
  const letter = code4[0], digits = code4.slice(1);
  const key = digits.slice(0, 2), last = digits[2];
  if (letter === 'S') {
    if (S_FAN_EDITION[key]) return `Galaxy ${S_FAN_EDITION[key]}`;
    if (S_GENERATION[key]) return `Galaxy ${S_GENERATION[key]}${last === '8' ? ' Ultra' : last === '6' || last === '7' ? '+' : ''}`;
  }
  if (letter === 'F' && FOLDS[code4]) return `Galaxy ${FOLDS[code4]}`;
  if (letter === 'F' && FLIPS[code4]) return `Galaxy ${FLIPS[code4]}`;
  if (letter === 'F' && key === '97') return 'Galaxy Z Fold';
  if (letter === 'F' && (key === '73' || key === '74' || key === '76' || key === '77')) return 'Galaxy Z Flip';
  if (letter === 'F' && (key === '94' || key === '95' || key === '96')) return 'Galaxy Z Fold';
  if (letter === 'A' || letter === 'M') return `Galaxy ${letter}${key}`;
  if (letter === 'X') return 'Galaxy Tab';
  if (letter === 'L') return 'Galaxy Watch';
  if (letter === 'R') return 'Galaxy Buds';
  return '';
}

/** Model code like SM-S938B/DS -> "S938" (the part shared by all regions and colours). */
export function modelCode4(text: string): string {
  return (text.toUpperCase().match(/\bSM\s*-?\s*([A-Z]\d{3})/)?.[1]) || '';
}

export function phoneInfo(model: string, catalog: CatalogEntry[] = []): PhoneInfo {
  const text = (model || '').trim();
  const code = modelCode4(text);
  if (code) {
    const listed = SAMSUNG_MODELS[code];
    const entry = listed ? undefined : catalog.find(item => item.modelCode.toUpperCase().replace(/^SM-?/, '').startsWith(code));
    const name = listed || (entry ? cleanPhoneName(entry.name) : nameFromCode(code));
    if (name) return { name, series: seriesOfName(name) };
    return { name: `Galaxy ${code}`, series: 'Other phones' };
  }
  if (!text || /^unknown\b/i.test(text) || /^series\s*[—-]\s*review$/i.test(text)) return { name: 'Unknown phone', series: 'Unknown phones' };
  const name = cleanPhoneName(text);
  return { name, series: seriesOfName(name) };
}
