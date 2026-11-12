// Crop Studio: one compact editor for cutting photos that hold several products.
// - Drag on the photo to draw a box; the number of labels is simply the number of boxes (no count to type).
// - Drag a box to move it, drag a corner to resize it, Delete (or the red button) removes it.
// - "Select several" lets you move or delete a group of boxes together.
// - Auto-detect is optional and only adds boxes.
// - Works on one photo or on many; nothing is read or changed until Save all.
// - Closing with unsaved boxes asks: Save for later, Discard, or Continue editing.
// Phones get a full-screen editor, larger screens a popup.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Hand, Loader2, MousePointer2, Redo2, Save, Trash2, Undo2, Wand2, ZoomIn, ZoomOut, X } from 'lucide-react';
import { addBox, boxFromPoints, boxesAreSound, clampBox, hitTest, isUsableBox, moveBoxes, removeBoxes, resizeBox, type Box, type Part } from './crop-boxes';
import { useBackLayer } from './back-layer';

export type StudioItem = { id: string; name: string; source: string };
export type StudioPlan = { id: string; boxes: Box[] };
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
};

type Drag =
  | { kind: 'draw'; from: { x: number; y: number } }
  | { kind: 'move'; from: { x: number; y: number }; ids: number[]; start: Box[] }
  | { kind: 'resize'; index: number; part: Exclude<Part, 'body'>; start: Box };

const ZOOMS = [1, 1.5, 2, 3, 4];

export function CropStudio({ items, initialPlans = {}, startIndex = 0, progress, title = 'Crop photos', detect, notice = '', onSaveAll, onSaveLater, onClose, onDiscard, onAutosave }: Props) {
  const [plans, setPlans] = useState<Record<string, Box[]>>(() => Object.fromEntries(items.map(item => [item.id, initialPlans[item.id] || []])));
  const startPlans = useRef(JSON.stringify(plans));
  const [index, setIndex] = useState(Math.max(0, Math.min(items.length - 1, startIndex)));
  const [selected, setSelected] = useState<number[]>([]);
  const [several, setSeveral] = useState(false);
  const [pan, setPan] = useState(false);
  const [zoomStep, setZoomStep] = useState(0);
  const [message, setMessage] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draw, setDraw] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 320, h: 400 });
  const [natural, setNatural] = useState({ w: 4, h: 3 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const history = useRef<Record<string, Box[][]>>({});
  const future = useRef<Record<string, Box[][]>>({});

  const item = items[index];
  const boxes = plans[item.id] || [];
  const busy = !!progress || detecting;
  const zoom = ZOOMS[zoomStep];
  const total = useMemo(() => items.reduce((sum, entry) => sum + (plans[entry.id]?.length || 0), 0), [items, plans]);
  const photosWithBoxes = useMemo(() => items.filter(entry => plans[entry.id]?.length).length, [items, plans]);
  const dirty = JSON.stringify(plans) !== startPlans.current;
  const asList = useCallback((): StudioPlan[] => items.map(entry => ({ id: entry.id, boxes: plans[entry.id] || [] })), [items, plans]);

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
  useEffect(() => { setSelected([]); setZoomStep(0); setMessage(''); setDraw(null); }, [item.id]);

  // Draft autosave.
  useEffect(() => {
    if (!onAutosave || !dirty) return;
    const timer = window.setTimeout(() => onAutosave(asList(), index), 500);
    return () => window.clearTimeout(timer);
  }, [plans, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((next: Box[]) => {
    const stack = history.current[item.id] ||= [];
    stack.push(plans[item.id] || []);
    if (stack.length > 40) stack.shift();
    future.current[item.id] = [];
    setPlans(old => ({ ...old, [item.id]: next }));
  }, [item.id, plans]);
  const undo = () => {
    const stack = history.current[item.id];
    if (!stack?.length || busy) return;
    const previous = stack.pop()!;
    (future.current[item.id] ||= []).push(plans[item.id] || []);
    setPlans(old => ({ ...old, [item.id]: previous })); setSelected([]);
  };
  const redo = () => {
    const ahead = future.current[item.id];
    if (!ahead?.length || busy) return;
    const next = ahead.pop()!;
    (history.current[item.id] ||= []).push(plans[item.id] || []);
    setPlans(old => ({ ...old, [item.id]: next })); setSelected([]);
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
    else if (d.kind === 'move') setPlans(old => ({ ...old, [item.id]: moveBoxes(d.start, d.ids, x - d.from.x, y - d.from.y) }));
    else setPlans(old => ({ ...old, [item.id]: (old[item.id] || []).map((box, i) => i === d.index ? resizeBox(d.start, d.part, { x, y }) : box) }));
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
      const before = d.kind === 'move' ? d.start : (plans[item.id] || []).map((box, i) => i === d.index ? d.start : box);
      const stack = history.current[item.id] ||= [];
      if (JSON.stringify(before) !== JSON.stringify(plans[item.id])) { stack.push(before); if (stack.length > 40) stack.shift(); future.current[item.id] = []; }
    }
  }

  function deleteSelected() {
    if (!selected.length || busy) return;
    change(removeBoxes(boxes, selected)); setSelected([]);
    setMessage(`${selected.length} box${selected.length === 1 ? '' : 'es'} deleted.`);
  }

  async function auto() {
    if (busy) return;
    setDetecting(true); setMessage('Looking for labels…');
    try {
      const found = await detect(item.source);
      let next = boxes, added = 0;
      for (const box of found.boxes) { const r = addBox(next, clampBox(box)); if ('boxes' in r) { next = r.boxes; added++; } }
      if (added) { change(next); setMessage(`Found ${added} label${added === 1 ? '' : 's'}. Check the boxes, fix any that are off, then Save all.`); }
      else if (found.devices >= 2) setMessage(`Saw about ${found.devices} labels but could not place the boxes. Draw them yourself.`);
      else setMessage(found.boxes.length ? 'Those labels already have boxes.' : 'Found only one label. Draw a box if you see more.');
    } catch (error) { console.error(error); setMessage('Auto-detect did not work on this photo. Draw the boxes yourself.'); }
    finally { setDetecting(false); }
  }

  function saveAll() {
    if (busy) return;
    if (!total) { setMessage('Draw at least one box first.'); return; }
    const bad = items.find(entry => !boxesAreSound(plans[entry.id] || []));
    if (bad) { setIndex(items.indexOf(bad)); setMessage('Two boxes cover the same label, or one is too small. Fix it first.'); return; }
    onSaveAll(asList());
  }
  const saveLater = () => { onSaveLater(asList(), index); };
  const requestClose = () => { if (busy) return; if (dirty) setConfirmOpen(true); else onClose(); };

  useBackLayer(!confirmOpen, requestClose, 'crop-studio');
  useBackLayer(confirmOpen, () => setConfirmOpen(false), 'crop-studio-confirm');

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

  const countLabel = boxes.length === 1 ? '1 label' : `${boxes.length} labels`;

  return <div className="modal-backdrop studio-backdrop"><section className="modal studio" role="dialog" aria-modal="true" aria-label={title}>
    <header className="studio-head">
      <div className="studio-title"><strong>{title}</strong>
        <span>{items.length > 1 ? `Photo ${index + 1} of ${items.length} · ` : ''}<b>{countLabel}</b>{items.length > 1 ? ` · ${total} in all` : ''}</span></div>
      <button className="iconbtn" aria-label="Close" disabled={busy} onClick={requestClose}><X size={18} /></button>
    </header>

    <div className="studio-tools" role="toolbar" aria-label="Crop tools">
      <button className={`subtle-btn${!pan ? ' on' : ''}`} aria-pressed={!pan} disabled={busy} onClick={() => setPan(false)}><MousePointer2 size={16} /> Draw</button>
      <button className={`subtle-btn${pan ? ' on' : ''}`} aria-pressed={pan} disabled={busy || zoom === 1} title={zoom === 1 ? 'Zoom in first' : 'Move around the zoomed photo'} onClick={() => setPan(true)}><Hand size={16} /> Pan</button>
      <button className="subtle-btn" aria-label="Zoom out" disabled={busy || zoomStep === 0} onClick={() => { setZoomStep(s => Math.max(0, s - 1)); if (zoomStep <= 1) setPan(false); }}><ZoomOut size={16} /></button>
      <span className="studio-zoom">{Math.round(zoom * 100)}%</span>
      <button className="subtle-btn" aria-label="Zoom in" disabled={busy || zoomStep === ZOOMS.length - 1} onClick={() => setZoomStep(s => Math.min(ZOOMS.length - 1, s + 1))}><ZoomIn size={16} /></button>
      <button className={`subtle-btn${several ? ' on' : ''}`} aria-pressed={several} disabled={busy} onClick={() => setSeveral(s => !s)}>Select several</button>
      <button className="subtle-btn" disabled={busy || !boxes.length} onClick={() => setSelected(selected.length === boxes.length ? [] : boxes.map((_, i) => i))}>{selected.length === boxes.length && boxes.length ? 'Select none' : 'Select all'}</button>
      <button className="subtle-btn" aria-label="Undo" disabled={busy || !history.current[item.id]?.length} onClick={undo}><Undo2 size={16} /> Undo</button>
      <button className="subtle-btn" aria-label="Redo" disabled={busy || !future.current[item.id]?.length} onClick={redo}><Redo2 size={16} /> Redo</button>
      <button className="subtle-btn danger" disabled={busy || !selected.length} onClick={deleteSelected}><Trash2 size={16} /> Delete{selected.length > 1 ? ` ${selected.length}` : ''}</button>
      <button className="subtle-btn" disabled={busy} onClick={() => void auto()}>{detecting ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />} Auto-detect</button>
    </div>

    <p className="studio-hint">{pan ? 'Pan mode: drag the photo to move around.' : 'Drag on the photo to draw a box around each label. Drag a box to move it, a corner to resize it.'}</p>

    <div className="studio-viewport" ref={viewportRef} style={{ touchAction: pan ? 'pan-x pan-y' : 'none', overflow: zoom > 1 ? 'auto' : 'hidden' }}>
      <div className={`studio-stage${pan ? ' panning' : ''}`} ref={stageRef} style={{ width: stageW, height: stageH }}
        onPointerDown={down} onPointerMove={moveEvent} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDraw(null); }}>
        <img src={item.source} alt={`Photo ${index + 1}: ${item.name}`} draggable={false} onLoad={event => setNatural({ w: event.currentTarget.naturalWidth || 4, h: event.currentTarget.naturalHeight || 3 })} />
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
    {progress && <p role="status" className="studio-progress"><Loader2 size={16} className="spin" /> {progress}</p>}

    {items.length > 1 && <nav className="studio-strip" aria-label="Photos">
      <button className="subtle-btn" aria-label="Previous photo" disabled={busy || index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={18} /></button>
      <div className="studio-thumbs">{items.map((entry, i) => <button key={entry.id} className={`studio-thumb${i === index ? ' current' : ''}`} aria-label={`Photo ${i + 1}, ${plans[entry.id]?.length || 0} boxes`} disabled={busy} onClick={() => setIndex(i)}>
        <img src={entry.source} alt="" loading="lazy" />{!!plans[entry.id]?.length && <b>{plans[entry.id].length}</b>}</button>)}</div>
      <button className="subtle-btn" aria-label="Next photo" disabled={busy || index === items.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={18} /></button>
    </nav>}

    <footer className="studio-actions">
      <button className="primary" disabled={busy || !total} onClick={saveAll}>{progress ? 'Working…' : `Save all${total ? ` (${total} crop${total === 1 ? '' : 's'}${photosWithBoxes > 1 ? `, ${photosWithBoxes} photos` : ''})` : ''}`}</button>
      <button className="subtle-btn" disabled={busy || !total} onClick={saveLater}><Save size={16} /> Save for later</button>
    </footer>

    {confirmOpen && <div className="studio-confirm" role="alertdialog" aria-modal="true" aria-label="Unsaved changes">
      <div>
        <strong>You have unsaved boxes</strong>
        <p>{total ? `${total} box${total === 1 ? '' : 'es'} drawn on ${photosWithBoxes} photo${photosWithBoxes === 1 ? '' : 's'}.` : 'Your changes will be lost.'}</p>
        <button className="primary" disabled={!total} onClick={saveLater}>Save for later</button>
        <button className="subtle-btn danger" onClick={onDiscard}>Discard</button>
        <button className="subtle-btn" onClick={() => setConfirmOpen(false)}>Continue editing</button>
      </div>
    </div>}
  </section></div>;
}
