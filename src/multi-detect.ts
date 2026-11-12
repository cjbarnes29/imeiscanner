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
export function estimateSkewFromGray(gray: ArrayLike<number>, width: number, height: number, maxAngle = 15): { angle: number; gain: number } {
  if (width < 20 || height < 20) return { angle: 0, gain: 1 };
  let total = 0;
  for (let i = 0; i < width * height; i++) total += gray[i];
  const threshold = (total / (width * height)) * 0.78;
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

/** Overlapping tiles to read one by one: 2 products → 2 halves, 3 → thirds, 4 → 2×2, 5-6 → 3×2 (long side first). */
export function tileRects(width: number, height: number, products: number, overlap = 0.14): Rect[] {
  const landscape = width >= height;
  const [along, across] = products <= 2 ? [2, 1] : products === 3 ? [3, 1] : products === 4 ? [2, 2] : [3, 2];
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
