// Crop Studio: one compact editor for fixing and cutting photos.
// - Drag on the photo to draw a box; the number of labels is simply the number of boxes (no count to type).
// - Drag a box to move it, drag a corner to resize it, Delete (or the red button) removes it.
// - "Select several" (under More) lets you move or delete a group of boxes together.
// - Rotate left / right and Straighten (under More) turn the photo itself; boxes turn with it. The turned photo is kept.
// - Delete photo (for a photo that is not a label) takes it out of IMEI Lens into the archive (Undo); the phone's gallery is never touched.
// - Auto-detect runs once when a photo with no boxes opens (and by its button); it only adds boxes.
// - Works on one photo or on many; nothing is read until Save. Closing keeps the boxes as a draft (no question asked).
//   One photo: Save all reads it now. Several photos (Bulk crop): Save all cuts them one by one in the background.
//   Bulk edit (steps): Previous / Delete / Next, one photo at a time; edits are kept while you move around. On the last photo Next
//   becomes Finish: only the photos you changed (boxes or turns) are queued for rescanning in the background; the others stay in Review.
// The editor fills the screen on phones and nearly all of it on larger screens.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Hand, Loader2, MousePointer2, RotateCcw, RotateCw, Trash2, Undo2, Wand2, ZoomIn, ZoomOut, X } from 'lucide-react';
import { addBox, boxFromPoints, boxesAreSound, clampBox, hitTest, isUsableBox, moveBoxes, removeBoxes, resizeBox, turnBox, type Box, type Part } from './crop-boxes';
import { useBackLayer } from './back-layer';

export type StudioItem = { id: string; name: string; source: string };
export type StudioPlan = { id: string; boxes: Box[] };
export type PhotoEdit = 'left' | 'right' | 'straighten';
type Props = {
  items: StudioItem[];
  initialPlans?: Record<string, Box[]>;
  startIndex?: number;
  /** Not empty while the app is reading and saving the crops. */
  progress: string;
  title?: string;
  detect: (source: string) => Promise<{ boxes: Box[]; devices: number }>;
  /** An error or note from the app, shown under the photo. */
  notice?: string;
  onSaveAll: (plans: StudioPlan[]) => void;
  onSaveLater: (plans: StudioPlan[], index: number) => void;
  /** Closed with nothing changed. A saved draft stays as it is. */
  onClose: () => void;
  /** Closed on purpose, throwing the changes (and any draft) away. */
  onDiscard: () => void;
  /** Called (debounced) whenever the boxes change, so a draft survives a refresh or crash. */
  onAutosave?: (plans: StudioPlan[], index: number) => void;
  /** Send photos to the background queue: they are cut and read one by one while you carry on. A photo with no boxes is cut automatically. */
  onQueue?: (entries: StudioPlan[], mode?: 'later') => void;
  /** Save all cuts in the background even for one photo (the bulk flow). Without it one photo is read now and its results are shown. */
  background?: boolean;
  /** Bulk edit: one photo at a time with Previous / Delete / Next, and Finish on the last photo. Needs onQueue. */
  steps?: boolean;
  /** Turn or level the photo; the app keeps the new picture on the record and returns it (null = could not). */
  onEditPhoto?: (id: string, source: string, edit: PhotoEdit) => Promise<{ source: string; angle?: number } | null>;
  /** Take the photo (and its record) out of IMEI Lens, into the archive. Never the phone's gallery. */
  onDeletePhoto?: (id: string) => void;
  /** Bulk edit finished: how many edited photos were queued, and how many were left as they were (they stay in Review). */
  onFinished?: (edited: number, unchanged: number) => void;
};

type Drag =
  | { kind: 'draw'; from: { x: number; y: number } }
  | { kind: 'move'; from: { x: number; y: number }; ids: number[]; start: Box[] }
  | { kind: 'resize'; index: number; part: Exclude<Part, 'body'>; start: Box };

const ZOOMS = [1, 1.5, 2, 3, 4];

export function CropStudio({ items, initialPlans = {}, startIndex = 0, progress, title = 'Crop photos', detect, notice = '', onSaveAll, onSaveLater, onClose, onDiscard, onAutosave, onQueue, background = false, steps = false, onEditPhoto, onDeletePhoto, onFinished }: Props) {
  const [plans, setPlans] = useState<Record<string, Box[]>>(() => Object.fromEntries(items.map(item => [item.id, initialPlans[item.id] || []])));
  const startPlans = useRef(JSON.stringify(plans));
  const [index, setIndex] = useState(Math.max(0, Math.min(items.length - 1, startIndex)));
  const [selected, setSelected] = useState<number[]>([]);
  const [several, setSeveral] = useState(false);
  const [pan, setPan] = useState(false);
  const [zoomStep, setZoomStep] = useState(0);
  const [message, setMessage] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [editing, setEditing] = useState(false);
  // Photos taken out (Delete photo) by id; turned photos (their new picture) by id.
  const [gone, setGone] = useState<string[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  // Bulk edit: the boxes each photo had once it was first shown (after the automatic search). A photo is "edited" when its boxes
  // differ from that or it was turned; only edited photos are rescanned at Finish.
  const baseline = useRef<Record<string, string>>({});
  const [edited, setEdited] = useState<string[]>([]);
  const autoTried = useRef<Set<string>>(new Set());
  const [draw, setDraw] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 320, h: 400 });
  const [natural, setNatural] = useState({ w: 4, h: 3 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const history = useRef<Record<string, Box[][]>>({});
  const future = useRef<Record<string, Box[][]>>({});

  const live = useMemo(() => items.filter(entry => !gone.includes(entry.id)), [items, gone]);
  const at = Math.max(0, Math.min(live.length - 1, index));
  const item: StudioItem | undefined = live[at];
  const itemId = item?.id || '';
  const source = item ? sources[item.id] || item.source : '';
  const boxes = (item && plans[item.id]) || [];
  const busy = !!progress || detecting || editing;
  const zoom = ZOOMS[zoomStep];
  const open = live;
  const total = useMemo(() => open.reduce((sum, entry) => sum + (plans[entry.id]?.length || 0), 0), [open, plans]);
  const photosWithBoxes = useMemo(() => open.filter(entry => plans[entry.id]?.length).length, [open, plans]);
  const dirty = JSON.stringify(plans) !== startPlans.current;
  // Several photos (or the bulk flow) are cut one by one in the background; a photo with no boxes is cut automatically.
  const inBackground = !!onQueue && (background || items.length > 1);
  const asList = useCallback((): StudioPlan[] => open.map(entry => ({ id: entry.id, boxes: plans[entry.id] || [] })), [open, plans]);

  // Keep the viewport size for fitting the photo.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setView({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A fresh photo starts fitted, with nothing selected.
  useEffect(() => { setSelected([]); setZoomStep(0); setPan(false); setMessage(''); setDraw(null); }, [itemId]);

  // A photo that opens with no boxes is searched once for labels, so you start with boxes to check instead of an empty photo.
  useEffect(() => {
    if (!item) return;
    if (autoTried.current.has(item.id) || (plans[item.id] || []).length || progress) { if (!(item.id in baseline.current)) baseline.current[item.id] = JSON.stringify(plans[item.id] || []); return; }
    autoTried.current.add(item.id);
    void auto(true);
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every photo deleted: nothing left to edit.
  useEffect(() => { if (items.length && !live.length) onClose(); }, [live.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft autosave.
  useEffect(() => {
    if (!onAutosave || !dirty) return;
    const timer = window.setTimeout(() => onAutosave(asList(), at), 500);
    return () => window.clearTimeout(timer);
  }, [plans, at, gone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which photos count as edited (Bulk edit).
  useEffect(() => {
    if (!steps) return;
    const next = live.filter(entry => sources[entry.id] || (entry.id in baseline.current && JSON.stringify(plans[entry.id] || []) !== baseline.current[entry.id])).map(entry => entry.id);
    if (next.join() !== edited.join()) setEdited(next);
  }, [plans, sources, live, detecting]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((next: Box[]) => {
    if (!itemId) return;
    const stack = history.current[itemId] ||= [];
    stack.push(plans[itemId] || []);
    if (stack.length > 40) stack.shift();
    future.current[itemId] = [];
    setPlans(old => ({ ...old, [itemId]: next }));
  }, [itemId, plans]);
  const undo = () => {
    const stack = history.current[itemId];
    if (!stack?.length || busy) return;
    const previous = stack.pop()!;
    (future.current[itemId] ||= []).push(plans[itemId] || []);
    setPlans(old => ({ ...old, [itemId]: previous })); setSelected([]);
  };
  const redo = () => {
    const ahead = future.current[itemId];
    if (!ahead?.length || busy) return;
    const next = ahead.pop()!;
    (history.current[itemId] ||= []).push(plans[itemId] || []);
    setPlans(old => ({ ...old, [itemId]: next })); setSelected([]);
  };

  const fit = Math.min(view.w / natural.w, view.h / natural.h);
  const stageW = Math.max(40, natural.w * fit * zoom), stageH = Math.max(40, natural.h * fit * zoom);

  const pointOf = (event: { clientX: number; clientY: number }) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)), rect };
  };

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy || pan || event.button > 0) return;
    const target = event.target as HTMLElement;
    const { x, y, rect } = pointOf(event);
    if (target.dataset.del) { const at = Number(target.dataset.del); change(removeBoxes(boxes, [at])); setSelected([]); return; }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const hit = hitTest(boxes, { x, y }, { x: 26 / rect.width * 100, y: 26 / rect.height * 100 });
    setMessage('');
    if (hit && hit.part !== 'body') { drag.current = { kind: 'resize', index: hit.index, part: hit.part, start: boxes[hit.index] }; setSelected([hit.index]); return; }
    if (hit) {
      let ids = selected;
      if (several) ids = selected.includes(hit.index) ? selected.filter(i => i !== hit.index) : [...selected, hit.index];
      else if (!selected.includes(hit.index)) ids = [hit.index];
      setSelected(ids);
      drag.current = ids.includes(hit.index) ? { kind: 'move', from: { x, y }, ids, start: boxes } : null;
      return;
    }
    if (!several) setSelected([]);
    drag.current = { kind: 'draw', from: { x, y } };
    setDraw({ x, y, width: 0, height: 0 });
  }

  function moveEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const { x, y } = pointOf(event);
    if (d.kind === 'draw') setDraw(boxFromPoints(d.from, { x, y }));
    else if (d.kind === 'move') setPlans(old => ({ ...old, [itemId]: moveBoxes(d.start, d.ids, x - d.from.x, y - d.from.y) }));
    else setPlans(old => ({ ...old, [itemId]: (old[itemId] || []).map((box, i) => i === d.index ? resizeBox(d.start, d.part, { x, y }) : box) }));
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const { x, y } = pointOf(event);
    if (d.kind === 'draw') {
      const candidate = boxFromPoints(d.from, { x, y });
      setDraw(null);
      if (!isUsableBox(candidate)) return;
      const result = addBox(boxes, candidate);
      if ('error' in result) { setMessage(result.error); return; }
      change(result.boxes); setSelected([result.boxes.length - 1]);
    } else {
      // The live drag already updated the boxes; record the state before the drag as one undo step.
      const before = d.kind === 'move' ? d.start : (plans[itemId] || []).map((box, i) => i === d.index ? d.start : box);
      const stack = history.current[itemId] ||= [];
      if (JSON.stringify(before) !== JSON.stringify(plans[itemId])) { stack.push(before); if (stack.length > 40) stack.shift(); future.current[itemId] = []; }
    }
  }

  function deleteSelected() {
    if (!selected.length || busy) return;
    change(removeBoxes(boxes, selected)); setSelected([]);
    setMessage(`${selected.length} box${selected.length === 1 ? '' : 'es'} deleted.`);
  }

  async function auto(initial = false) {
    if (busy || !item) return;
    const id = item.id;
    setDetecting(true); setMessage('Looking for labels…');
    try {
      const found = await detect(source);
      let next = boxes, added = 0;
      for (const box of found.boxes) { const r = addBox(next, clampBox(box)); if ('boxes' in r) { next = r.boxes; added++; } }
      if (initial) baseline.current[id] = JSON.stringify(next);
      if (added) { change(next); setMessage(`Found ${added} label${added === 1 ? '' : 's'}. Check the boxes, fix any that are off${steps ? '' : ', then Save all'}.`); }
      else if (found.devices >= 2) setMessage(`Saw about ${found.devices} labels but could not place the boxes. Draw them yourself.`);
      else setMessage(found.boxes.length ? 'Those labels already have boxes.' : 'Found only one label. Draw a box if you see more.');
    } catch (error) { console.error(error); setMessage('Auto-detect did not work on this photo. Draw the boxes yourself.'); }
    finally { if (initial && !(id in baseline.current)) baseline.current[id] = JSON.stringify(boxes); setDetecting(false); }
  }

  /** Rotate or straighten the photo. The app keeps the new picture; the boxes turn with a quarter turn, and stay put when levelling. */
  async function editPhoto(edit: PhotoEdit) {
    if (busy || !item || !onEditPhoto) return;
    const id = item.id;
    setEditing(true); setMessage(edit === 'straighten' ? 'Straightening…' : 'Turning the photo…');
    try {
      const result = await onEditPhoto(id, source, edit);
      if (!result) { setMessage('Could not change this photo. Try again.'); return; }
      if (edit === 'straighten' && !result.angle) { setMessage('This photo already looks level.'); return; }
      setSources(old => ({ ...old, [id]: result.source }));
      if (edit !== 'straighten') setPlans(old => ({ ...old, [id]: (old[id] || []).map(box => turnBox(box, edit)) }));
      // Undo steps belong to the old picture.
      history.current[id] = []; future.current[id] = [];
      setSelected([]); setZoomStep(0); setPan(false);
      setMessage(edit === 'straighten' ? `Straightened by about ${Math.abs(Math.round(result.angle || 0))}°. Check the boxes.` : boxes.length ? 'Photo turned; the boxes turned with it.' : 'Photo turned.');
    } catch (error) { console.error(error); setMessage('Could not change this photo. Try again.'); }
    finally { setEditing(false); }
  }

  /** Bulk edit Finish: queue only the edited photos for rescanning; the others are left as they are (still in Review). */
  function finishSteps() {
    if (busy || !onQueue) return;
    const changed = live.filter(entry => edited.includes(entry.id));
    const bad = changed.find(entry => !boxesAreSound(plans[entry.id] || []));
    if (bad) { setIndex(live.indexOf(bad)); setMessage('Two boxes cover the same label, or one is too small. Fix it first.'); return; }
    if (changed.length) onQueue(changed.map(entry => ({ id: entry.id, boxes: plans[entry.id] || [] })));
    onFinished?.(changed.length, live.length - changed.length);
    onDiscard();
  }
  function deletePhoto() {
    if (busy || !item || !onDeletePhoto) return;
    const id = item.id;
    onDeletePhoto(id);
    const goneNow = [...gone, id];
    setGone(goneNow);
    setPlans(old => { const { [id]: _gone, ...rest } = old; return rest; });
    const remaining = items.filter(entry => !goneNow.includes(entry.id));
    if (!remaining.length) return; // the effect above closes the editor
    setIndex(Math.min(at, remaining.length - 1));
    setMessage('Photo deleted from RetailLens (kept in the archive; your phone gallery is not touched).');
  }

  function saveAll() {
    if (busy) return;
    if (!total) { setMessage('Draw at least one box first.'); return; }
    const bad = open.find(entry => !boxesAreSound(plans[entry.id] || []));
    if (bad) { setIndex(live.indexOf(bad)); setMessage('Two boxes cover the same label, or one is too small. Fix it first.'); return; }
    onSaveAll(asList());
  }
  const saveLater = () => { onSaveLater(asList(), at); };
  // Several photos: cut and read one by one in the background while the app stays usable. A photo with no boxes is cut automatically.
  function queueAll() {
    if (busy || !onQueue) return;
    const bad = open.find(entry => !boxesAreSound(plans[entry.id] || []));
    if (bad) { setIndex(live.indexOf(bad)); setMessage('Two boxes cover the same label, or one is too small. Fix it first.'); return; }
    onQueue(asList());
    startPlans.current = JSON.stringify(plans);
    onClose();
  }
  const save = () => { if (inBackground) queueAll(); else saveAll(); };
  // Leaving never throws work away: boxes are kept as a draft (nothing to keep = the draft is cleared).
  const requestClose = () => {
    if (busy) return;
    if (!dirty) onClose(); else if (total) saveLater(); else onDiscard();
  };

  useBackLayer(true, requestClose, 'crop-studio');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) { event.preventDefault(); deleteSelected(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item) return null;
  const countLabel = boxes.length === 1 ? '1 label' : `${boxes.length} labels`;
  const last = at === live.length - 1;
  const progressText = steps
    ? `${at + 1} of ${live.length} photos · ${edited.length} edited · `
    : live.length > 1 ? `Photo ${at + 1} of ${live.length} · ` : '';
  const badge = (entry: StudioItem) => steps && edited.includes(entry.id) ? 'Edited' : '';

  return <div className="modal-backdrop studio-backdrop"><section className="modal studio" role="dialog" aria-modal="true" aria-label={title}>
    <header className="studio-head">
      <div className="studio-title"><strong>{title}</strong>
        <span>{progressText}<b>{countLabel}</b>{!steps && live.length > 1 ? ` · ${total} in all` : ''}</span></div>
      <button className="iconbtn" aria-label="Close" disabled={busy} onClick={requestClose}><X size={18} /></button>
    </header>

    <div className="studio-tools" role="toolbar" aria-label="Crop tools">
      <button className={`subtle-btn${!pan ? ' on' : ''}`} aria-pressed={!pan} disabled={busy} onClick={() => setPan(false)}><MousePointer2 size={16} /> Draw</button>
      {zoom > 1 && <button className={`subtle-btn${pan ? ' on' : ''}`} aria-pressed={pan} disabled={busy} title="Move around the zoomed photo" onClick={() => setPan(true)}><Hand size={16} /> Pan</button>}
      <button className="subtle-btn" aria-label="Zoom out" disabled={busy || zoomStep === 0} onClick={() => { setZoomStep(s => Math.max(0, s - 1)); if (zoomStep <= 1) setPan(false); }}><ZoomOut size={16} /></button>
      <span className="studio-zoom">{Math.round(zoom * 100)}%</span>
      <button className="subtle-btn" aria-label="Zoom in" disabled={busy || zoomStep === ZOOMS.length - 1} onClick={() => setZoomStep(s => Math.min(ZOOMS.length - 1, s + 1))}><ZoomIn size={16} /></button>
      {onEditPhoto && <>
        <button className="subtle-btn" aria-label="Rotate left" title="Rotate left" disabled={busy} onClick={() => void editPhoto('left')}><RotateCcw size={16} /></button>
        <button className="subtle-btn" aria-label="Rotate right" title="Rotate right" disabled={busy} onClick={() => void editPhoto('right')}><RotateCw size={16} /></button>
      </>}
      <button className="subtle-btn" aria-label="Undo" disabled={busy || !history.current[itemId]?.length} onClick={undo}><Undo2 size={16} /> Undo</button>
      <button className="subtle-btn danger" disabled={busy || !selected.length} onClick={deleteSelected}><Trash2 size={16} /> Delete{selected.length > 1 ? ` ${selected.length}` : ''}</button>
      <button className="subtle-btn" disabled={busy} onClick={() => void auto()}>{detecting ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />} Auto-detect</button>
      <details className="studio-more"><summary>More</summary>
        <button className="subtle-btn" aria-label="Redo" disabled={busy || !future.current[itemId]?.length} onClick={redo}>Redo</button>
        <button className={`subtle-btn${several ? ' on' : ''}`} aria-pressed={several} disabled={busy} onClick={() => setSeveral(s => !s)}>Select several</button>
        <button className="subtle-btn" disabled={busy || !boxes.length} onClick={() => setSelected(selected.length === boxes.length ? [] : boxes.map((_, i) => i))}>{selected.length === boxes.length && boxes.length ? 'Select none' : 'Select all'}</button>
        {onEditPhoto && <button className="subtle-btn" disabled={busy} onClick={() => void editPhoto('straighten')}>Straighten</button>}
        {onDeletePhoto && !steps && <button className="subtle-btn danger" disabled={busy} onClick={deletePhoto}><Trash2 size={16} /> Delete photo</button>}
      </details>
    </div>

    <p className="studio-hint">{pan ? 'Pan mode: drag the photo to move around.' : 'Drag on the photo to draw a box around each label. Drag a box to move it, a corner to resize it.'}</p>

    <div className="studio-viewport" ref={viewportRef} style={{ touchAction: pan ? 'pan-x pan-y' : 'none', overflow: zoom > 1 ? 'auto' : 'hidden' }}>
      <div className={`studio-stage${pan ? ' panning' : ''}`} ref={stageRef} style={{ width: stageW, height: stageH }}
        onPointerDown={down} onPointerMove={moveEvent} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDraw(null); }}>
        <img src={source} alt={`Photo ${at + 1}: ${item.name}`} draggable={false} onLoad={event => setNatural({ w: event.currentTarget.naturalWidth || 4, h: event.currentTarget.naturalHeight || 3 })} />
        {boxes.map((box, i) => <div key={i} className={`studio-box${selected.includes(i) ? ' selected' : ''}`} style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}>
          <span className="studio-num">{i + 1}</span>
          {selected.includes(i) && <>
            <button className="studio-del" data-del={i} aria-label={`Delete box ${i + 1}`} tabIndex={-1}>×</button>
            {(['nw', 'ne', 'sw', 'se'] as const).map(part => <i key={part} className={`studio-handle ${part}`} />)}
          </>}
        </div>)}
        {draw && <div className="studio-box drawing" style={{ left: `${draw.x}%`, top: `${draw.y}%`, width: `${draw.width}%`, height: `${draw.height}%` }} />}
      </div>
    </div>

    {(message || notice) && <p role="status" className="studio-message">{message || notice}</p>}
    {(progress || editing) && <p role="status" className="studio-progress"><Loader2 size={16} className="spin" /> {progress || 'Working on the photo…'}</p>}

    {live.length > 1 && <nav className="studio-strip" aria-label="Photos">
      {!steps && <button className="subtle-btn" aria-label="Previous photo" disabled={busy || at === 0} onClick={() => setIndex(at - 1)}><ChevronLeft size={18} /></button>}
      <div className="studio-thumbs">{live.map((entry, i) => <button key={entry.id} className={`studio-thumb${i === at ? ' current' : ''}${badge(entry) ? ' done' : ''}`} aria-label={`Photo ${i + 1}, ${badge(entry) || `${plans[entry.id]?.length || 0} boxes`}`} disabled={busy} onClick={() => setIndex(i)}>
        <img src={sources[entry.id] || entry.source} alt="" loading="lazy" />{badge(entry) ? <em>{badge(entry)}</em> : !!plans[entry.id]?.length && <b>{plans[entry.id].length}</b>}</button>)}</div>
      {!steps && <button className="subtle-btn" aria-label="Next photo" disabled={busy || at === live.length - 1} onClick={() => setIndex(at + 1)}><ChevronRight size={18} /></button>}
    </nav>}

    {steps ? <footer className="studio-actions studio-steps" role="group" aria-label="Bulk edit">
      <button className="subtle-btn" disabled={busy || at === 0} onClick={() => setIndex(at - 1)}><ChevronLeft size={16} /> Previous</button>
      <button className="subtle-btn danger" disabled={busy || !onDeletePhoto} onClick={deletePhoto}><Trash2 size={16} /> Delete</button>
      {last
        ? <button className="primary studio-next" disabled={busy} onClick={finishSteps}>Finish{edited.length ? ` (rescan ${edited.length})` : ''}</button>
        : <button className="primary studio-next" disabled={busy} onClick={() => setIndex(at + 1)}>Next <ChevronRight size={16} /></button>}
    </footer> : <footer className="studio-actions">
      <button className="primary" disabled={busy || (inBackground ? !open.length : !total)} onClick={save}>{progress ? 'Working…' : `Save all${total ? ` (${total} crop${total === 1 ? '' : 's'}${photosWithBoxes > 1 ? `, ${photosWithBoxes} photos` : ''})` : inBackground ? ` (cut ${open.length} photo${open.length === 1 ? '' : 's'} automatically)` : ''}`}</button>
    </footer>}
  </section></div>;
}
