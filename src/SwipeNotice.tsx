import {useEffect,useRef,useState,type ReactNode} from 'react';
export function SwipeNotice({noticeKey,children}:{noticeKey:string;children:ReactNode}){const key='retaillens-dismissed-multi-v1';const [hidden,setHidden]=useState(()=>{try{return localStorage.getItem(key)===noticeKey;}catch{return false;}}),start=useRef<{x:number;y:number}|null>(null);const dismiss=()=>{setHidden(true);try{localStorage.setItem(key,noticeKey);}catch{}};if(hidden)return null;return <div className="swipe-notice" aria-label="Multi-product review notice" style={{touchAction:'pan-y'}} onPointerDown={e=>{if((e.target as HTMLElement).closest('button,a,input'))return;start.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const from=start.current;start.current=null;if(from&&Math.abs(e.clientX-from.x)>70&&Math.abs(e.clientY-from.y)<50)dismiss();}} onPointerCancel={()=>{start.current=null;}}><button className="notice-dismiss" aria-label="Dismiss multi-product notice" onClick={dismiss}>×</button>{children}<small className="settings-help">Swipe sideways to dismiss. Photos remain available in Phones → Needs review.</small></div>;}

export function SwipeToast({children,onDismiss}:{children:ReactNode;onDismiss:()=>void}){const start=useRef<{x:number;y:number}|null>(null);return <div className="toast" role="status" style={{touchAction:'pan-y'}} onPointerDown={e=>{start.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const from=start.current;start.current=null;if(from&&Math.abs(e.clientX-from.x)>55&&Math.abs(e.clientY-from.y)<60)onDismiss();}} onPointerCancel={()=>{start.current=null;}}><span>{children}</span><button aria-label="Dismiss notification" onClick={onDismiss}>×</button></div>;}

/** How long an Undo popup stays: 2 seconds (a test may set localStorage "imei-lens-undo-ms"). */
export const UNDO_SHOW_MS = 2000;
export const undoMs = (): number => { try { const n = Number(localStorage.getItem('imei-lens-undo-ms')); return n >= 200 && n <= 120000 ? n : UNDO_SHOW_MS; } catch { return UNDO_SHOW_MS; } };
/** A sideways swipe of more than 55 px that stays mostly level takes the popup away. */
export const swipedAway = (dx: number, dy: number): boolean => Math.abs(dx) > 55 && Math.abs(dy) < 60;

/**
 * The Undo popup ("Asha deleted. Undo", "3 duplicates archived…"). It leaves by itself after 2 seconds, and sooner when it is swiped away sideways.
 * While a finger is on it the clock waits, so the Undo button can still be pressed. A new message must come with a new `key` so the clock starts again.
 */
export function SwipeUndoBar({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [held, setHeld] = useState(false);
  const [dx, setDx] = useState(0);
  useEffect(() => { if (held) return; const timer = setTimeout(() => dismissRef.current(), undoMs()); return () => clearTimeout(timer); }, [held]);
  const release = () => { start.current = null; setHeld(false); setDx(0); };
  return <div className="undo-bar" role="status" style={{ touchAction: 'pan-y', translate: `${dx}px 0`, opacity: 1 - Math.min(0.6, Math.abs(dx) / 220) }}
    onPointerDown={e => { start.current = { x: e.clientX, y: e.clientY }; setHeld(true); }}
    onPointerMove={e => { const from = start.current; if (from && Math.abs(e.clientY - from.y) < 60) setDx(e.clientX - from.x); }}
    onPointerUp={e => { const from = start.current; if (from && swipedAway(e.clientX - from.x, e.clientY - from.y)) { start.current = null; dismissRef.current(); return; } release(); }}
    onPointerCancel={release}>{children}</div>;
}
