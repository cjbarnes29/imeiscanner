/**
 * The scan report of the Android background scan: source PHOTOS counted apart from the product RECORDS read from them.
 * The numbers come from the app (ScanLedger.java); this file only reads and words them, so it can be tested.
 */

export type ReportSummary = {
  photos: number; scanned: number; failed: number; duplicatePhotos: number;
  products: number; saved: number; imeisDetected: number; missingImei: number; duplicateImeis: number;
  /** Products without an IMEI that the photo already had a record for: not added again (the earlier record is kept). */
  emptyRepeats: number; review: number;
  /** Photos of this scan that failed or show a product without an IMEI. */
  needRescanInJob: number;
  /** Photos from any scan that still need a new scan. */
  needRescan: number;
};

export type ReportPhoto = {
  uri: string; name: string; hash?: string; jobId: string; at?: string;
  outcome: 'scanned' | 'failed' | 'duplicate-photo' | string;
  products: number; saved: number; savedIds?: string[]; imeis: string[]; missingImei: number; orphanBarcodes?: number;
  duplicates: { imei: string; of: string }[]; emptyRepeats: { of: string }[]; supersedes: string[]; review: number; reason: string; needsRescan: boolean;
  duplicateOfUri?: string; scans?: number;
};

export type ScanReportData = { jobId: string; report: ReportSummary; photos: ReportPhoto[] };

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const EMPTY_SUMMARY: ReportSummary = { photos: 0, scanned: 0, failed: 0, duplicatePhotos: 0, products: 0, saved: 0, imeisDetected: 0, missingImei: 0, duplicateImeis: 0, emptyRepeats: 0, review: 0, needRescanInJob: 0, needRescan: 0 };

/** Reads the summary the app sends with every status; anything missing (an older app, a bad value) counts as 0. */
export function readSummary(value: unknown): ReportSummary {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    photos: num(v.photos), scanned: num(v.scanned), failed: num(v.failed), duplicatePhotos: num(v.duplicatePhotos),
    products: num(v.products), saved: num(v.saved), imeisDetected: num(v.imeisDetected), missingImei: num(v.missingImei),
    duplicateImeis: num(v.duplicateImeis), emptyRepeats: num(v.emptyRepeats), review: num(v.review), needRescanInJob: num(v.needRescanInJob), needRescan: num(v.needRescan)
  };
}

/** Reads the text from the app's scanReport(); null when it is not a valid report. */
export function parseReport(raw: string): ScanReportData | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object' || !Array.isArray(data.photos)) return null;
    const photos: ReportPhoto[] = (data.photos as unknown[]).filter(p => p && typeof p === 'object').map(p => {
      const e = p as Record<string, unknown>;
      return {
        uri: text(e.uri), name: text(e.name) || 'Photo', hash: text(e.hash), jobId: text(e.jobId), at: text(e.at), outcome: text(e.outcome),
        products: num(e.products), saved: num(e.saved), savedIds: Array.isArray(e.savedIds) ? (e.savedIds as unknown[]).map(text) : [],
        imeis: Array.isArray(e.imeis) ? (e.imeis as unknown[]).map(text).filter(Boolean) : [], missingImei: num(e.missingImei), orphanBarcodes: num(e.orphanBarcodes),
        duplicates: Array.isArray(e.duplicates) ? (e.duplicates as unknown[]).map(d => ({ imei: text((d as Record<string, unknown>)?.imei), of: text((d as Record<string, unknown>)?.of) })) : [],
        emptyRepeats: Array.isArray(e.emptyRepeats) ? (e.emptyRepeats as unknown[]).map(d => ({ of: text((d as Record<string, unknown>)?.of) })) : [],
        supersedes: Array.isArray(e.supersedes) ? (e.supersedes as unknown[]).map(text).filter(Boolean) : [],
        review: num(e.review), reason: text(e.reason), needsRescan: e.needsRescan === true, duplicateOfUri: text(e.duplicateOfUri), scans: num(e.scans) || 1
      };
    });
    return { jobId: text(data.jobId), report: readSummary(data.report), photos };
  } catch { return null; }
}

/** The accounting rules the numbers must obey: every photo has one outcome, every product is saved or a linked duplicate (same IMEI, or a repeat of an empty record). */
export function isBalanced(summary: ReportSummary): boolean {
  return summary.photos === summary.scanned + summary.failed + summary.duplicatePhotos
    && summary.products === summary.saved + summary.duplicateImeis + summary.emptyRepeats
    && summary.imeisDetected + summary.missingImei === summary.products;
}

const plural = (count: number, one: string, many: string = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** One honest line for the scan: only the parts that apply are shown, and nothing is left out that went wrong. */
export function summaryLine(summary: ReportSummary): string {
  if (summary.photos <= 0) return '';
  const parts = [
    `${plural(summary.products, 'product')} found`,
    `${plural(summary.imeisDetected, 'IMEI')} read`
  ];
  if (summary.missingImei) parts.push(`${summary.missingImei} without an IMEI`);
  if (summary.duplicateImeis) parts.push(`${plural(summary.duplicateImeis, 'duplicate IMEI')} not saved again`);
  if (summary.emptyRepeats) parts.push(`${plural(summary.emptyRepeats, 'unreadable record')} already listed, not added again`);
  if (summary.duplicatePhotos) parts.push(`${plural(summary.duplicatePhotos, 'repeated picture')}`);
  if (summary.failed) parts.push(`${plural(summary.failed, 'photo')} could not be read`);
  if (summary.review) parts.push(`${summary.review} to review`);
  return parts.join(' · ');
}

export type PhotoStatus = { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' };

/** What to tell the user about one photo. */
export function photoStatus(photo: ReportPhoto): PhotoStatus {
  if (photo.outcome === 'failed') return { label: `Could not be read${photo.reason ? `: ${photo.reason}` : ''}`, tone: 'bad' };
  if (photo.outcome === 'duplicate-photo') return { label: 'Same picture as another one in this scan', tone: 'info' };
  const bits: string[] = [plural(photo.products, 'product')];
  if (photo.imeis.length) bits.push(`${plural(photo.imeis.length, 'IMEI')} read`);
  if (photo.missingImei) bits.push(`${photo.missingImei} without an IMEI`);
  if (photo.orphanBarcodes) bits.push('a label may have been missed (barcode numbers without a matching label)');
  if (photo.emptyRepeats.length) bits.push(`${photo.emptyRepeats.length} unreadable already listed, not added again`);
  if (photo.duplicates.length) bits.push(`${plural(photo.duplicates.length, 'duplicate')} not saved again`);
  if (photo.review) bits.push(`${photo.review} to review`);
  const tone = photo.missingImei || photo.review || photo.orphanBarcodes ? 'warn' : 'ok';
  return { label: bits.join(' · '), tone };
}

/** The photos of the current scan first, then older photos that still need a new scan. */
export function orderPhotos(data: ScanReportData): { current: ReportPhoto[]; older: ReportPhoto[] } {
  const current = data.photos.filter(p => p.jobId === data.jobId);
  const older = data.photos.filter(p => p.jobId !== data.jobId && p.needsRescan);
  return { current, older };
}
