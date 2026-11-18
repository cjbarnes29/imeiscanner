import { useEffect, useRef } from 'react';

// Browser/Android Back should close the popup you are in, not leave the app.
// Each open popup adds one history entry and sits on a stack; Back closes only
// the TOP popup (a crop editor inside a review window closes first). Closing a
// popup with its own button removes its history entry again so history never
// piles up. One shared listener handles every Back press.
type Layer = { id: string; close: () => void; handled: boolean };
const stack: Layer[] = [];
let removing = 0; // Back presses we triggered ourselves by removing a closed popup's entry
export const removingBackLayer = () => removing > 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', event => {
    if (removing > 0) {
      removing--;
      event.stopImmediatePropagation(); // Removing a popup is not a request to navigate to the screen underneath it.
      if (!removing) window.dispatchEvent(new Event('imei-layer-removed'));
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return;
    top.handled = true;
    top.close();
  });
}

export function useBackLayer(open: boolean, close: () => void, id: string) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const layer: Layer = { id, close: () => closeRef.current(), handled: false };
    let added = false;
    const add = () => {
      history.pushState({ imeiLayer: id, imeiDepth: (Number(history.state?.imeiDepth) || 0) + 1 }, '');
      stack.push(layer); added = true;
    };
    if (removing) window.addEventListener('imei-layer-removed', add, { once: true });
    else add();
    return () => {
      window.removeEventListener('imei-layer-removed', add);
      if (!added) return;
      const index = stack.indexOf(layer);
      if (index >= 0) stack.splice(index, 1);
      // Closed by its own button (not by Back): drop the entry we added.
      if (!layer.handled && history.state?.imeiLayer === id) { removing++; history.back(); }
    };
  }, [open, id]);
}
