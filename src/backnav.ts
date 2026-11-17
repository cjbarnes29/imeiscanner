// The phone's Back button: it goes to the screen you came from. Only on the first screen does Back leave the app.
// (Popups are handled by back-layer.ts: Back closes the top popup first, so this file only follows the screens.)
import { useEffect, useRef } from 'react';

/**
 * `view` is a string that names the screen that is open; `restore` opens a screen from that string without making a new history step.
 * Every new screen is one history step.
 */
export function useBackNav(view: string, restore: (view: string) => void) {
  const current = useRef(view);
  const skip = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    if (current.current === view) return;
    current.current = view;
    if (skip.current) { skip.current = false; return; }
    history.pushState({ v: view }, '');
  }, [view]);

  useEffect(() => {
    if (history.state === null) history.replaceState({ v: current.current }, '');
    const onPop = (event: PopStateEvent) => {
      const next = event.state?.v;
      if (typeof next === 'string' && next !== current.current) { skip.current = true; restoreRef.current(next); setTimeout(() => { skip.current = false; }, 400); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
