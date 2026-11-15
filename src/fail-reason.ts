/**
 * Why a label has no usable IMEI 1, in words. The Android scanner decides the kind from what it saw (FailReason.java); this file only words it
 * for the scan report and the review screens. A kind is never made of, or followed by, a number: nothing here can show an IMEI.
 */
export type FailKind = 'cut-edge' | 'imei2-only' | 'checksum-failed' | 'partial-number' | 'line-unreadable' | 'no-imei-line' | 'no-text' | 'barcode-conflict';

/** Every kind, in the order the report lists them. */
export const FAIL_KINDS: FailKind[] = ['cut-edge', 'imei2-only', 'checksum-failed', 'partial-number', 'line-unreadable', 'no-imei-line', 'no-text', 'barcode-conflict'];

export const isFailKind = (value: unknown): value is FailKind => typeof value === 'string' && (FAIL_KINDS as string[]).includes(value);

const SHORT: Record<FailKind, string> = {
  'cut-edge': 'cut off by the photo edge',
  'imei2-only': 'only IMEI 2 read',
  'checksum-failed': 'number read but not a valid IMEI',
  'partial-number': 'IMEI 1 only partly read',
  'line-unreadable': 'IMEI 1 digits unreadable',
  'no-imei-line': 'no IMEI 1 line found',
  'no-text': 'no label text found',
  'barcode-conflict': 'barcode and printed digits disagree'
};

const LONG: Record<FailKind, string> = {
  'cut-edge': 'The label is cut off by the edge of the photo, so its IMEI 1 is not in the picture.',
  'imei2-only': 'Only IMEI 2 could be read. IMEI 1 was not read and is never copied from IMEI 2.',
  'checksum-failed': 'A number was read on the IMEI 1 line but it is not a valid IMEI, so it was not used.',
  'partial-number': 'Only some digits of the IMEI 1 line could be read (blur or glare).',
  'line-unreadable': 'The IMEI 1 line was found but its digits could not be read.',
  'no-imei-line': 'Other label text was read, but no IMEI 1 line was found.',
  'no-text': 'No label text could be read (blank, very blurry, or not a label).',
  'barcode-conflict': 'A barcode and the printed digits disagree, so neither was trusted.'
};

/** A few words for a count line ("2 IMEI 1 only partly read"). Empty for a kind from a newer app. */
export const failReasonShort = (kind: string): string => (isFailKind(kind) ? SHORT[kind] : '');

/** One sentence for a record. Empty for a kind from a newer app. */
export const failReasonText = (kind: string): string => (isFailKind(kind) ? LONG[kind] : '');

/** The counts the app sends ({kind: count}), cleaned: only known kinds and positive whole numbers survive. */
export function readReasons(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object') return out;
  for (const kind of FAIL_KINDS) {
    const count = (value as Record<string, unknown>)[kind];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[kind] = Math.floor(count);
  }
  return out;
}

/** "2 IMEI 1 only partly read · 1 no label text found", in the fixed kind order. Empty when there is nothing to say. */
export function reasonsLine(reasons?: Record<string, number>): string {
  if (!reasons) return '';
  return FAIL_KINDS.filter(kind => (reasons[kind] || 0) > 0).map(kind => `${reasons[kind]} ${SHORT[kind]}`).join(' · ');
}
