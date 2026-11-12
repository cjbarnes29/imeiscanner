// Box model for the crop editor. Pure functions, no DOM: every box is in % of the photo (0-100).
// The editor counts boxes automatically, so there is no "how many?" number to keep in step.

export type Box = { x: number; y: number; width: number; height: number };
export type Part = 'body' | 'nw' | 'ne' | 'sw' | 'se';
export type Hit = { index: number; part: Part } | null;

/** Smallest box edge, in % of the photo. Anything smaller is a stray tap, not a label. */
export const MIN_EDGE = 3;
/** A new box covering more than this share of an older one is the same label drawn twice. */
export const OVERLAP_LIMIT = 0.6;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Keep a box inside the photo and at least MIN_EDGE wide and tall. */
export function clampBox(box: Box): Box {
  const width = clamp(box.width, MIN_EDGE, 100), height = clamp(box.height, MIN_EDGE, 100);
  return { x: clamp(box.x, 0, 100 - width), y: clamp(box.y, 0, 100 - height), width, height };
}

/** A box from two corner points (any drag direction). */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  const x0 = clamp(Math.min(a.x, b.x), 0, 100), y0 = clamp(Math.min(a.y, b.y), 0, 100);
  const x1 = clamp(Math.max(a.x, b.x), 0, 100), y1 = clamp(Math.max(a.y, b.y), 0, 100);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** True when a drawn box is big enough to be a label and is not the whole photo. */
export const isUsableBox = (box: Box) => box.width >= MIN_EDGE && box.height >= MIN_EDGE && !(box.width >= 99.5 && box.height >= 99.5);

/** Share of the smaller box that the two boxes have in common (0-1). */
export function overlapShare(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.width * a.height, b.width * b.height) : 0;
}

/** Index of an existing box that this one repeats, or -1. `except` skips the box being moved. */
export function duplicateOf(boxes: Box[], box: Box, except = -1): number {
  return boxes.findIndex((existing, index) => index !== except && overlapShare(existing, box) > OVERLAP_LIMIT);
}

/** Add a box. Returns the new list, or why it was refused. */
export function addBox(boxes: Box[], box: Box): { boxes: Box[] } | { error: string } {
  if (!isUsableBox(box)) return { error: 'Draw a box around one label first.' };
  const clash = duplicateOf(boxes, box);
  if (clash >= 0) return { error: `That covers the same label as box ${clash + 1}.` };
  return { boxes: [...boxes, clampBox(box)] };
}

/**
 * Which box (and which part of it) is under a point. `slop` is the finger size in % of the photo, one value or
 * one per axis (a wide photo shown small needs a bigger % across than down). A corner can only be grabbed
 * within a third of its box, so a small box can still be moved by its middle. The top-most box wins.
 */
export function hitTest(boxes: Box[], point: { x: number; y: number }, slop: number | { x: number; y: number } = 3): Hit {
  const sx = typeof slop === 'number' ? slop : slop.x, sy = typeof slop === 'number' ? slop : slop.y;
  for (let index = boxes.length - 1; index >= 0; index--) {
    const b = boxes[index];
    const rx = Math.min(sx, b.width / 3), ry = Math.min(sy, b.height / 3);
    const near = (cx: number, cy: number) => Math.abs(point.x - cx) <= rx && Math.abs(point.y - cy) <= ry;
    if (near(b.x, b.y)) return { index, part: 'nw' };
    if (near(b.x + b.width, b.y)) return { index, part: 'ne' };
    if (near(b.x, b.y + b.height)) return { index, part: 'sw' };
    if (near(b.x + b.width, b.y + b.height)) return { index, part: 'se' };
  }
  for (let index = boxes.length - 1; index >= 0; index--) {
    const b = boxes[index];
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) return { index, part: 'body' };
  }
  return null;
}

/** Move a box by a distance, staying inside the photo. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  return { ...box, x: clamp(box.x + dx, 0, 100 - box.width), y: clamp(box.y + dy, 0, 100 - box.height) };
}

/** Drag one corner of a box to a point. The opposite corner stays where it is. */
export function resizeBox(box: Box, part: Exclude<Part, 'body'>, point: { x: number; y: number }): Box {
  const right = box.x + box.width, bottom = box.y + box.height;
  const west = part === 'nw' || part === 'sw', north = part === 'nw' || part === 'ne';
  const px = clamp(point.x, 0, 100), py = clamp(point.y, 0, 100);
  const x0 = west ? Math.min(px, right - MIN_EDGE) : box.x, x1 = west ? right : Math.max(px, box.x + MIN_EDGE);
  const y0 = north ? Math.min(py, bottom - MIN_EDGE) : box.y, y1 = north ? bottom : Math.max(py, box.y + MIN_EDGE);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Remove the boxes at these indexes (several at once). */
export const removeBoxes = (boxes: Box[], indexes: number[]) => boxes.filter((_, index) => !indexes.includes(index));

/** Move or resize a set of boxes together by the same distance. */
export const moveBoxes = (boxes: Box[], indexes: number[], dx: number, dy: number) => boxes.map((box, index) => indexes.includes(index) ? moveBox(box, dx, dy) : box);

/** Reading order for a photo with several labels: rows from the top, left to right inside a row. */
export function sortReadingOrder(boxes: Box[]): Box[] {
  if (boxes.length < 2) return boxes.slice();
  const medianHeight = [...boxes].map(b => b.height).sort((a, b) => a - b)[Math.floor(boxes.length / 2)];
  const row = (b: Box) => Math.round((b.y + b.height / 2) / Math.max(5, medianHeight * 0.8));
  return boxes.slice().sort((a, b) => row(a) - row(b) || a.x - b.x);
}

/** Pixel rectangle of a box in a photo, kept inside the photo. */
export function boxToPixels(box: Box, width: number, height: number) {
  const left = clamp(Math.round(box.x / 100 * width), 0, width - 1), top = clamp(Math.round(box.y / 100 * height), 0, height - 1);
  return { left, top, width: clamp(Math.round(box.width / 100 * width), 1, width - left), height: clamp(Math.round(box.height / 100 * height), 1, height - top) };
}

/** True when every box is valid and none repeats another. Used before anything is cut. */
export function boxesAreSound(boxes: Box[]): boolean {
  return boxes.every(isUsableBox) && boxes.every((box, index) => duplicateOf(boxes.slice(0, index), box) < 0);
}
