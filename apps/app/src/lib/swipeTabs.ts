// Phones: a sideways swipe along the bottom navigation bar (on it or just above it) moves to the
// tab beside it (left → next, right → previous). Swipes anywhere else on the page are left alone,
// so chip rows, charts and lists never switch tabs by accident. Not near the screen edges (Android's
// back gesture lives there) and not while a pop-up is open.
//
// While the finger moves, the page follows it; let go far enough and the next tab slides in from
// that side, short of that and the page springs back. Done on the element directly: nothing
// re-renders per frame.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const EDGE = 28;       // px from each side left to the system's own gestures
const ZONE = 130;      // px up from the bottom of the screen: the bar and a strip just above it
const COMMIT = 90;     // how far the finger has to travel sideways to switch
const FLICK = 50;      // or this far, quickly
const FLICK_MS = 250;

/** The page that is showing now (each tab's scene registers itself while it is focused). */
let scene: HTMLElement | null = null;
export function setActiveScene(el: HTMLElement | null) { scene = el; }

/** Which side the next page should slide in from, once (set by a swipe, read by the page's entrance). */
let enterFrom: 1 | -1 | 0 = 0;
export function takeEnterFrom(): 1 | -1 | 0 { const d = enterFrom; enterFrom = 0; return d; }

function ownsSideways(start: Element | null): boolean {
  for (let n = start; n && n !== document.body; n = n.parentElement) {
    if (n.closest('input, textarea, select, svg, [data-scrub], [role="slider"], [role="dialog"], [aria-modal="true"]')) return true;
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

/** `can(dir)`: whether there is a tab that way (not past the first or last). */
export function useSwipeTabs(enabled: boolean, go: (dir: 1 | -1) => void, can: (dir: 1 | -1) => boolean) {
  const goRef = useRef(go); goRef.current = go;
  const canRef = useRef(can); canRef.current = can;
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    let x0 = 0, y0 = 0, t0 = 0, state: 'idle' | 'maybe' | 'drag' = 'idle', dx = 0, way: 1 | -1 = 1;
    const paint = (dist: number) => {
      if (scene) { scene.style.transition = 'none'; scene.style.transform = `translateX(${dist * 0.45}px)`; scene.style.opacity = String(1 - Math.min(0.35, Math.abs(dist) / 600)); }
    };
    const reset = (animate: boolean) => {
      if (!scene) return;
      scene.style.transition = animate ? 'transform 200ms cubic-bezier(0.2,0.9,0.2,1), opacity 200ms' : 'none';
      scene.style.transform = 'translateX(0px)'; scene.style.opacity = '1';
    };
    const start = (e: TouchEvent) => {
      state = 'idle';
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      if (x < EDGE || x > window.innerWidth - EDGE) return;
      if (e.touches[0].clientY < window.innerHeight - ZONE) return; // only along the bottom bar
      if (document.querySelector('[aria-modal="true"]')) return; // a pop-up is open
      if (ownsSideways(e.target as Element)) return;
      x0 = x; y0 = e.touches[0].clientY; t0 = Date.now(); state = 'maybe'; dx = 0;
    };
    const move = (e: TouchEvent) => {
      if (state === 'idle') return;
      dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (state === 'maybe') {
        // Scrolling the page: once it's clearly vertical, it stays a scroll.
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { state = 'idle'; return; }
        if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        way = dx < 0 ? 1 : -1;
        if (!canRef.current(way)) { state = 'idle'; return; }    // nothing that way (first or last tab)
        state = 'drag';
      }
      if ((dx < 0 ? 1 : -1) !== way) { state = 'idle'; reset(true); return; } // turned back past where it started
      if (e.cancelable) e.preventDefault();
      paint(dx);
    };
    const end = () => {
      if (state !== 'drag') { state = 'idle'; return; }
      state = 'idle';
      const quick = Date.now() - t0 < FLICK_MS && Math.abs(dx) >= FLICK;
      if (Math.abs(dx) >= COMMIT || quick) {
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        enterFrom = dir;
        const old = scene;
        reset(false);
        if (old) { old.style.transform = ''; old.style.opacity = ''; }
        goRef.current(dir);
      } else reset(true);
    };
    const cancel = () => { if (state === 'drag') reset(true); state = 'idle'; };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', cancel);
    return () => {
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', cancel);
    };
  }, [enabled]);
}
