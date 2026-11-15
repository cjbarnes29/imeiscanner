/**
 * The editable catalog and segment classification. The built-in Samsung list (samsung-models.ts) supplies every model code and name; the person's
 * edits (name, abbreviation, SKU / RAM / storage / colours, segment, monthly segments) are stored on top and always win. A segment the person
 * changes is remembered ("verified correction"), so the same model is classified that way next time and in the other records.
 */
import { SAMSUNG_MODELS } from '../samsung-models';
import { modelCode4, phoneInfo } from '../phone-names';
import { monthOf, type CatalogItem, type Month, type RecordMeta, type RetailState, type Segment, type Variant } from './types';
import { isSegment } from './types';

/** The segment a model name suggests, before anyone corrects it. Samsung numbering: A3x/A5x/A7x are mid, A0x-A2x (and M0x-M2x) are low. */
export function guessSegment(name: string, code = ''): Segment {
  const n = name || '';
  if (/watch|buds|ring|fit\b|galaxy\s+xr/i.test(n) || /^[LR]\d/.test(code)) return 'wearable';
  if (/\btab\b/i.test(n) || /^[XT]\d/.test(code)) return 'tablet';
  if (/z\s*flip.*fe|flip\s*\d+\s*fe/i.test(n)) return 'flagship3';
  if (/z\s*fold|ultra/i.test(n) && /galaxy\s+(s\d|z)/i.test(n)) return 'flagship1';
  if (/z\s*flip/i.test(n)) return 'flagship2';
  if (/galaxy\s+s\d+\s*fe\b/i.test(n)) return 'flagship3';
  if (/galaxy\s+s\d+/i.test(n)) return 'flagship2';
  const series = n.match(/galaxy\s+([AM])(\d{2})\b/i) || (code ? code.match(/^([AM])(\d{2})/) : null);
  if (series) return Number(series[2]) >= 30 ? 'mid' : 'low';
  return 'other';
}

/** "Galaxy A17 5G" -> "A17 5G" (the short name reports use). */
export const defaultAbbreviation = (name: string) => name.replace(/^Samsung\s+/i, '').replace(/^Galaxy\s+/i, '').trim();

/** Every model the app knows: the built-in list with the person's edits on top, plus models they added. Sorted by name. */
export function fullCatalog(state: Pick<RetailState, 'catalog'>): CatalogItem[] {
  const edits = new Map(state.catalog.map(item => [item.code, item]));
  const list: CatalogItem[] = Object.entries(SAMSUNG_MODELS).map(([code, name]) => edits.get(code) || builtIn(code, name));
  for (const item of state.catalog) if (!(item.code in SAMSUNG_MODELS)) list.push(item);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function builtIn(code: string, name: string): CatalogItem {
  return { code, name, abbreviation: defaultAbbreviation(name), segment: guessSegment(name, code), monthly: {}, variants: [], custom: false };
}

/** The catalog item for a model text (SM-A176B/DS, "Galaxy A17 5G", a code): the person's edit, the built-in one, or one made from the text. */
export function itemFor(state: Pick<RetailState, 'catalog'>, model: string): CatalogItem | undefined {
  const code = modelCode4(model) || (/^[A-Z]\d{3}$/i.test(model.trim()) ? model.trim().toUpperCase() : '');
  if (code) {
    const edited = state.catalog.find(item => item.code === code);
    if (edited) return edited;
    const name = SAMSUNG_MODELS[code];
    if (name) return builtIn(code, name);
    const info = phoneInfo(model);
    return info.series === 'Unknown phones' ? undefined : builtIn(code, info.name);
  }
  const wanted = model.trim().toLowerCase();
  if (!wanted) return undefined;
  return state.catalog.find(item => item.name.toLowerCase() === wanted || item.abbreviation.toLowerCase() === wanted);
}

/** The segment of a model in a month: this record's own choice, the model's monthly segment, a remembered correction, the catalog default, then the guess. */
export function segmentOf(state: Pick<RetailState, 'catalog' | 'corrections'>, model: string, month: Month, meta?: RecordMeta): Segment {
  if (meta?.segment && isSegment(meta.segment)) return meta.segment;
  const item = itemFor(state, model);
  const code = item?.code || modelCode4(model);
  if (item?.monthly[month]) return item.monthly[month];
  if (code && state.corrections[code]) return state.corrections[code];
  if (item) return item.segment;
  return guessSegment(phoneInfo(model).name, code);
}

/** Saves (or replaces) a catalog edit. Returns a new state; the built-in list is never modified. */
export function saveItem<S extends Pick<RetailState, 'catalog'>>(state: S, item: CatalogItem): S {
  const clean: CatalogItem = {
    ...item, code: item.code.trim().toUpperCase(), name: item.name.trim() || item.code, abbreviation: item.abbreviation.trim() || defaultAbbreviation(item.name),
    custom: true, variants: item.variants.map(normaliseVariant).filter(v => v.sku || v.storage || v.ram || v.colors.length)
  };
  return { ...state, catalog: [...state.catalog.filter(old => old.code !== clean.code), clean] };
}
const normaliseVariant = (v: Variant): Variant => ({ sku: v.sku.trim(), ram: v.ram.trim(), storage: v.storage.trim(), colors: [...new Set(v.colors.map(c => c.trim()).filter(Boolean))] });

/** Removes the person's edit of a model (a built-in model returns to its original values; a model they added is deleted). */
export function resetItem<S extends Pick<RetailState, 'catalog'>>(state: S, code: string): S {
  return { ...state, catalog: state.catalog.filter(item => item.code !== code) };
}

/**
 * A person set the segment of a model (for one month, or from now on): the model keeps it and the app remembers the correction.
 * "month" given: only that month changes (Samsung moved the model for that month); otherwise the default changes.
 */
export function setModelSegment<S extends Pick<RetailState, 'catalog' | 'corrections'>>(state: S, model: string, segment: Segment, month?: Month): S {
  const item = itemFor(state, model);
  if (!item) return state;
  const next: CatalogItem = month ? { ...item, monthly: { ...item.monthly, [month]: segment } } : { ...item, segment };
  const saved = saveItem(state, { ...next, custom: item.custom });
  return month ? saved : { ...saved, corrections: { ...saved.corrections, [item.code]: segment } };
}

/** Storage / RAM / colour read from the label text of a scan (e.g. "6GB | 128GB"), when it is there. Never invents anything. */
export function inferVariant(raw: string): RecordMeta {
  const meta: RecordMeta = {};
  const memory = raw.match(/(\d{1,2})\s*GB\s*[|/\\\-+]\s*(\d{2,4})\s*(GB|TB)\b/i);
  if (memory) { meta.ram = `${memory[1]}GB`; meta.storage = `${memory[2]}${memory[3].toUpperCase()}`; }
  else {
    const storage = raw.match(/\b(\d{2,4})\s*(GB|TB)\b/i);
    if (storage) meta.storage = `${storage[1]}${storage[2].toUpperCase()}`;
  }
  const color = raw.match(/colou?r\s*[:\-]\s*([A-Za-z][A-Za-z ]{2,24})/i);
  if (color) meta.color = color[1].trim().replace(/\s+/g, ' ');
  return meta;
}

/** Bulk-sets fields on records' meta (an empty value clears it). */
export function setRecordMeta<S extends Pick<RetailState, 'recordMeta'>>(state: S, ids: string[], patch: RecordMeta): S {
  const next = { ...state.recordMeta };
  for (const id of ids) {
    const merged: RecordMeta = { ...next[id], ...patch };
    for (const key of Object.keys(merged) as (keyof RecordMeta)[]) if (!merged[key]) delete merged[key];
    if (Object.keys(merged).length) next[id] = merged; else delete next[id];
  }
  return { ...state, recordMeta: next };
}

export const currentMonth = (date: Date = new Date()) => monthOf(date);
