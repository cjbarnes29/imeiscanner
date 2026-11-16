/**
 * The pasted WhatsApp report. Every model is two lines:
 *     A07 64GB : 04/15            name, SOLD / STOCK
 *     (02,00,13) Vlt,Grn,Blk      stock per colour (or per storage), then their names
 * Everything else (header, separator lines, totals, other brands, shifts) is kept exactly as typed, so the report can be copied back out in the same
 * layout. Nothing here guesses: a number that cannot be read is kept as typed and flagged, never turned into a different number.
 */
import type { ReportItem, ReportPart, ReportText, StockReport } from './types';

const ITEM_LINE = /^\s*([^:\n]*?\S)\s*:\s*(\d{1,3})\s*\/\s*(\d{1,4})\s*$/;
const BRACKET_LINE = /^\s*\(([^)]*)\)(\s*)(.*)$/;
const TOTAL_LINE = /^(\s*total\s*sell\s*out\s*:?\s*)(\d+)(.*)$/i;
const DATE_LINE = /^(\s*date\s*:\s*)(.+?)\s*$/i;
const STORAGE_LABEL = /^\d{1,4}\s*(gb|tb)$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const widthOf = (digits: string) => Math.min(4, digits.length);
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** A count such as "02" -> 2; OCR-style slips (O for 0) are repaired; anything else ("0p") is unreadable (null). */
export function readCount(token: string): number | null {
  const t = token.trim().replace(/[Oo]/g, '0');
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

export function parseReport(text: string, now = new Date().toISOString()): StockReport {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries: StockReport['entries'] = [];
  let totalSellout: StockReport['totalSellout'];
  let dateText: string | undefined;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = ITEM_LINE.exec(line);
    if (m) {
      const next = lines[i + 1];
      const b = next === undefined ? null : BRACKET_LINE.exec(next);
      const counts = b ? b[1].split(',').map(x => x.trim()) : [];
      const labels = b ? b[3].split(',').map(x => x.trim()).filter(Boolean) : [];
      const parts: ReportPart[] = [];
      for (let k = 0; k < Math.max(counts.length, labels.length); k++) parts.push({ label: labels[k] ?? '', count: counts[k] === undefined ? null : readCount(counts[k]), raw: counts[k] ?? '' });
      const item: ReportItem = {
        t: 'item', id: `r${n++}`, name: m[1], sold: Number(m[2]), stock: Number(m[3]), soldWidth: widthOf(m[2]), stockWidth: widthOf(m[3]),
        kind: !b ? 'none' : labels.length && labels.every(l => STORAGE_LABEL.test(l)) ? 'storage' : 'colour', parts, sep: b ? (b[2] || ' ') : ' ', line1: line, line2: b ? next! : ''
      };
      entries.push(item);
      if (b) i++;
      continue;
    }
    const total = TOTAL_LINE.exec(line);
    if (total && !totalSellout) totalSellout = { typed: Number(total[2]), acknowledged: false, extra: 0 };
    const date = DATE_LINE.exec(line);
    if (date && !dateText) dateText = date[2];
    entries.push({ t: 'text', text: line } as ReportText);
  }
  return { entries, totalSellout, savedAt: now, dateText };
}

export const reportItems = (report: StockReport): ReportItem[] => report.entries.filter((e): e is ReportItem => e.t === 'item');
export const listedSold = (report: StockReport) => reportItems(report).reduce((sum, item) => sum + item.sold, 0);
/** Sum of the readable counts of a line's colours (or storages). */
export const partsSum = (item: ReportItem) => item.parts.reduce((sum, p) => sum + (p.count ?? 0), 0);
export const hasUnreadable = (item: ReportItem) => item.parts.some(p => p.count === null && p.raw.trim() !== '');

/** The date written the way the report wrote its own ("Nov 11, 2026", "11/11/2026", "2026-11-11"); the old text when its style is not known. */
export function formatDateLike(old: string | undefined, date: Date): string {
  const d = date.getDate(), mo = date.getMonth(), y = date.getFullYear();
  const two = (v: number) => String(v).padStart(2, '0');
  if (!old) return `${MONTHS[mo]} ${d}, ${y}`;
  if (/^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$/.test(old)) return `${MONTHS[mo]} ${d}, ${y}`;
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(old)) return `${d} ${MONTHS[mo]} ${y}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(old)) return `${two(d)}/${two(mo + 1)}/${y}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(old)) return `${d}/${mo + 1}/${y}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(old)) return `${y}-${two(mo + 1)}-${two(d)}`;
  return old;
}

/** The two lines of one model, written in the layout it had when pasted (zero padding, spacing around the colon, the space before the names). */
export function itemLines(item: ReportItem): string[] {
  const colon = /^(.*?)(\s*:\s*)\d/.exec(item.line1)?.[2] ?? ' : ';
  const first = `${item.name}${colon}${pad(item.sold, item.soldWidth)}/${pad(item.stock, item.stockWidth)}`;
  if (item.kind === 'none') return [first];
  const counts = item.parts.map(p => (p.count === null ? p.raw : pad(p.count, widthOf(p.raw.replace(/\D/g, '') || '00'))));
  const labels = item.parts.map(p => p.label).filter(Boolean);
  const lead = /^(\s*)\(/.exec(item.line2)?.[1] ?? '';
  return [first, `${lead}(${counts.join(',')})${item.sep}${labels.join(',')}`];
}

/**
 * The report as text, ready to copy. The date is set to `date` (in the report's own date style). `newDay`: every sold number and the total sellout go
 * back to 00 for the new day (stock and colours stay). The total sellout is only rewritten when the person said it includes phones that are not
 * in the list (then it follows the list); otherwise the typed total is left exactly as it was.
 */
export function buildReport(report: StockReport, opts: { date?: Date; newDay?: boolean } = {}): string {
  const out: string[] = [];
  const listed = opts.newDay ? 0 : listedSold(report);
  for (const entry of report.entries) {
    if (entry.t === 'item') { out.push(...itemLines(opts.newDay ? { ...entry, sold: 0 } : entry)); continue; }
    let line = entry.text;
    const date = opts.date ? DATE_LINE.exec(line) : null;
    if (date) { line = `${date[1]}${formatDateLike(report.dateText, opts.date!)}`; }
    const total = TOTAL_LINE.exec(line);
    if (total && report.totalSellout) {
      const value = opts.newDay ? 0 : report.totalSellout.acknowledged ? listed + report.totalSellout.extra : report.totalSellout.typed;
      line = `${total[1]}${pad(value, total[2].length > 1 && total[2].startsWith('0') ? total[2].length : 1)}${total[3]}`;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Says the typed total includes phones that are not in the list: the difference is remembered, so editing the list later keeps it. */
export function acknowledgeTotal(report: StockReport): StockReport {
  if (!report.totalSellout) return report;
  return { ...report, totalSellout: { ...report.totalSellout, acknowledged: true, extra: Math.max(0, report.totalSellout.typed - listedSold(report)) } };
}

/** Changes one model line. Editing the colours (or storages) makes the stock their total, so the line always agrees with itself. */
export function updateItem(report: StockReport, id: string, patch: { name?: string; sold?: number; stock?: number; parts?: ReportPart[]; checked?: boolean }): StockReport {
  return {
    ...report,
    entries: report.entries.map(e => {
      if (e.t !== 'item' || e.id !== id) return e;
      const next = { ...e, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.sold !== undefined ? { sold: Math.max(0, Math.floor(patch.sold)) } : {}), ...(patch.parts ? { parts: patch.parts } : {}), ...(patch.checked !== undefined ? { checked: patch.checked } : {}) };
      if (patch.parts && e.kind === 'colour') next.stock = patch.parts.reduce((sum, p) => sum + (p.count ?? 0), 0);
      else if (patch.stock !== undefined) next.stock = Math.max(0, Math.floor(patch.stock));
      return next;
    })
  };
}

/** The next day: every sold number and the total sellout go back to 0, stock and colours stay. */
export function startNewDay(report: StockReport): StockReport {
  return {
    ...report,
    entries: report.entries.map(e => (e.t === 'item' ? { ...e, sold: 0 } : e)),
    totalSellout: report.totalSellout ? { typed: 0, acknowledged: false, extra: 0 } : undefined
  };
}
