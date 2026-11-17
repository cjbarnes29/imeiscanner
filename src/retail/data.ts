/**
 * RetailLens state: defaults, loading anything stored safely, month history, backup and restore (with undo). Pure functions: the storage itself
 * is retail-store.ts. Whatever is read from disk or from a backup file is treated as untrusted and cleaned, so a damaged file cannot break the app.
 */
import { isDateKey, isMonth, isSegment, LEVELS, SEGMENTS, type DayLog, type IncentiveRates, type Level, type Month, type PersonTarget, type ReportItem, type ReportText, type RetailState, type Sale, type SegmentDef, type StockReport, type TargetLine } from './types';

/** EXAMPLE incentive scheme (edit it in Targets > Incentives): the real scheme is the person's own, the app only multiplies. */
export const DEFAULT_RATES: IncentiveRates = {
  perUnit: { flagship1: 500, flagship2: 400, flagship3: 300, mid: 150, low: 75, tablet: 200, wearable: 100, other: 0 },
  multiplier: { 70: 0.5, 100: 1, 120: 1.5 }, currency: '₹'
};

export const emptyDay = (): DayLog => ({ activations: 0, scPlus: 0, competitor: [], shifts: [], checklist: {}, custom: [] });

export function emptyState(): RetailState {
  return {
    version: 1, catalog: [], aliases: {}, corrections: {}, recordMeta: {}, sales: [], targets: {}, rates: DEFAULT_RATES, allocations: [], days: {}, stockAdjust: [],
    settings: { myPersonId: '', myThreshold: 100, lowStock: 2, reportAuthor: '' }, history: {}, audit: []
  };
}

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const count = (value: unknown): number => Math.max(0, Math.floor(num(value)));

function cleanLine(value: unknown): TargetLine | null {
  const v = obj(value);
  if (!isSegment(v.segment)) return null;
  const levels: Partial<Record<Level, number>> = {};
  const given = obj(v.levels);
  for (const level of LEVELS) if (typeof given[level] === 'number' && Number.isFinite(given[level] as number) && (given[level] as number) >= 0) levels[level] = Math.floor(given[level] as number);
  const cap = LEVELS.find(level => level === v.cap);
  return { segment: v.segment, target: count(v.target), achieved: count(v.achieved), ...(Object.keys(levels).length ? { levels } : {}), ...(cap ? { cap } : {}) };
}
function cleanReport(value: unknown): StockReport | undefined {
  const v = obj(value);
  const entries = arr(v.entries).map(obj).map((e): ReportItem | ReportText | null => {
    if (e.t === 'text') return { t: 'text', text: str(e.text).slice(0, 400) };
    if (e.t !== 'item' || !str(e.name)) return null;
    const parts = arr(e.parts).map(obj).map(p => ({ label: str(p.label).slice(0, 30), count: typeof p.count === 'number' && Number.isFinite(p.count) ? Math.max(0, Math.floor(p.count)) : null, raw: str(p.raw).slice(0, 12) }));
    return { t: 'item', id: str(e.id) || `r${Math.random().toString(36).slice(2, 8)}`, name: str(e.name).slice(0, 80), sold: count(e.sold), stock: count(e.stock), soldWidth: Math.min(4, Math.max(1, count(e.soldWidth) || 2)), stockWidth: Math.min(4, Math.max(1, count(e.stockWidth) || 2)),
      kind: e.kind === 'colour' || e.kind === 'storage' ? e.kind : 'none', parts, sep: str(e.sep, ' ').slice(0, 4), line1: str(e.line1).slice(0, 160), line2: str(e.line2).slice(0, 200), ...(e.checked === true ? { checked: true } : {}), ...(e.auto === true ? { auto: true } : {}), ...(typeof e.scanAdded === 'number' && Number.isFinite(e.scanAdded) && e.scanAdded !== 0 ? { scanAdded: Math.trunc(e.scanAdded) } : {}) };
  }).filter((e): e is ReportItem | ReportText => !!e).slice(0, 1000);
  if (!entries.length) return undefined;
  const t = obj(v.totalSellout);
  const scanBase = Object.fromEntries(Object.entries(obj(v.scanBase)).filter(([k, c]) => k.length <= 80 && typeof c === 'number' && c > 0 && c < 1e6).slice(0, 3000).map(([k, c]) => [k, Math.floor(c as number)]));
  return { entries, savedAt: str(v.savedAt), dateText: str(v.dateText) || undefined, scanBase: v.scanBase ? scanBase : undefined, totalSellout: typeof t.typed === 'number' ? { typed: count(t.typed), acknowledged: t.acknowledged === true, extra: count(t.extra) } : undefined };
}
function cleanColourAliases(value: unknown): RetailState['colourAliases'] {
  const out = Object.fromEntries(Object.entries(obj(value)).filter(([k, n]) => /^[a-z]{1,20}$/.test(k) && str(n).trim()).slice(0, 500).map(([k, n]) => [k, str(n).trim().slice(0, 30)]));
  return Object.keys(out).length ? out : undefined;
}
function cleanColours(value: unknown): RetailState['colours'] {
  const out: NonNullable<RetailState['colours']> = {};
  for (const [code, raw] of Object.entries(obj(value))) {
    if (!/^[A-Z0-9]{3,6}$/.test(code)) continue;
    const v = obj(raw);
    const names = [...new Set(arr(v.names).map(n => str(n).trim().slice(0, 30)).filter(Boolean))].slice(0, 40);
    const aliases = Object.fromEntries(Object.entries(obj(v.aliases)).filter(([k, n]) => /^[a-z]{1,20}$/.test(k) && str(n).trim()).map(([k, n]) => [k, str(n).trim().slice(0, 30)]));
    if (names.length || Object.keys(aliases).length) out[code] = { names, aliases };
  }
  return Object.keys(out).length ? out : undefined;
}
function cleanLedger(value: unknown): RetailState['soldLedger'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: NonNullable<RetailState['soldLedger']> = {};
  for (const [id, raw] of Object.entries(obj(value)).slice(0, 100000)) {
    const e = obj(raw);
    if (!id || id.length > 80 || !isSegment(e.segment) || !isMonth(e.month)) continue;
    out[id] = { personId: str(e.personId).slice(0, 80), segment: e.segment as string, month: e.month as string, code: str(e.code).slice(0, 8), storage: str(e.storage).slice(0, 12), ...(/^\d{4}-\d{2}-\d{2}$/.test(str(e.date)) ? { date: str(e.date) } : {}) };
  }
  return out;
}
function cleanSegments(value: unknown): SegmentDef[] | undefined {
  const list = arr(value).map(obj).filter(s => isSegment(s.id) && str(s.name)).map(s => ({ id: str(s.id), name: str(s.name).slice(0, 30) }));
  return list.length ? list : undefined;
}
function cleanTarget(value: unknown, month: Month): PersonTarget | null {
  const v = obj(value);
  if (!str(v.personId)) return null;
  return { personId: str(v.personId), month, lines: arr(v.lines).map(cleanLine).filter((l): l is TargetLine => !!l), source: v.source === 'screenshot' ? 'screenshot' : 'manual', importedAt: str(v.importedAt), note: str(v.note) || undefined };
}
function cleanSale(value: unknown): Sale | null {
  const v = obj(value);
  if (!str(v.id) || !isDateKey(v.date) || !/^\d{15}$/.test(str(v.imei))) return null;
  return {
    id: str(v.id), recordId: str(v.recordId), imei: str(v.imei), model: str(v.model), modelName: str(v.modelName), ram: str(v.ram), storage: str(v.storage), color: str(v.color),
    segment: isSegment(v.segment) ? v.segment : 'other', personId: str(v.personId), date: v.date as string, month: v.date.slice(0, 7), submitted: v.submitted === true,
    submittedAt: str(v.submittedAt) || undefined, attributedBy: v.attributedBy === 'approved' ? 'approved' : 'owner', reason: str(v.reason) || undefined,
    voided: v.voided === true ? true : undefined, voidedAt: str(v.voidedAt) || undefined, createdAt: str(v.createdAt)
  };
}

/** Anything stored or imported -> a valid state. Unknown parts are dropped, never guessed. */
export function cleanState(raw: unknown): RetailState {
  const base = emptyState();
  const v = obj(raw);
  const rates = obj(v.rates), perUnit = obj(rates.perUnit), mult = obj(rates.multiplier);
  const targets: RetailState['targets'] = {};
  for (const [month, people] of Object.entries(obj(v.targets))) {
    if (!isMonth(month)) continue;
    for (const [id, target] of Object.entries(obj(people))) { const t = cleanTarget(target, month); if (t) (targets[month] ||= {})[id] = { ...t, personId: id }; }
  }
  const days: RetailState['days'] = {};
  for (const [key, day] of Object.entries(obj(v.days))) {
    if (!isDateKey(key)) continue;
    const d = obj(day);
    days[key] = {
      activations: count(d.activations), scPlus: count(d.scPlus),
      competitor: arr(d.competitor).map(obj).filter(c => str(c.brand) || str(c.model)).map(c => ({ brand: str(c.brand), model: str(c.model), qty: Math.max(1, count(c.qty)) })),
      shifts: arr(d.shifts).map(obj).filter(s => str(s.person)).map(s => ({ person: str(s.person), shift: str(s.shift) })),
      checklist: Object.fromEntries(Object.entries(obj(d.checklist)).filter(([, done]) => typeof done === 'boolean')) as Record<string, boolean>,
      custom: arr(d.custom).map(obj).filter(c => str(c.id) && str(c.text)).map(c => ({ id: str(c.id), text: str(c.text).slice(0, 200), done: c.done === true }))
    };
  }
  const corrections: RetailState['corrections'] = {};
  for (const [code, segment] of Object.entries(obj(v.corrections))) if (isSegment(segment)) corrections[code] = segment;
  const settings = obj(v.settings);
  const aliases = Object.fromEntries(Object.entries(obj(v.aliases)).filter(([k, code]) => k.length <= 60 && /^[A-Z0-9]{3,6}$/.test(str(code))).map(([k, code]) => [k, str(code)]));
  return {
    ...base,
    giveMode: v.giveMode === 'auto' ? 'auto' as const : undefined,
    giveLimits: Object.fromEntries(Object.entries(obj(v.giveLimits)).filter(([id]) => id.length > 0 && id.length <= 60).map(([id, l]) => { const o = obj(l); const min = count(o.min), max = typeof o.max === 'number' && Number.isFinite(o.max) && o.max >= 0 ? Math.floor(o.max) : undefined; return [id, { ...(min > 0 ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(o.off === true ? { off: true } : {}) }]; }).filter(([, l]) => Object.keys(l as object).length > 0)),
    targetAliases: Object.fromEntries(Object.entries(obj(v.targetAliases)).filter(([k, id]) => k.length >= 2 && k.length <= 60 && str(id)).map(([k, id]) => [k, str(id)])),
    segments: cleanSegments(v.segments), soldLedger: cleanLedger(v.soldLedger), aliases, report: cleanReport(v.report), colours: cleanColours(v.colours), colourAliases: cleanColourAliases(v.colourAliases),
    catalog: arr(v.catalog).map(obj).filter(c => /^[A-Z0-9]{3,6}$/.test(str(c.code))).map(c => ({
      code: str(c.code), name: str(c.name) || str(c.code), abbreviation: str(c.abbreviation) || str(c.name), segment: isSegment(c.segment) ? c.segment : 'other',
      monthly: Object.fromEntries(Object.entries(obj(c.monthly)).filter(([m, s]) => isMonth(m) && isSegment(s))) as Record<Month, never>,
      variants: arr(c.variants).map(obj).map(x => ({ sku: str(x.sku), ram: str(x.ram), storage: str(x.storage), colors: arr(x.colors).map(y => str(y)).filter(Boolean) })), custom: true
    })),
    corrections,
    recordMeta: Object.fromEntries(Object.entries(obj(v.recordMeta)).map(([id, m]) => { const o = obj(m); return [id, { ...(isSegment(o.segment) ? { segment: o.segment } : {}), ...(str(o.ram) ? { ram: str(o.ram) } : {}), ...(str(o.storage) ? { storage: str(o.storage) } : {}), ...(str(o.color) ? { color: str(o.color) } : {}), ...(o.status === 'sold' || o.status === 'given' || o.status === 'held' ? { status: o.status } : {}) }]; })),
    sales: arr(v.sales).map(cleanSale).filter((s): s is Sale => !!s),
    targets,
    rates: {
      perUnit: Object.fromEntries([...SEGMENTS, 'other'].map(s => [s, Math.max(0, num(perUnit[s], DEFAULT_RATES.perUnit[s as keyof typeof DEFAULT_RATES.perUnit]))])) as IncentiveRates['perUnit'],
      multiplier: { 70: Math.max(0, num(mult['70'], 0.5)), 100: Math.max(0, num(mult['100'], 1)), 120: Math.max(0, num(mult['120'], 1.5)) }, currency: str(rates.currency, '₹').slice(0, 4) || '₹'
    },
    allocations: arr(v.allocations).map(obj).filter(a => str(a.id)).map(a => ({
      id: str(a.id), at: str(a.at), month: isMonth(a.month) ? a.month : '', source: a.source === 'recommended' ? 'recommended' as const : a.source === 'auto' ? 'auto' as const : 'manual' as const,
      status: a.status === 'undone' ? 'undone' as const : 'applied' as const, undoneAt: str(a.undoneAt) || undefined, note: str(a.note) || undefined,
      items: arr(a.items).map(obj).filter(i => str(i.recordId)).map(i => ({ recordId: str(i.recordId), imei: str(i.imei), segment: isSegment(i.segment) ? i.segment : 'other' as const, from: str(i.from), to: str(i.to) }))
    })),
    days,
    stockAdjust: arr(v.stockAdjust).map(obj).filter(a => str(a.id) && isDateKey(a.date)).map(a => ({ id: str(a.id), at: str(a.at), date: a.date as string, code: str(a.code), name: str(a.name), storage: str(a.storage), color: str(a.color), delta: Math.trunc(num(a.delta)), note: str(a.note) })),
    template: v.template && obj(v.template).title ? obj(v.template) as unknown as RetailState['template'] : undefined,
    settings: { myPersonId: str(settings.myPersonId), myThreshold: ([70, 100, 120] as const).find(t => t === settings.myThreshold) || 100, lowStock: Math.max(0, count(settings.lowStock) || 2), reportAuthor: str(settings.reportAuthor) },
    history: Object.fromEntries(Object.entries(obj(v.history)).filter(([m]) => isMonth(m)).map(([m, h]) => { const o = obj(h); return [m, { closedAt: str(o.closedAt), targets: Object.fromEntries(Object.entries(obj(o.targets)).map(([id, t]) => [id, cleanTarget(t, m)]).filter(([, t]) => t)) as Record<string, PersonTarget>, sales: count(o.sales), byPerson: Object.fromEntries(Object.entries(obj(o.byPerson)).map(([id, n]) => [id, count(n)])) }]; })),
    audit: arr(v.audit).map(obj).filter(a => str(a.what)).slice(-500).map(a => ({ at: str(a.at), what: str(a.what), detail: str(a.detail).slice(0, 300) }))
  };
}

/** A line in the audit trail (kept short: the last 500). Used for approvals, re-attributions, restores. */
export function withAudit(state: RetailState, what: string, detail: string, at = new Date().toISOString()): RetailState {
  return { ...state, audit: [...state.audit, { at, what, detail: detail.slice(0, 300) }].slice(-500) };
}

/**
 * Closes every month before `month` that has anything in it: its targets and sales count are copied to history (a month is never deleted or
 * changed by this, only summarised), so last month's picture stays available after the new month starts.
 */
export function rollover(state: RetailState, month: Month, at = new Date().toISOString()): RetailState {
  const months = new Set<Month>([...Object.keys(state.targets), ...state.sales.map(s => s.month)]);
  let next = state;
  for (const m of [...months].sort()) {
    if (m >= month || next.history[m]) continue;
    const live = state.sales.filter(s => s.month === m && !s.voided);
    const byPerson: Record<string, number> = {};
    for (const sale of live) byPerson[sale.personId] = (byPerson[sale.personId] || 0) + 1;
    next = { ...next, history: { ...next.history, [m]: { closedAt: at, targets: state.targets[m] || {}, sales: live.length, byPerson } } };
  }
  return next === state ? state : withAudit(next, 'rollover', `closed months before ${month}`, at);
}

// ---- backup and restore ---------------------------------------------------------------------------------------------------------

export type LedgerEntry = { id: string; imei: string; imei2?: string; serial?: string; model: string; personId: string; createdAt?: string };
export type Backup = { app: 'RetailLens'; version: 1; createdAt: string; state: RetailState; ledger: LedgerEntry[] };

/** The backup: the whole retail state plus a plain ledger of the scan records (no pictures), enough to rebuild owners and check numbers. */
export function makeBackup(state: RetailState, records: { id: string; imei: string; imei2?: string; serial?: string; model: string; personId: string; createdAt?: string }[], now = new Date().toISOString()): Backup {
  return { app: 'RetailLens', version: 1, createdAt: now, state, ledger: records.map(r => ({ id: r.id, imei: r.imei, imei2: r.imei2, serial: r.serial, model: r.model, personId: r.personId, createdAt: r.createdAt })) };
}

export type BackupCheck = { ok: true; backup: Backup } | { ok: false; error: string };
/** Reads backup text. Refuses anything that is not a RetailLens backup; everything inside is cleaned. */
export function readBackup(text: string): BackupCheck {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'This is not a backup file (it could not be read).' }; }
  const v = obj(data);
  if (v.app !== 'RetailLens' || v.version !== 1) return { ok: false, error: 'This file is not a RetailLens backup.' };
  const ledger = arr(v.ledger).map(obj).filter(l => str(l.id)).map(l => ({ id: str(l.id), imei: str(l.imei), imei2: str(l.imei2) || undefined, serial: str(l.serial) || undefined, model: str(l.model), personId: str(l.personId), createdAt: str(l.createdAt) || undefined }));
  return { ok: true, backup: { app: 'RetailLens', version: 1, createdAt: str(v.createdAt), state: cleanState(v.state), ledger } };
}

/**
 * Restoring replaces the retail data with the backup's. The state before is returned as `undo` (the app keeps it, so Undo brings everything back)
 * and the audit trail notes the restore. Scan records and their pictures are never touched by a restore.
 */
export function restoreBackup(current: RetailState, backup: Backup, at = new Date().toISOString()): { state: RetailState; undo: RetailState } {
  return { state: withAudit(backup.state, 'restore', `restored the backup of ${backup.createdAt || 'unknown date'}`, at), undo: current };
}
