// Separating products when the seam-based planner cannot: every label prints one "Model : SM-…" line (or long model code,
// storage line, S/N line), so those lines are seeds, one per product. Products may be stacked, side by side, or in a grid
// (two columns of stacked boxes), so the seeds are split into columns first and each column is cut between one product's
// last label line and the next product's seed. Every cut falls in the gap between two labels' text, never through it.
import type { CropRegion, OcrLine, PixelFrame } from './scan-layout';

export type Seed = { x0: number; y0: number; x1: number; y1: number; kind: number };

/** Where in a label each kind of seed line sits below the label's top, in text-line heights. */
const KIND_OFFSET = [0, 1.6, 3, 5];
const KINDS = [
  /m[o0]del\s*[:;.]?\s*s\s*m/i,
  /s\s*m\s*-\s*[a-z0-9]{4,5}[a-z]{2,}/i,
  /\b\d{1,2}\s*gb\s*[|!Il]\s*\d{2,4}\s*gb\b/i,
  /\bs\s*[/|]\s*n\s*[:;.]/i,
];

/** One seed per product: the kind of line that is found most often (ties go to the Model line); repeats of the same line count once. */
export function labelSeeds(lines: OcrLine[], width = 0): Seed[] {
  let best: Seed[] = [];
  KINDS.forEach((pattern, kind) => {
    const found: Seed[] = [];
    for (const line of lines) {
      const b = line.bbox;
      if (!b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) || b.y1 <= b.y0 || !pattern.test(line.text)) continue;
      const h = b.y1 - b.y0;
      // The same line read twice (whole photo and an overlapping tile) lands a little apart: products in one row are far further apart.
      if (!found.some(known => Math.abs(known.y0 - b.y0) < h * 1.5 && Math.abs(known.x0 - b.x0) < Math.max(h * 6, width * 0.12))) found.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, kind });
    }
    if (found.length > best.length) best = found;
  });
  return best;
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * One crop per seed. Returns [] unless every seed gets its own non-overlapping region, so a doubtful layout is never cut blindly.
 * All regions are marked for review: they come from text positions, not from seen box edges.
 */
export function seedCrops(lines: OcrLine[], seeds: Seed[], width: number, height: number, frame?: PixelFrame): CropRegion[] {
  return seedPlan(lines, seeds, width, height, frame).regions;
}

/** Same as seedCrops, with the reason when no plan was made (for tests and diagnostics). */
export function seedPlan(lines: OcrLine[], seeds: Seed[], width: number, height: number, frame?: PixelFrame): { regions: CropRegion[]; why: string } {
  const fail = (why: string) => ({ regions: [] as CropRegion[], why });
  if (seeds.length < 2 || width <= 0 || height <= 0) return fail('fewer than two seeds');
  const valid = lines.filter(l => l.bbox && [l.bbox.x0, l.bbox.y0, l.bbox.x1, l.bbox.y1].every(Number.isFinite) && l.bbox.y1 > l.bbox.y0 && l.bbox.x1 > l.bbox.x0);
  const lineH = Math.max(4, median(valid.map(l => l.bbox.y1 - l.bbox.y0)));
  const top = (s: Seed) => Math.max(0, s.y0 - KIND_OFFSET[s.kind] * lineH);

  // Columns: seeds whose left edges are close belong together.
  const byX = seeds.map((s, i) => ({ s, i })).sort((a, b) => a.s.x0 - b.s.x0);
  const gap = Math.max(width * 0.15, lineH * 8);
  const columns: { s: Seed; i: number }[][] = [];
  for (const item of byX) {
    const last = columns[columns.length - 1];
    if (last && item.s.x0 - Math.min(...last.map(m => m.s.x0)) <= gap) last.push(item); else columns.push([item]);
  }
  const colLeftEdge = columns.map(c => Math.min(...c.map(m => m.s.x0)));
  const colOf = (x0: number) => { let c = 0; for (let i = 0; i < columns.length; i++) if (x0 >= colLeftEdge[i] - width * 0.04) c = i; return c; };

  // Column limits. The OCR often joins text across the gap between two columns into one line, so text edges cannot say where
  // one column ends. With the picture at hand, cut where it is emptiest (fewest dark pixels) between the two columns' labels.
  const colLines = columns.map((_, c) => valid.filter(l => colOf(l.bbox.x0) === c));
  const limits: number[] = [0];
  for (let c = 1; c < columns.length; c++) {
    const lo = colLeftEdge[c - 1] + (colLeftEdge[c] - colLeftEdge[c - 1]) * 0.3, hi = colLeftEdge[c] - width * 0.01;
    const valley = frame && frame.width === width && frame.height === height ? emptiestX(frame, lo, hi) : -1;
    if (valley >= 0) { limits.push(Math.round(valley)); continue; }
    const right = Math.max(...colLines[c - 1].map(l => l.bbox.x1), colLeftEdge[c - 1]);
    const left = Math.min(...colLines[c].map(l => l.bbox.x0), colLeftEdge[c]);
    if (left <= right) return fail(`columns ${c - 1} and ${c} overlap and there is no picture to find the gap`);
    limits.push(Math.round((right + left) / 2));
  }  limits.push(width);

  const regions: (CropRegion & { seed: number })[] = [];
  for (let c = 0; c < columns.length; c++) {
    const rows = [...columns[c]].sort((a, b) => a.s.y0 - b.s.y0);
    const pitch = rows.length > 1 ? median(rows.slice(1).map((r, k) => top(r.s) - top(rows[k].s))) : height * 0.25;
    const inColumn = colLines[c];
    const tops = rows.map(r => top(r.s));
    // The text of each product: lines from its own top down to the next product's top.
    const ends = rows.map((_, k) => {
      const lower = k + 1 < rows.length ? tops[k + 1] : height;
      const mine = inColumn.filter(l => (l.bbox.y0 + l.bbox.y1) / 2 >= tops[k] && (l.bbox.y0 + l.bbox.y1) / 2 < lower);
      return mine.length ? Math.max(...mine.map(l => l.bbox.y1)) : tops[k] + lineH * 8;
    });
    for (let k = 0; k < rows.length; k++) {
      const from = k === 0 ? Math.max(0, tops[0] - pitch * 0.2) : Math.round((ends[k - 1] + tops[k]) / 2);
      const to = k === rows.length - 1 ? Math.min(height, ends[k] + pitch * 0.25) : Math.round((ends[k] + tops[k + 1]) / 2);
      if (to - from < lineH * 4 || from >= to) return fail(`region too short in column  row  (-)`);
      const x = limits[c], w = limits[c + 1] - limits[c];
      regions.push({ imei: `seed-${rows[k].i + 1}`, x: Math.round(x), y: Math.round(from), width: Math.round(w), height: Math.round(to - from), needsReview: true, seed: rows[k].i });
    }
  }
  // Every seed's own text must lie inside its region and regions must not overlap.
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i], s = seeds[r.seed];
    if (s.x0 < r.x || s.x0 > r.x + r.width) return fail(`seed ${r.seed} outside its column`);
    // A seed a little outside its rows (the offsets above are estimates): grow the region to hold it; overlaps are rejected below.
    if (s.y0 < r.y) { r.height += r.y - Math.floor(s.y0); r.y = Math.floor(s.y0); }
    if (s.y1 > r.y + r.height) r.height = Math.ceil(s.y1) - r.y;
    for (let j = i + 1; j < regions.length; j++) {
      const o = regions[j];
      if (r.x < o.x + o.width && o.x < r.x + r.width && r.y < o.y + o.height && o.y < r.y + r.height) return fail('regions overlap');
    }
  }
  return { regions: regions.sort((a, b) => a.seed - b.seed).map(({ seed: _seed, ...region }) => region), why: '' };
}

/** The x between `from` and `to` where the picture has the fewest dark pixels (a gap between two stacks of boxes). -1 when unclear. */
function emptiestX(frame: PixelFrame, from: number, to: number): number {
  const { width, height, data } = frame;
  const x0 = Math.max(0, Math.floor(from)), x1 = Math.min(width - 1, Math.floor(to));
  if (x1 - x0 < 6) return -1;
  let total = 0, count = 0;
  const rowStep = Math.max(1, Math.floor(height / 300));
  for (let y = 0; y < height; y += rowStep * 4) for (let x = 0; x < width; x += 4) { const i = (y * width + x) * 4; total += (data[i] + data[i + 1] + data[i + 2]) / 3; count++; }
  const dark = (total / Math.max(1, count)) * 0.78;
  const ink = new Float64Array(x1 - x0 + 1);
  for (let x = x0; x <= x1; x++) { let n = 0, m = 0; for (let y = 0; y < height; y += rowStep) { const i = (y * width + x) * 4; if ((data[i] + data[i + 1] + data[i + 2]) / 3 < dark) n++; m++; } ink[x - x0] = n / Math.max(1, m); }
  const win = Math.max(3, Math.round((x1 - x0) * 0.08));
  let best = -1, bestSum = Infinity;
  for (let x = 0; x + win <= ink.length; x++) { let s = 0; for (let k = 0; k < win; k++) s += ink[x + k]; if (s < bestSum) { bestSum = s; best = x; } }
  return best < 0 ? -1 : x0 + best + win / 2;
}