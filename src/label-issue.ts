/**
 * Incomplete labels: the scanner tells WHY a label in a photo could not be read (cut by a photo edge, partly read, unreadable), and this file
 * words it for the person. It never produces a number, and the record stays "Needs review": the person decides (retake, crop, or keep).
 * The prompt is shown only while the record still asks for a check (`cropNeedsReview`) or has no IMEI: every way a person resolves a record
 * clears that flag or fills the IMEI, so the prompt cannot linger after a person has dealt with it.
 */
export type LabelIssueKind = 'cut-edge' | 'partial-number' | 'unreadable';

export type IssueFields = {
  labelIssue?: string; labelIssueSide?: string; labelsMissing?: number; labelIssueDigits?: number;
  /** The person chose "Keep as is": the retake prompt is hidden, the record still needs review. */
  labelIssueDismissed?: boolean; cropNeedsReview?: boolean;
  /** A record without an IMEI keeps asking for a retake until a person types one. */
  imei?: string;
};

const KINDS: LabelIssueKind[] = ['cut-edge', 'partial-number', 'unreadable'];
const SIDES = ['left', 'right', 'top', 'bottom'];

/** The issue to show for a record, or null (none known, dismissed, or already resolved by a person). */
export function activeIssue(record: IssueFields): LabelIssueKind | null {
  if (!(record.cropNeedsReview || !record.imei) || record.labelIssueDismissed) return null;
  return KINDS.includes(record.labelIssue as LabelIssueKind) ? (record.labelIssue as LabelIssueKind) : null;
}

export type IssueText = { title: string; text: string; short: string };

/** The words for one issue. `missing` = how many labels could not be read; `digits` = digits of IMEI 1 that were read (a count, never the digits). */
export function issueText(kind: LabelIssueKind, side = '', missing = 1, digits = 0): IssueText {
  const many = missing > 1;
  if (kind === 'cut-edge') {
    const edge = SIDES.includes(side) ? `the ${side} edge of the photo` : 'the edge of the photo';
    return {
      title: 'Retake this photo',
      text: `${many ? `${missing} labels appear` : 'A label appears'} to be cut off at ${edge}, so ${many ? 'they' : 'it'} could not be read. Retake the photo with the whole label inside the frame.`,
      short: `Label cut off at ${SIDES.includes(side) ? `the ${side} edge` : 'the photo edge'}: retake the photo.`
    };
  }
  if (kind === 'partial-number') {
    const seen = digits > 0 && digits < 15 ? `Only ${digits} of 15 digits of an IMEI 1 could be read` : 'An IMEI 1 could only be read in part';
    return { title: 'Retake this photo', text: `${seen} (blur or glare). Retake the photo closer and sharper, or type the number from the label.`, short: 'IMEI 1 only partly read: retake the photo or type it.' };
  }
  return {
    title: 'Retake this photo',
    text: `${many ? `${missing} labels in this photo` : 'A label in this photo'} could not be read. Retake the photo, or crop the label yourself and check it.`,
    short: 'A label could not be read: retake the photo or crop it.'
  };
}

export function issueTextFor(record: IssueFields): IssueText | null {
  const kind = activeIssue(record);
  return kind ? issueText(kind, record.labelIssueSide, record.labelsMissing || 1, record.labelIssueDigits || 0) : null;
}
