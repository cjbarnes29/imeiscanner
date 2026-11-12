// Image treatments for hard labels (blurry, dark, uneven light, tiny print), and the plan for which
// to try. The pixel functions work on plain grayscale arrays, so they can be tested without a browser.
// `renderVariant` is the only part that needs a canvas.

export type Gray = Uint8Array;
export type Variant = 'plain' | 'levels' | 'sharpen' | 'even-light' | 'adaptive' | 'invert' | 'upscale';
export type PicStats = { width: number; height: number; mean: number; spread: number; blur: number };

export function toGray(rgba: ArrayLike<number>, width: number, height: number): Gray {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114);
  return gray;
}

/** Summed-area table so any box average costs four lookups. */
function integral(gray: Gray, width: number, height: number): Float64Array {
  const sums = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  return sums;
}
function boxMean(sums: Float64Array, width: number, height: number, x: number, y: number, radius: number): number {
  const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius), x1 = Math.min(width, x + radius + 1), y1 = Math.min(height, y + radius + 1);
  const w = width + 1;
  return (sums[y1 * w + x1] - sums[y0 * w + x1] - sums[y1 * w + x0] + sums[y0 * w + x0]) / ((x1 - x0) * (y1 - y0));
}

/** Percentile of gray values (0-100). */
export function percentile(gray: Gray, pct: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const target = gray.length * pct / 100;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
  return 255;
}

/** Brightness, contrast spread (p95 - p5) and sharpness (variance of the Laplacian: low means blurry). */
export function pictureStats(gray: Gray, width: number, height: number): PicStats {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = gray.length ? sum / gray.length : 0;
  const spread = percentile(gray, 95) - percentile(gray, 5);
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      n++; s += lap; s2 += lap * lap;
    }
  }
  const blur = n ? s2 / n - (s / n) * (s / n) : 0;
  return { width, height, mean, spread, blur };
}

/** Stretch the gray range so the darkest 2% become black and the brightest 2% white. */
export function stretchLevels(gray: Gray, low = 2, high = 98): Gray {
  const lo = percentile(gray, low), hi = Math.max(lo + 1, percentile(gray, high));
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((gray[i] - lo) * 255 / (hi - lo))));
  return out;
}

/** Unsharp mask: add back the difference from a blurred copy. Helps soft, slightly out-of-focus print. */
export function unsharp(gray: Gray, width: number, height: number, amount = 1.4, radius = 2): Gray {
  const sums = integral(gray, width, height), out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, blurred = boxMean(sums, width, height, x, y, radius);
    out[i] = Math.max(0, Math.min(255, Math.round(gray[i] + (gray[i] - blurred) * amount)));
  }
  return out;
}

/** Divide out the slowly changing background (shadow, glare, a lamp on one side) so the print has even contrast. */
export function evenLight(gray: Gray, width: number, height: number, radius = Math.max(8, Math.round(Math.min(width, height) / 6))): Gray {
  const sums = integral(gray, width, height), out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, background = Math.max(1, boxMean(sums, width, height, x, y, radius));
    out[i] = Math.max(0, Math.min(255, Math.round(gray[i] / background * 190)));
  }
  return out;
}

/** Black and white by comparing each pixel with its neighbourhood. Strong against uneven light; can break thin strokes in very small print. */
export function adaptiveThreshold(gray: Gray, width: number, height: number, radius = Math.max(8, Math.round(Math.min(width, height) / 14)), offset = 8): Gray {
  const sums = integral(gray, width, height), out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    out[i] = gray[i] < boxMean(sums, width, height, x, y, radius) - offset ? 0 : 255;
  }
  return out;
}

export function invertGray(gray: Gray): Gray {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = 255 - gray[i];
  return out;
}

/** The treatments to try for this picture, most likely helpful first. `plain` is never repeated here (it was the first read). */
export function planPasses(stats: PicStats): Variant[] {
  const plan: Variant[] = [];
  const dark = stats.mean < 100, flat = stats.spread < 70, blurry = stats.blur < 60, small = Math.min(stats.width, stats.height) < 700;
  if (dark) plan.push('invert');
  if (flat) plan.push('levels');
  if (blurry) plan.push('sharpen');
  if (small) plan.push('upscale');
  plan.push('even-light', 'adaptive');
  for (const extra of ['levels', 'sharpen', 'upscale', 'invert'] as Variant[]) if (!plan.includes(extra)) plan.push(extra);
  return plan;
}

/** Apply one treatment to a gray picture. `upscale` and `plain` are size changes handled by the caller. */
export function applyVariant(variant: Variant, gray: Gray, width: number, height: number): Gray {
  switch (variant) {
    case 'levels': return stretchLevels(gray);
    case 'sharpen': return unsharp(stretchLevels(gray), width, height);
    case 'even-light': return stretchLevels(evenLight(gray, width, height));
    case 'adaptive': return adaptiveThreshold(gray, width, height);
    case 'invert': return stretchLevels(invertGray(gray));
    default: return gray;
  }
}

/** Browser only: a canvas with the treatment applied, upscaled so the print is at least ~1400 px across when it is small. */
export function renderVariant(source: HTMLCanvasElement, variant: Variant): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  const scale = variant === 'upscale' || longest < 1000 ? Math.min(3, Math.max(1, 1600 / longest)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (variant === 'plain' || variant === 'upscale') return canvas;
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const out = applyVariant(variant, toGray(frame.data, canvas.width, canvas.height), canvas.width, canvas.height);
  for (let i = 0; i < out.length; i++) { frame.data[i * 4] = frame.data[i * 4 + 1] = frame.data[i * 4 + 2] = out[i]; frame.data[i * 4 + 3] = 255; }
  context.putImageData(frame, 0, 0);
  return canvas;
}

export function canvasStats(source: HTMLCanvasElement): PicStats {
  const scale = Math.min(1, 600 / Math.max(source.width, source.height));
  const w = Math.max(8, Math.round(source.width * scale)), h = Math.max(8, Math.round(source.height * scale));
  const probe = document.createElement('canvas'); probe.width = w; probe.height = h;
  const context = probe.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, w, h);
  const stats = pictureStats(toGray(context.getImageData(0, 0, w, h).data, w, h), w, h);
  // Sharpness was measured on the reduced copy; report the real picture size.
  return { ...stats, width: source.width, height: source.height };
}
