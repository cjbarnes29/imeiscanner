/**
 * The pasted report checked against the phones the person scanned. The scanned phones are the evidence (an IMEI gives the exact model; the label
 * gives storage, RAM and colour): each report line is matched to a model, its stock and colour counts are compared with the scanned phones that are
 * still in stock, and every difference is described in words. Nothing is changed here: this only reads and says what it found. The person decides.
 *
 * What counts as "scanned and in stock": a valid IMEI, not a duplicate, not sold in the sales list, and not marked sold or given by the person.
 */
import { fullCatalog, itemFor } from './catalog';
import { canonColour, modelColourNames, resolveColour } from './colours';
import { inStock, variantOf, type StockSource } from './inventory';
import { listedSold, partsSum, hasUnreadable, reportItems } from './stockreport';
import type { CatalogItem, ReportItem, RetailState, StockReport } from './types';

export type IssueKind = 'unknown-model' | 'unreadable' | 'colours-sum' | 'stock-differs' | 'colour-differs' | 'colour-unmatched' | 'scanned-colour-missing' | 'not-scanned' | 'parts-mismatch';
export type Issue = { kind: IssueKind; text: string };
/** 'empty' = no stock in the report and none scanned: nothing to compare, so it is not counted as agreeing. 'checked' = it still differs, but the person looked at it and saved it. */
export type Status = 'agree' | 'differ' | 'unknown' | 'info' | 'empty' | 'checked';
export type ScannedColour = { name: string; count: number };
export type LineResult = {
  id: string; status: Status; code?: string; matchedName?: string; issues: Issue[];
  scanned: { total: number; colours: ScannedColour[]; noStorage: number };
  /** For each colour (or storage) of the report line: the scanned colour it was matched to (null = no match). */
  partMatch: (string | null)[];
};
export type Reconciliation = {
  lines: LineResult[];
  summary: { agree: number; differ: number; unknown: number; empty: number; checked: number; notScanned: number; scannedPhones: number; reportStock: number; listedSold: number; totalTyped?: number; totalDiff?: number };
};

const plus = (s: string) => s.replace(/\+/g, 'plus');
/** "Galaxy A17 5G" / "A17 5G" -> "a175g": the form names are compared in (case, spaces and punctuation ignored; "+" kept as "plus"). */
export const nameKey = (s: string) => plus(s).toLowerCase().replace(/samsung|galaxy/g, '').replace(/[^a-z0-9]+/g, '');
const unit = (v: string) => v.replace(/\s+/g, '').toUpperCase();

/** The model words, and the RAM / storage a report name carries ("A57 5G 8/256GB" -> key "a575g", RAM 8GB, storage 256GB). */
export function splitName(name: string): { key: string; ram: string; storage: string } {
  let text = name.replace(/samsung|galaxy/gi, ' ');
  let ram = '', storage = '';
  const both = /(\d{1,2})\s*\/\s*(\d{2,4})\s*(gb|tb)?/i.exec(text);
  if (both) { ram = `${both[1]}GB`; storage = `${both[2]}${(both[3] || 'GB').toUpperCase()}`; text = text.replace(both[0], ' '); }
  else {
    const only = /(\d{1,4})\s*(gb|tb)\b/i.exec(text);
    if (only) { storage = `${only[1]}${only[2].toUpperCase()}`; text = text.replace(only[0], ' '); }
  }
  return { key: nameKey(text), ram, storage };
}

/** Index of catalog names by key, built once per check. */
export function catalogIndex(state: RetailState): Map<string, CatalogItem> {
  const index = new Map<string, CatalogItem>();
  for (const item of fullCatalog(state)) for (const text of [item.abbreviation, item.name]) { const key = nameKey(text); if (key && !index.has(key)) index.set(key, item); }
  return index;
}

/** The model a report name means: what the person taught the app first, then the catalog by name, abbreviation ("S26U" = S26 Ultra) or code. */
export function matchModel(state: RetailState, index: Map<string, CatalogItem>, name: string): CatalogItem | undefined {
  const { key } = splitName(name);
  if (!key) return undefined;
  const taught = state.aliases[key];
  if (taught) { const item = itemFor(state, taught); if (item) return item; }
  const direct = index.get(key);
  if (direct) return direct;
  const ultra = key.replace(/^(s\d+)u$/, '$1ultra');
  if (ultra !== key && index.get(ultra)) return index.get(ultra);
  // reports write "A17 4G" where the catalog just says "Galaxy A17"
  const no4g = key.replace(/4g$/, '');
  if (no4g !== key && index.get(no4g)) return index.get(no4g);
  if (/^[a-z]\d{3}$/.test(key)) return itemFor(state, key.toUpperCase());
  return undefined;
}

/** Remembers what the person said this report name means (so the next report needs no question). */
export function teachAlias(state: RetailState, reportName: string, code: string): RetailState {
  const key = splitName(reportName).key;
  if (!key || !code) return state;
  return { ...state, aliases: { ...state.aliases, [key]: code } };
}

// ---- colours: the rules are in colours.ts (re-exported here) ---------------------------------------------------------------------------
export { bestColour, colourScore } from './colours';

// ---- the check ---------------------------------------------------------------------------------------------------------------------------

type Scan = { source: StockSource; code: string; storage: string; ram: string; colour: string };

function scannedIndex(state: RetailState, records: StockSource[]): { byCode: Map<string, Scan[]>; total: number } {
  const byCode = new Map<string, Scan[]>();
  let total = 0;
  for (const source of inStock(state, records)) {
    const item = itemFor(state, source.model);
    if (!item) continue;
    const v = variantOf(state, source);
    const scan: Scan = { source, code: item.code, storage: unit(v.storage), ram: unit(v.ram), colour: canonColour(v.color) };
    byCode.set(item.code, [...(byCode.get(item.code) || []), scan]);
    total++;
  }
  return { byCode, total };
}

const tally = (scans: Scan[]): ScannedColour[] => {
  const map = new Map<string, number>();
  for (const s of scans) { const name = s.colour || 'No colour'; map.set(name, (map.get(name) || 0) + 1); }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export function reconcile(state: RetailState, report: StockReport, records: StockSource[]): Reconciliation {
  const index = catalogIndex(state);
  const { byCode, total: scannedPhones } = scannedIndex(state, records);
  const lines: LineResult[] = [];
  let reportStock = 0, notScanned = 0;
  for (const item of reportItems(report)) {
    reportStock += item.stock;
    lines.push(checkLine(state, index, byCode, item));
  }
  for (const l of lines) if (l.issues.some(i => i.kind === 'not-scanned')) notScanned++;
  const listed = listedSold(report), typed = report.totalSellout?.typed;
  return {
    lines,
    summary: {
      agree: lines.filter(l => l.status === 'agree').length, differ: lines.filter(l => l.status === 'differ').length, unknown: lines.filter(l => l.status === 'unknown').length, empty: lines.filter(l => l.status === 'empty').length, checked: lines.filter(l => l.status === 'checked').length,
      notScanned, scannedPhones, reportStock, listedSold: listed, totalTyped: typed, totalDiff: typed === undefined ? undefined : typed - listed
    }
  };
}

function checkLine(state: RetailState, index: Map<string, CatalogItem>, byCode: Map<string, Scan[]>, item: ReportItem): LineResult {
  const issues: Issue[] = [];
  const empty = { total: 0, colours: [] as ScannedColour[], noStorage: 0 };
  const model = matchModel(state, index, item.name);
  if (!model) {
    return { id: item.id, status: 'unknown', issues: [{ kind: 'unknown-model', text: `"${item.name}" is not in the catalog. Match it to a model or add it.` }], scanned: empty, partMatch: item.parts.map(() => null) };
  }
  const want = splitName(item.name);
  const all = byCode.get(model.code) || [];
  const noStorage = all.filter(s => !s.storage).length;
  // a line with a storage (and RAM) only compares with the scanned phones of that storage (and RAM); a model line ("S26") compares storage by storage
  const scans = all.filter(s => (!want.storage || s.storage === unit(want.storage)) && (!want.ram || !s.ram || s.ram === unit(want.ram)));
  const scanned = { total: scans.length, colours: tally(scans), noStorage };
  let partMatch: (string | null)[] = item.parts.map(() => null);

  if (hasUnreadable(item)) issues.push({ kind: 'unreadable', text: `A number in (${item.parts.map(p => p.raw).join(',')}) could not be read. Check the counts.` });
  if (item.kind !== 'none' && item.parts.some(p => !p.label || p.raw === '')) issues.push({ kind: 'parts-mismatch', text: 'The counts and the names under them do not line up (a different number of each).' });

  if (item.kind === 'colour' && !hasUnreadable(item) && partsSum(item) !== item.stock)
    issues.push({ kind: 'colours-sum', text: `Colours add up to ${partsSum(item)} but stock says ${item.stock}.` });

  if (item.kind === 'storage') {
    // counts per storage: each against the scanned phones of that storage
    partMatch = item.parts.map(p => (p.label ? unit(p.label) : null));
    for (const p of item.parts) {
      if (p.count === null || !p.label) continue;
      const here = all.filter(s => s.storage === unit(p.label)).length;
      if (all.length && here !== p.count) issues.push({ kind: 'stock-differs', text: `${p.label}: report ${p.count}, scanned ${here}.` });
    }
  } else if (scans.length || item.stock) {
    if (scans.length === 0 && item.stock > 0) issues.push({ kind: 'not-scanned', text: `Report stock ${item.stock}, none scanned in the app yet.` });
    else if (scans.length !== item.stock) issues.push({ kind: 'stock-differs', text: `Report stock ${item.stock}, scanned ${scans.length}${scans.length > item.stock ? ' (more than the report)' : ''}.` });
  }

  if (item.kind === 'colour') {
    const names = modelColourNames(state, model.code, scanned.colours.map(c => c.name).filter(n => n !== 'No colour'));
    partMatch = item.parts.map(p => (p.label ? resolveColour(state, model.code, p.label, names) : null));
  }
  if (item.kind === 'colour' && scans.length && scanned.colours.some(c => c.name !== 'No colour')) {
    const names = modelColourNames(state, model.code, scanned.colours.map(c => c.name).filter(n => n !== 'No colour'));
    const seen = new Set<string>();
    item.parts.forEach((p, k) => {
      const name = partMatch[k];
      if (p.count === null || !p.label) return;
      if (!name) { if (p.count > 0) issues.push({ kind: 'colour-unmatched', text: `Colour "${p.label}" could not be matched to a scanned colour.` }); return; }
      seen.add(name);
      const have = scanned.colours.find(c => c.name === name)?.count || 0;
      if (have !== p.count) issues.push({ kind: 'colour-differs', text: `${p.label} (${name}): report ${p.count}, scanned ${have}.` });
    });
    for (const c of scanned.colours) if (!seen.has(c.name) && c.name !== 'No colour') issues.push({ kind: 'scanned-colour-missing', text: `${c.count} scanned in ${c.name}, a colour this report line does not list.` });
  }

  const real = issues.filter(i => i.kind !== 'not-scanned' && i.kind !== 'scanned-colour-missing' && i.kind !== 'colour-unmatched');
  const nothing = item.stock === 0 && item.sold === 0 && scans.length === 0 && all.length === 0 && !item.parts.some(p => (p.count ?? 0) > 0);
  let status: Status = real.length ? 'differ' : issues.length ? 'info' : nothing ? 'empty' : 'agree';
  if (item.checked && (status === 'differ' || status === 'info')) status = 'checked';
  return { id: item.id, status, code: model.code, matchedName: model.name, issues, scanned, partMatch };
}

/** Catalog models for the "match this line" picker: those whose name, abbreviation or code contains every typed word. */
export function searchModels(state: RetailState, text: string, limit = 12): CatalogItem[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return fullCatalog(state).filter(i => { const hay = `${i.name} ${i.abbreviation} ${i.code}`.toLowerCase(); return words.every(w => hay.includes(w)); }).slice(0, limit);
}
