// The grab handle of a bottom sheet: drag it down to close the sheet (a short drag springs back). Uses the "translate" property so it does not fight the sheet's entrance animation.
import { useRef } from 'react';

export function SheetHandle({ onClose }: { onClose: () => void }) {
  const start = useRef<number | null>(null);
  const sheetOf = (el: HTMLElement) => el.closest('.modal') as HTMLElement | null;
  return <div className="sheet-grab" role="presentation"
    onPointerDown={event => { start.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); const sheet = sheetOf(event.currentTarget); if (sheet) sheet.style.transition = 'none'; }}
    onPointerMove={event => { if (start.current === null) return; const sheet = sheetOf(event.currentTarget); if (sheet) sheet.style.translate = `0 ${Math.max(0, event.clientY - start.current)}px`; }}
    onPointerUp={event => { if (start.current === null) return; const drop = event.clientY - start.current; start.current = null; const sheet = sheetOf(event.currentTarget); if (sheet) { sheet.style.transition = 'translate .25s ease'; sheet.style.translate = ''; } if (drop > 90) onClose(); }}
    onPointerCancel={event => { start.current = null; const sheet = sheetOf(event.currentTarget); if (sheet) { sheet.style.transition = ''; sheet.style.translate = ''; } }} />;
}
