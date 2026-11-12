// Helpers for photos with several products: straighten tilted pictures and read a photo in
// overlapping tiles when the whole-photo read finds fewer products than expected.
// Document scanners (CamScanner, Adobe Scan, Google's document scanner) do the same two things:
// find the page edges / text lines, undo the tilt, and look closer where detection is weak.
import type { OcrLine } from './scan-layout';

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * How far a picture is tilted, in degrees (positive: text lines run downward to the right).
 * Projection profile: dark "ink" pixels are shifted by each trial angle and counted per row;
 * the angle where the rows are most sharply separated is the angle of the text lines.
 */
export function estimateSkewFromGray(gray: ArrayLike<number>, width: number, height: number, maxAngle = 15, inkRatio = 0.78): { angle: number; gain: number } {
  if (width < 20 || height < 20) return { angle: 0, gain: 1 };
  let total = 0;
  for (let i = 0; i < width * height; i++) total += gray[i];
  const threshold = (total / (width * height)) * inkRatio;
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (gray[y * width + x] < threshold) { xs.push(x - width / 2); ys.push(y); }
  if (xs.length < 200) return { angle: 0, gain: 1 };
  // Keep the work bounded: sample at most ~40000 ink pixels.
  const step = Math.max(1, Math.floor(xs.length / 40000));
  const bins = new Float64Array(Math.ceil(height + width * 0.6) + 4);
  const score = (degrees: number) => {
    const tan = Math.tan(degrees * Math.PI / 180), offset = Math.ceil(width * 0.3) + 2;
    bins.fill(0);
    for (let i = 0; i < xs.length; i += step) bins[Math.round(ys[i] - xs[i] * tan) + offset]++;
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
    return sum;
  };
  const base = score(0);
  let best = 0, bestScore = base;
  for (let a = -maxAngle; a <= maxAngle; a += 1) { const s = score(a); if (s > bestScore) { bestScore = s; best = a; } }
  for (let a = best - 1; a <= best + 1; a += 0.25) { const s = score(a); if (s > bestScore) { bestScore = s; best = a; } }
  return { angle: best, gain: base > 0 ? bestScore / base : 1 };
}

/** The picture turned by -skew degrees so its text lines run level. The corners are filled with the edge colour. */
export function straightenCanvas(source: HTMLCanvasElement | HTMLImageElement, skewDegrees: number): HTMLCanvasElement {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const radians = -skewDegrees * Math.PI / 180, cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * cos + h * sin)); canvas.height = Math.max(1, Math.round(w * sin + h * cos));
  const context = canvas.getContext('2d')!;
  // Edge colour: average of a tiny copy of the picture.
  const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
  const pc = probe.getContext('2d')!; pc.drawImage(source, 0, 0, 1, 1);
  const [r, g, b] = pc.getImageData(0, 0, 1, 1).data;
  context.fillStyle = `rgb(${r},${g},${b})`; context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(radians);
  context.drawImage(source, -w / 2, -h / 2);
  return canvas;
}

/** Straighten a picture if it is clearly tilted (about 1° to 15°). Returns the same picture when it is already level. */
export async function straightenDataUrl(dataUrl: string, quality = 0.9): Promise<{ dataUrl: string; angle: number }> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
    const w = Math.max(1, Math.round(image.naturalWidth * scale)), h = Math.max(1, Math.round(image.naturalHeight * scale));
    const small = document.createElement('canvas'); small.width = w; small.height = h;
    const context = small.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, w, h);
    const pixels = context.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) | 0;
    const { angle, gain } = estimateSkewFromGray(gray, w, h);
    if (Math.abs(angle) < 1 || gain < 1.06) return { dataUrl, angle: 0 };
    return { dataUrl: straightenCanvas(image, angle).toDataURL('image/jpeg', quality), angle };
  } catch { return { dataUrl, angle: 0 }; }
}

/**
 * Tiles of about `side` pixels covering the whole picture, with overlap, for photos too big to read in one go.
 * The tile count does not depend on how many products were found (that count comes from the weak whole-photo read);
 * it depends on the photo size alone. At most `maxTiles`: beyond that the tiles simply grow.
 */
export function gridTileRects(width: number, height: number, side = 1300, overlap = 0.14, maxTiles = 12): Rect[] {
  let cols = Math.max(1, Math.ceil(width / side)), rows = Math.max(1, Math.ceil(height / side));
  while (cols * rows > maxTiles) { if (cols / width * height > rows) cols--; else rows--; if (cols < 1) cols = 1; if (rows < 1) rows = 1; }
  const tw = width / cols, th = height / rows, tiles: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = Math.max(0, c * tw - (c ? tw * overlap : 0)), x1 = Math.min(width, (c + 1) * tw + (c < cols - 1 ? tw * overlap : 0));
    const y0 = Math.max(0, r * th - (r ? th * overlap : 0)), y1 = Math.min(height, (r + 1) * th + (r < rows - 1 ? th * overlap : 0));
    tiles.push({ x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) });
  }
  return tiles;
}

/** Median height of the read text lines: small values mean the labels are small in the picture and need a closer look. */
export function medianLineHeight(lines: OcrLine[]): number {
  const heights = lines.map(line => line.bbox.y1 - line.bbox.y0).filter(h => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : 0;
}

/** Overlapping tiles to read one by one: 2 products → 2 halves, 3 → thirds, 4 → 2×2, 5-6 → 3×2 (long side first). */
export function tileRects(width: number, height: number, products: number, overlap = 0.14): Rect[] {
  const landscape = width >= height;
  const [along, across] = products <= 2 ? [2, 1] : products === 3 ? [3, 1] : products === 4 ? [2, 2] : products <= 6 ? [3, 2] : products <= 8 ? [4, 2] : products === 9 ? [3, 3] : [4, 3];
  const cols = landscape ? along : across, rows = landscape ? across : along;
  const tiles: Rect[] = [];
  const tw = width / cols, th = height / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = Math.max(0, c * tw - (c ? tw * overlap : 0)), x1 = Math.min(width, (c + 1) * tw + (c < cols - 1 ? tw * overlap : 0));
    const y0 = Math.max(0, r * th - (r ? th * overlap : 0)), y1 = Math.min(height, (r + 1) * th + (r < rows - 1 ? th * overlap : 0));
    tiles.push({ x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) });
  }
  return tiles;
}

const digitsOf = (text: string) => text.replace(/\D/g, '');
function overlapShare(a: OcrLine['bbox'], b: OcrLine['bbox']) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return smaller > 0 ? (w * h) / smaller : 0;
}
/** Adds lines from a second read, skipping ones that repeat a line already known (same place, same digits or text). */
export function mergeOcrLines(base: OcrLine[], extra: OcrLine[]): OcrLine[] {
  const merged = [...base];
  for (const line of extra) {
    const repeat = merged.some(known => overlapShare(known.bbox, line.bbox) > 0.5 && (digitsOf(known.text) === digitsOf(line.text) || known.text.trim() === line.text.trim()));
    if (!repeat) merged.push(line);
  }
  return merged;
}

/** Turn the photo only when another angle reads clearly better than the current one (a weak read of junk must not block the check). */
export function shouldTurn(currentScore: number, bestScore: number): boolean {
  return bestScore >= 2 && bestScore >= currentScore + 2;
}
/** The photo needs an orientation check unless the current read already looks like a label (several label words / numbers found). */
export function needsOrientationCheck(score: number): boolean { return score < 4; }

/**
 * Products visible in a photo, guessed from lines printed once per label: "Model : SM-…", the long model code
 * (SM-A165FZADMEA), the storage line (4GB | 128GB) and the "S/N :" line. Each kind is counted (lines in the same
 * place count once) and the highest count wins, so one misread line does not hide a label.
 */
const ONE_PER_LABEL = [
  /m[o0]del\s*[:;.]?\s*s\s*m/i,
  /s\s*m\s*-\s*[a-z0-9]{4,5}[a-z]{2,}/i,
  /\b\d{1,2}\s*gb\s*[|!Il]\s*\d{2,4}\s*gb\b/i,
  /\bs\s*[/|]\s*n\s*[:;.]/i,
];
export function countModelLabels(lines: OcrLine[]): number {
  let best = 0;
  for (const pattern of ONE_PER_LABEL) {
    const found: { y: number; x: number }[] = [];
    for (const line of lines) {
      if (!pattern.test(line.text) || !line.bbox) continue;
      const y = (line.bbox.y0 + line.bbox.y1) / 2, h = Math.max(1, line.bbox.y1 - line.bbox.y0);
      const x = (line.bbox.x0 + line.bbox.x1) / 2;
      if (!found.some(known => Math.abs(known.y - y) < h * 1.5 && Math.abs(known.x - x) < h * 6)) found.push({ y, x });
    }
    best = Math.max(best, found.length);
  }
  return best;
}

/** Tilt of a whole canvas (degrees, positive: text runs downward to the right) and how sure the estimate is. */
export function skewOfCanvas(canvas: HTMLCanvasElement, inkRatio = 0.78): { angle: number; gain: number } {
  const scale = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale)), h = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement('canvas'); small.width = w; small.height = h;
  const context = small.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, w, h);
  const pixels = context.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) | 0;
  return estimateSkewFromGray(gray, w, h, 15, inkRatio);
}

/** Where a point of the original picture lands after `straightenCanvas(picture, skew)` (pixels). */
export function levelledPoint(point: { x: number; y: number }, skewDegrees: number, width: number, height: number) {
  const radians = -skewDegrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const newW = width * Math.abs(cos) + height * Math.abs(sin), newH = width * Math.abs(sin) + height * Math.abs(cos);
  const dx = point.x - width / 2, dy = point.y - height / 2;
  return { x: newW / 2 + dx * cos - dy * sin, y: newH / 2 + dx * sin + dy * cos };
}

/** The reverse: a point of the levelled picture back in the original picture's pixels. */
export function originalPoint(point: { x: number; y: number }, skewDegrees: number, width: number, height: number) {
  const radians = -skewDegrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const newW = width * Math.abs(cos) + height * Math.abs(sin), newH = width * Math.abs(sin) + height * Math.abs(cos);
  const dx = point.x - newW / 2, dy = point.y - newH / 2;
  return { x: width / 2 + dx * cos + dy * sin, y: height / 2 - dx * sin + dy * cos };
}

/**
 * A box found on the levelled copy of a tilted photo (in % of that copy), as the smallest upright box on the
 * ORIGINAL photo (in % of it) that holds it. Each crop is levelled again when it is cut, so the extra
 * background in the corners does no harm.
 */
export function unlevelBox(box: Rect, skewDegrees: number, originalWidth: number, originalHeight: number): Rect {
  const radians = skewDegrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  const levelW = originalWidth * cos + originalHeight * sin, levelH = originalWidth * sin + originalHeight * cos;
  const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
    .map(([x, y]) => originalPoint({ x: x / 100 * levelW, y: y / 100 * levelH }, skewDegrees, originalWidth, originalHeight));
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const x0 = clamp(Math.min(...corners.map(c => c.x)), originalWidth), x1 = clamp(Math.max(...corners.map(c => c.x)), originalWidth);
  const y0 = clamp(Math.min(...corners.map(c => c.y)), originalHeight), y1 = clamp(Math.max(...corners.map(c => c.y)), originalHeight);
  return { x: x0 / originalWidth * 100, y: y0 / originalHeight * 100, width: (x1 - x0) / originalWidth * 100, height: (y1 - y0) / originalHeight * 100 };
}
