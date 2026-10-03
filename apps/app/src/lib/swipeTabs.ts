// Phones: a clear sideways swipe on a tab's page moves to the tab beside it (left → next, right →
// previous). Only on the page itself: not while a pop-up is open, not near the screen edges
// (Android's back gesture lives there), and not on anything that scrolls sideways or takes a drag
// of its own (chip rows, charts, sliders, text fields).
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const EDGE = 28;      // px from each side left to the system's own gestures
const MIN_DX = 70;    // how far the finger has to travel sideways
const MAX_MS = 700;   // a swipe, not a slow drag

function ownsSideways(start: Element | null): boolean {
  for (let n = start; n && n !== document.body; n = n.parentElement) {
    if (n.closest('input, textarea, select, svg, [data-scrub], [role="slider"], [role="dialog"], [aria-modal="true"]')) return true;
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

export function useSwipeTabs(enabled: boolean, go: (dir: 1 | -1) => void) {
  const goRef = useRef(go); goRef.current = go;
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    let x0 = 0, y0 = 0, t0 = 0, live = false;
    const start = (e: TouchEvent) => {
      live = false;
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      if (x < EDGE || x > window.innerWidth - EDGE) return;
      if (document.querySelector('[aria-modal="true"]')) return; // a pop-up is open
      if (ownsSideways(e.target as Element)) return;
      x0 = x; y0 = e.touches[0].clientY; t0 = Date.now(); live = true;
    };
    const move = (e: TouchEvent) => {
      if (!live) return;
      const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      // Scrolling the page: once it's clearly vertical, it stays a scroll.
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) live = false;
    };
    const end = (e: TouchEvent) => {
      if (!live) return;
      live = false;
      const p = e.changedTouches[0];
      const dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.abs(dx) >= MIN_DX && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - t0 <= MAX_MS) goRef.current(dx < 0 ? 1 : -1);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end);
    const cancel = () => { live = false; };
    document.addEventListener('touchcancel', cancel);
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', cancel); };
  }, [enabled]);
}
