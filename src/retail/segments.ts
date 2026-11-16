/**
 * The person's own segments (Fold 1, Fold 2, Flagship 1…): a list they add to, rename, reorder and delete, with the models they assign to each one.
 * A new install starts with the built-in list; once the person edits it their list is kept as it is. A model belongs to one segment (its catalog
 * segment); assigning a model to a segment is the same thing as the segment dropdown of the catalog and is remembered the same way.
 */
import { fullCatalog, itemFor, setModelSegment } from './catalog';
import { SEGMENTS, SEGMENT_LABEL, type CatalogItem, type RetailState, type Segment, type SegmentDef } from './types';

export const defaultSegments = (): SegmentDef[] => SEGMENTS.map(id => ({ id, name: SEGMENT_LABEL[id] }));

/** The segments to show, in the person's order. */
export const segmentDefs = (state: Pick<RetailState, 'segments'>): SegmentDef[] => (state.segments && state.segments.length ? state.segments : defaultSegments());
export const segmentIds = (state: Pick<RetailState, 'segments'>): Segment[] => segmentDefs(state).map(s => s.id);
/** The name shown for a segment id ('other' = not placed yet; an id that was deleted still reads sensibly). */
export function segLabel(state: Pick<RetailState, 'segments'>, id: Segment): string {
  if (id === 'other' || !id) return 'No segment';
  return segmentDefs(state).find(s => s.id === id)?.name || SEGMENT_LABEL[id] || id;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'segment';

/** Adds a segment. The name must be new (ignoring case) and not empty. */
export function addSegment<S extends Pick<RetailState, 'segments'>>(state: S, name: string): { state: S; id?: Segment; error?: string } {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!clean) return { state, error: 'Type a name for the segment.' };
  const defs = segmentDefs(state);
  if (defs.some(s => s.name.toLowerCase() === clean.toLowerCase())) return { state, error: 'There is already a segment with that name.' };
  let id = slug(clean), n = 2;
  while (defs.some(s => s.id === id) || id === 'other') id = `${slug(clean)}-${n++}`;
  return { state: { ...state, segments: [...defs, { id, name: clean }] }, id };
}

export function renameSegment<S extends Pick<RetailState, 'segments'>>(state: S, id: Segment, name: string): { state: S; error?: string } {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 30);
  const defs = segmentDefs(state);
  if (!clean) return { state, error: 'Type a name for the segment.' };
  if (defs.some(s => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) return { state, error: 'There is already a segment with that name.' };
  return { state: { ...state, segments: defs.map(s => s.id === id ? { ...s, name: clean } : s) } };
}

/** Moves a segment up (-1) or down (+1) in the list. */
export function moveSegment<S extends Pick<RetailState, 'segments'>>(state: S, id: Segment, by: -1 | 1): S {
  const defs = [...segmentDefs(state)], at = defs.findIndex(s => s.id === id), to = at + by;
  if (at < 0 || to < 0 || to >= defs.length) return state;
  [defs[at], defs[to]] = [defs[to], defs[at]];
  return { ...state, segments: defs };
}

/**
 * Deletes a segment. Its models are not lost: they become "No segment" (listed under Segments until the person places them again), and targets
 * typed for it are kept as they are (they just no longer show).
 */
export function deleteSegment<S extends Pick<RetailState, 'segments' | 'catalog' | 'corrections' | 'recordMeta'>>(state: S, id: Segment): S {
  if (id === 'other') return state;
  let next: S = { ...state, segments: segmentDefs(state).filter(s => s.id !== id) };
  for (const item of fullCatalog(state)) if (item.segment === id) next = setModelSegment(next, item.code, 'other');
  const recordMeta = Object.fromEntries(Object.entries(next.recordMeta).map(([rid, meta]) => [rid, meta.segment === id ? { ...meta, segment: undefined } : meta]));
  for (const meta of Object.values(recordMeta)) if (meta.segment === undefined) delete meta.segment;
  return { ...next, recordMeta };
}

/** The models of a segment (this month's own segment is not considered: the catalog default is what the person assigns here). */
export const modelsOf = (state: Pick<RetailState, 'catalog'>, id: Segment): CatalogItem[] => fullCatalog(state).filter(i => i.segment === id);

/** Puts these models in the segment (and takes them out of whichever segment they were in). Remembered like any segment correction. */
export function assignModels<S extends Pick<RetailState, 'catalog' | 'corrections'>>(state: S, id: Segment, codes: string[]): S {
  let next = state;
  for (const code of codes) if (itemFor(next, code)) next = setModelSegment(next, code, id);
  return next;
}
