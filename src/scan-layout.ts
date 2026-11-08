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
  const validBox = (box: OcrLine['bbox']) => [box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) && box.x1 > box.x0 && box.y1 > box.y0;
  const located = imeis.map(imei => {
    let matches = lines.filter(line => line.bbox && validBox(line.bbox) && line.text.replace(/\D/g, '').includes(imei));
    if (!matches.length) {
      // OCR sometimes wraps the number onto the line after "IMEI 1".
      const anchors = lines.filter(line => line.bbox && validBox(line.bbox) && /\bI\s*M\s*E\s*I\s*[:#-]?\s*1\b/i.test(line.text));
      matches = anchors.filter(anchor => {
        const nearby = lines.filter(line => line.bbox && validBox(line.bbox) &&
          Math.abs(line.bbox.y0 - anchor.bbox.y0) < Math.max(height * 0.035, (anchor.bbox.y1 - anchor.bbox.y0) * 2.5) &&
          line.bbox.x0 >= anchor.bbox.x0 - width * 0.03 && line.bbox.x0 <= anchor.bbox.x1 + width * 0.22);
        return nearby.map(line => line.text).join(' ').replace(/\D/g, '').includes(imei);
      });
    }
    if (!matches.length) return null;
    const boxes = matches.map(line => line.bbox);
    const box = { x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)), x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)) };
    return { imei, box, x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  });
  if (located.some(item => !item)) return [];
  const items = located as NonNullable<typeof located[number]>[];
  // Model text and IMEI 2 describe the same product, not another device. Keep
  // them inside the sticker/box search area when they belong to one anchor.
  const context = items.map(item => ({ ...item.box }));
  for (const line of lines) {
    if (!line.bbox || !validBox(line.bbox) || !(/\bmodel\s*[:：-]?\s*S\s*M\s*[-–—]?/i.test(line.text) || /\bI\s*M\s*E\s*I\s*[:#-]?\s*2\b/i.test(line.text))) continue;
    const cx = (line.bbox.x0 + line.bbox.x1) / 2, cy = (line.bbox.y0 + line.bbox.y1) / 2;
    const distances = items.map(item => Math.hypot((cx - item.x) / width, (cy - item.y) / height));
    const closest = distances.indexOf(Math.min(...distances));
    const next = Math.min(...distances.filter((_, i) => i !== closest));
    if (distances[closest] > 0.42 || distances[closest] >= next * 0.8) continue;
    const box = context[closest];
    box.x0 = Math.min(box.x0, line.bbox.x0); box.y0 = Math.min(box.y0, line.bbox.y0);
    box.x1 = Math.max(box.x1, line.bbox.x1); box.y1 = Math.max(box.y1, line.bbox.y1);
  }
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
  const edge = (major: number, mode: 'start' | 'end' | 'seam', slope = 0) => {
    let strength = 0, coverage = 0, count = 0;
    for (let minor = minorMin; minor < minorMax; minor += 2) {
      let before = 0, after = 0;
      const tilted = Math.round(major + slope * (minor - (minorMin + minorMax) / 2) / minorSteps);
      for (let offset = 3; offset <= 7; offset++) { before += sample(tilted - offset, minor); after += sample(tilted + offset, minor); }
      before /= 5; after /= 5;
      const delta = mode === 'start' ? after - before : mode === 'end' ? before - after : (before + after) / 2 - sample(tilted, minor);
      strength += delta; if (delta > 25) coverage++; count++;
    }
    return count ? { strength: strength / count, coverage: coverage / count } : { strength: 0, coverage: 0 };
  };
  const findEdge = (from: number, to: number, mode: 'start' | 'end' | 'seam'): { position: number; tilt: number } | null => {
    let best: { position: number; tilt: number } | null = null, score = 0;
    // Most photos are straight. Try the cheap straight pass first; only search
    // sloped boundaries when it cannot find a reliable one.
    for (const slopes of [[0], [-0.12, -0.08, -0.04, 0.04, 0.08, 0.12].map(fraction => fraction * majorSteps)]) {
      for (let step = Math.max(8, Math.ceil(from / majorScale)); step < Math.min(majorSteps - 8, Math.floor(to / majorScale)); step++) {
        for (const slope of slopes) {
        const result = edge(step, mode, slope);
        if (result.coverage >= 0.65 && result.strength >= 22 && result.strength * result.coverage > score) {
          best = { position: Math.round(step * majorScale), tilt: slope * majorScale * (minorMax - minorMin) / (2 * minorSteps) };
          score = result.strength * result.coverage;
        }
        }
      }
      if (best) break;
    }
    return best;
  };
  const startOf = (item: typeof items[number]) => vertical ? context[items.indexOf(item)].y0 : context[items.indexOf(item)].x0;
  const endOf = (item: typeof items[number]) => vertical ? context[items.indexOf(item)].y1 : context[items.indexOf(item)].x1;
  const seams: { position: number; tilt: number }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const seam = findEdge(endOf(ordered[i - 1]), startOf(ordered[i]), 'seam');
    if (!seam) return []; // May be a shared sticker; never cut blindly.
    seams.push(seam);
  }
  const first = ordered[0], last = ordered[ordered.length - 1];
  const start = findEdge(Math.max(0, startOf(first) - extent * 0.4), startOf(first) - extent * 0.025, 'start');
  const end = findEdge(endOf(last) + extent * 0.025, Math.min(extent, endOf(last) + extent * 0.4), 'end');
  const fallbackMargin = (item: typeof items[number]) => Math.min(extent * 0.25, Math.max(extent * 0.08, (endOf(item) - startOf(item)) * 1.8));
  const firstBound = start ? Math.max(0, Math.floor(start.position - Math.abs(start.tilt) - majorScale * 2)) : Math.max(0, Math.floor(startOf(first) - fallbackMargin(first)));
  const lastBound = end ? Math.min(extent, Math.ceil(end.position + Math.abs(end.tilt) + majorScale * 2)) : Math.min(extent, Math.ceil(endOf(last) + fallbackMargin(last)));
  // Find the two side edges of each box face across the whole region. Barcode
  // strokes are short; a box edge continues through much of the crop height.
  const sideSteps = Math.min(300, minorExtent);
  const sideScale = minorExtent / sideSteps;
  const sideContrast = (minor: number, from: number, to: number) => {
    let strong = 0, total = 0, sum = 0;
    const inset = Math.max(2, Math.round(sideScale * 3));
    for (let major = from + (to - from) * 0.1; major < to - (to - from) * 0.1; major += Math.max(3, (to - from) / 35)) {
      const sampleColor = (side: number) => {
        const x = Math.max(0, Math.min(width - 1, Math.round(vertical ? side : major)));
        const y = Math.max(0, Math.min(height - 1, Math.round(vertical ? major : side)));
        const index = (y * width + x) * 4;
        return [frame.data[index], frame.data[index + 1], frame.data[index + 2]];
      };
      const before = sampleColor(minor - inset), after = sampleColor(minor + inset);
      const delta = (Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]) + Math.abs(before[2] - after[2])) / 3;
      if (delta > 30) strong++;
      sum += delta; total++;
    }
    return total ? { coverage: strong / total, strength: sum / total } : { coverage: 0, strength: 0 };
  };
  const sideEdge = (from: number, to: number, majorFrom: number, majorTo: number) => {
    let best = -1, bestScore = 0;
    for (let step = Math.max(2, Math.ceil(from / sideScale)); step <= Math.min(sideSteps - 2, Math.floor(to / sideScale)); step++) {
      const position = step * sideScale;
      const contrast = sideContrast(position, majorFrom, majorTo);
      const score = contrast.coverage * contrast.strength;
      if (contrast.coverage >= 0.55 && contrast.strength >= 28 && score > bestScore) {
        best = position; bestScore = score;
      }
    }
    return best;
  };
  const regions = ordered.map((item, i) => {
    // A slanted seam needs a rectangular envelope. If that envelope reaches
    // the neighbouring IMEI 1 text, the final safety check rejects the split.
    const from = i ? Math.max(0, Math.floor(seams[i - 1].position - Math.abs(seams[i - 1].tilt))) : firstBound;
    const to = i < seams.length ? Math.min(extent, Math.ceil(seams[i].position + Math.abs(seams[i].tilt))) : lastBound;
    const productBox = context[items.indexOf(item)];
    const labelStart = vertical ? productBox.x0 : productBox.y0;
    const labelEnd = vertical ? productBox.x1 : productBox.y1;
    const sidePadding = minorExtent * 0.06;
    const left = sideEdge(Math.max(0, labelStart - minorExtent * 0.42), Math.max(0, labelStart - sidePadding), from, to);
    const right = sideEdge(Math.min(minorExtent, labelEnd + sidePadding), Math.min(minorExtent, labelEnd + minorExtent * 0.42), from, to);
    const sideFrom = left < 0 ? 0 : Math.max(0, Math.floor(left - minorExtent * 0.025));
    const sideTo = right < 0 ? minorExtent : Math.min(minorExtent, Math.ceil(right + minorExtent * 0.025));
    const needsReview = (i === 0 && !start) || (i === ordered.length - 1 && !end) || left < 0 || right < 0 || seams.some(seam => Math.abs(seam.tilt) > extent * 0.025);
    return vertical ? { imei: item.imei, x: sideFrom, y: from, width: sideTo - sideFrom, height: to - from, needsReview } : { imei: item.imei, x: from, y: sideFrom, width: to - from, height: sideTo - sideFrom, needsReview };
  });
  return regions.every((region, i) => region.width > 0 && region.height > 0 &&
    region.x <= context[items.indexOf(ordered[i])].x0 && region.x + region.width >= context[items.indexOf(ordered[i])].x1 &&
    region.y <= context[items.indexOf(ordered[i])].y0 && region.y + region.height >= context[items.indexOf(ordered[i])].y1 &&
    ordered.every((_, j) => {
      if (i === j) return true;
      const other = context[items.indexOf(ordered[j])];
      return other.x0 >= region.x + region.width || other.x1 <= region.x || other.y0 >= region.y + region.height || other.y1 <= region.y;
    })) ? regions : [];
}
