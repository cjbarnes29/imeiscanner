// Is this camera frame good enough to read? Sharpness, glare and darkness are measured on a small grey copy, so it is
// cheap enough to run several times a second on a phone. The thresholds come from real label photos: sharp photos
// score 250-830 on the sharpness scale and deliberately blurred copies of the same photos score 2-10
// (scripts/calibrate-frame-quality.mjs prints the numbers).
export const BLUR_BELOW = 60;
export const SOFT_BELOW = 150;
export const GLARE_ABOVE = 4; // percent of near-white pixels
export const DARK_ABOVE = 50; // percent of near-black pixels

export type FrameQuality = {
  /** Variance of the Laplacian: bigger is sharper. */
  sharpness: number;
  glarePercent: number;
  darkPercent: number;
  level: 'good' | 'soft' | 'blurry' | 'glare' | 'dark';
  message: string;
};

/** Variance of the 3x3 Laplacian over a grey image. */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0, sum2 = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += laplacian; sum2 += laplacian * laplacian; count++;
    }
  }
  const mean = sum / count;
  return sum2 / count - mean * mean;
}

export function analyzeGray(gray: ArrayLike<number>, width: number, height: number): FrameQuality {
  const total = Math.max(1, width * height);
  let bright = 0, dark = 0;
  for (let i = 0; i < width * height; i++) { if (gray[i] >= 250) bright++; else if (gray[i] < 40) dark++; }
  const sharpness = Math.round(laplacianVariance(gray, width, height));
  const glarePercent = Math.round(bright / total * 1000) / 10, darkPercent = Math.round(dark / total * 1000) / 10;
  if (darkPercent >= DARK_ABOVE) return { sharpness, glarePercent, darkPercent, level: 'dark', message: 'Too dark: turn the flashlight on or add light.' };
  if (sharpness < BLUR_BELOW) return { sharpness, glarePercent, darkPercent, level: 'blurry', message: 'Blurry: hold steady, tap the label to focus, or move back a little.' };
  if (glarePercent >= GLARE_ABOVE) return { sharpness, glarePercent, darkPercent, level: 'glare', message: 'Glare: tilt the phone a little so the shine leaves the label.' };
  if (sharpness < SOFT_BELOW) return { sharpness, glarePercent, darkPercent, level: 'soft', message: 'A little soft: tap the label to focus.' };
  return { sharpness, glarePercent, darkPercent, level: 'good', message: 'Sharp and clear.' };
}

/** Analyse a video frame or picture: copied to a canvas of at most 480 px on the long side, then measured. */
export function analyzeImage(source: CanvasImageSource, width: number, height: number): FrameQuality {
  const scale = Math.min(1, 480 / Math.max(width, height));
  const w = Math.max(3, Math.round(width * scale)), h = Math.max(3, Math.round(height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, w, h);
  const pixels = context.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) | 0;
  return analyzeGray(gray, w, h);
}
