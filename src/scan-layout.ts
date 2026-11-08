export type OcrLine = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type CropRegion = { imei: string; x: number; y: number; width: number; height: number; needsReview?: boolean };
export type PixelFrame = { data: ArrayLike<number>; width: number; height: number };

export function exportModel(model: string) {
  const value = model.trim();
  return /^unknown\b/i.test(value) || /^series\s*[—-]\s*review$/i.test(value) ? '' : value;
}

/** Use visible, high-coverage edges to separate distinct label groups. */
export function planImeiCrops(imeis: string[], lines: OcrLine[], width: number, height: number, frame?: PixelFrame): CropRegion[] {
  if (imeis.length < 2 || width <= 0 || height <= 0 || !frame || frame.width !== width || frame.height !== height) return [];
  const located = imeis.map(imei => {
    const matches = lines.filter(line => line.bbox && line.text.replace(/\D/g, '').includes(imei));
    if (!matches.length) return null;
    const boxes = matches.map(line => line.bbox);
    if (boxes.some(box => ![box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) || box.x1 <= box.x0 || box.y1 <= box.y0)) return null;
    const box = { x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)), x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)) };
    return { imei, box, x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  });
  if (located.some(item => !item)) return [];
  const items = located as NonNullable<typeof located[number]>[];
  const spreadX = (Math.max(...items.map(item => item.x)) - Math.min(...items.map(item => item.x))) / width;
  const spreadY = (Math.max(...items.map(item => item.y)) - Math.min(...items.map(item => item.y))) / height;
  const canSeparate = (vertical: boolean) => {
    const sorted = [...items].sort((a, b) => vertical ? a.y - b.y : a.x - b.x);
    return sorted.every((item, i) => !i || (vertical ? item.box.y0 >= sorted[i - 1].box.y1 : item.box.x0 >= sorted[i - 1].box.x1));
  };
  let vertical = spreadY >= spreadX;
  if (!canSeparate(vertical)) { vertical = !vertical; if (!canSeparate(vertical)) return []; }
  const ordered = [...items].sort((a, b) => vertical ? a.y - b.y : a.x - b.x);
  const extent = vertical ? height : width;
  const minorExtent = vertical ? width : height;
  const majorSteps = Math.min(320, extent), minorSteps = Math.min(240, minorExtent);
  const majorScale = extent / majorSteps, minorScale = minorExtent / minorSteps;
  const minorMin = Math.max(0, Math.floor((Math.min(...items.map(item => vertical ? item.box.x0 : item.box.y0)) - minorExtent * 0.15) / minorScale));
  const minorMax = Math.min(minorSteps, Math.ceil((Math.max(...items.map(item => vertical ? item.box.x1 : item.box.y1)) + minorExtent * 0.15) / minorScale));
  const sample = (major: number, minor: number) => {
    const m = Math.max(0, Math.min(majorSteps - 1, major));
    const a = Math.min(extent - 1, Math.floor((m + 0.5) * majorScale));
    const b = Math.min(minorExtent - 1, Math.floor((minor + 0.5) * minorScale));
    const index = ((vertical ? a : b) * width + (vertical ? b : a)) * 4;
    return (frame.data[index] + frame.data[index + 1] + frame.data[index + 2]) / 3;
  };
  const edge = (major: number, mode: 'start' | 'end' | 'seam') => {
    let strength = 0, coverage = 0, count = 0;
    for (let minor = minorMin; minor < minorMax; minor += 2) {
      let before = 0, after = 0;
      for (let offset = 3; offset <= 7; offset++) { before += sample(major - offset, minor); after += sample(major + offset, minor); }
      before /= 5; after /= 5;
      const delta = mode === 'start' ? after - before : mode === 'end' ? before - after : (before + after) / 2 - sample(major, minor);
      strength += delta; if (delta > 25) coverage++; count++;
    }
    return count ? { strength: strength / count, coverage: coverage / count } : { strength: 0, coverage: 0 };
  };
  const findEdge = (from: number, to: number, mode: 'start' | 'end' | 'seam') => {
    let best = -1, score = 0;
    for (let step = Math.max(8, Math.ceil(from / majorScale)); step < Math.min(majorSteps - 8, Math.floor(to / majorScale)); step++) {
      const result = edge(step, mode);
      if (result.coverage >= 0.65 && result.strength >= 22 && result.strength * result.coverage > score) {
        best = Math.round(step * majorScale); score = result.strength * result.coverage;
      }
    }
    return best;
  };
  const startOf = (item: typeof items[number]) => vertical ? item.box.y0 : item.box.x0;
  const endOf = (item: typeof items[number]) => vertical ? item.box.y1 : item.box.x1;
  const seams: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const seam = findEdge(endOf(ordered[i - 1]), startOf(ordered[i]), 'seam');
    if (seam < 0) return []; // May be a shared sticker; never cut blindly.
    seams.push(seam);
  }
  const first = ordered[0], last = ordered[ordered.length - 1];
  const start = findEdge(Math.max(0, startOf(first) - extent * 0.4), startOf(first) - extent * 0.025, 'start');
  const end = findEdge(endOf(last) + extent * 0.025, Math.min(extent, endOf(last) + extent * 0.4), 'end');
  const bounds = [start < 0 ? Math.max(0, Math.floor(startOf(first) - extent * 0.2)) : Math.max(0, start - Math.ceil(majorScale * 2)), ...seams, end < 0 ? Math.min(extent, Math.ceil(endOf(last) + extent * 0.2)) : Math.min(extent, end + Math.ceil(majorScale * 2))];
  const regions = ordered.map((item, i) => {
    const from = bounds[i], to = bounds[i + 1];
    const needsReview = (i === 0 && start < 0) || (i === ordered.length - 1 && end < 0);
    return vertical ? { imei: item.imei, x: 0, y: from, width, height: to - from, needsReview } : { imei: item.imei, x: from, y: 0, width: to - from, height, needsReview };
  });
  return regions.every(region => region.width > 0 && region.height > 0) ? regions : [];
}
