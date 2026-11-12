// Confidence score (0-100) for one scanned record, with the reasons. Low scores ask for a manual look.
export type ConfidenceInput = {
  imei: string;
  luhnOk: boolean;
  barcodeConfirmed: boolean;
  imei2Valid: boolean;
  serial: string;
  serialNeedsReview?: boolean;
  model: string;
  catalogMatched: boolean;
  duplicate: boolean;
  cropNeedsReview?: boolean;
};
export type Confidence = { score: number; level: 'high' | 'medium' | 'low'; reasons: string[] };

export function scoreConfidence(input: ConfidenceInput): Confidence {
  const reasons: string[] = [];
  let score = 0;
  const hasImei = /^\d{15}$/.test(input.imei);
  if (hasImei && input.luhnOk) { score += 55; reasons.push('IMEI checksum is valid'); }
  else if (hasImei) reasons.push('IMEI checksum is NOT valid');
  else reasons.push('No IMEI read');
  if (hasImei && input.barcodeConfirmed) { score += 15; reasons.push('IMEI confirmed by the barcode'); }
  if (input.imei2Valid) { score += 5; reasons.push('IMEI 2 is valid'); }
  if (input.serial) {
    if (input.serialNeedsReview) { score += 2; reasons.push('Serial needs a check'); }
    else { score += 10; reasons.push('Serial read'); }
  }
  const knownCode = /SM\s*-?\s*[A-Z]\d{3}/i.test(input.model);
  if (input.catalogMatched) { score += 10; reasons.push('Model matches the Samsung catalog'); }
  else if (knownCode) { score += 5; reasons.push('Model code read, not in the catalog'); }
  else reasons.push('Model unknown');
  if (!input.cropNeedsReview) score += 5; else { score -= 25; reasons.push('Crop or device count needs a check'); }
  if (input.duplicate) { score -= 15; reasons.push('Same IMEI appears more than once'); }
  if (!hasImei) score = Math.min(score, 45);
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low', reasons };
}
