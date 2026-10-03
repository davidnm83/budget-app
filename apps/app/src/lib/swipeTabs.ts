// Phones: a clear sideways swipe on a tab's page moves to the tab beside it (left → next, right →
// previous). Only on the page itself: not while a pop-up is open, not near the screen edges
// (Android's back gesture lives there), and not on anything that scrolls sideways or takes a drag
// of its own (chip rows, charts, sliders, text fields).
//
// While the finger moves, the page follows it and a label for the tab it leads to slides in from
// that side; past the point where letting go switches, the label fills in. Let go short and the
// page springs back. All of it is done on the elements directly: nothing re-renders per frame.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const EDGE = 28;       // px from each side left to the system's own gestures
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

export function useSwipeTabs(enabled: boolean, go: (dir: 1 | -1) => void, peek: (dir: 1 | -1) => string | null, colors: { text: string; card: string; accent: string; line: string }) {
  const goRef = useRef(go); goRef.current = go;
  const peekRef = useRef(peek); peekRef.current = peek;
  const colorRef = useRef(colors); colorRef.current = colors;
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    let x0 = 0, y0 = 0, t0 = 0, state: 'idle' | 'maybe' | 'drag' = 'idle', dx = 0, way: 1 | -1 = 1;
    // The label for the tab the swipe leads to.
    const tag = document.createElement('div');
    tag.style.cssText = 'position:fixed;top:45%;z-index:50;padding:9px 14px;border-radius:20px;font:600 14px system-ui,sans-serif;pointer-events:none;opacity:0;transition:background-color .15s,color .15s;box-shadow:0 4px 16px rgba(0,0,0,.18)';
    document.body.appendChild(tag);
    const paint = (dist: number, dir: 1 | -1) => {
      const c = colorRef.current, past = Math.abs(dist) >= COMMIT;
      tag.style.opacity = String(Math.min(1, Math.abs(dist) / 60));
      tag.style.background = past ? c.accent : c.card; tag.style.color = past ? '#fff' : c.text; tag.style.border = `1px solid ${past ? c.accent : c.line}`;
      const inset = Math.min(16, -40 + Math.abs(dist) * 0.6);
      tag.style.left = dir === 1 ? '' : `${inset}px`; tag.style.right = dir === 1 ? `${inset}px` : '';
      if (scene) { scene.style.transition = 'none'; scene.style.transform = `translateX(${dist * 0.45}px)`; scene.style.opacity = String(1 - Math.min(0.35, Math.abs(dist) / 600)); }
    };
    const reset = (animate: boolean) => {
      tag.style.opacity = '0';
      if (!scene) return;
      scene.style.transition = animate ? 'transform 200ms cubic-bezier(0.2,0.9,0.2,1), opacity 200ms' : 'none';
      scene.style.transform = 'translateX(0px)'; scene.style.opacity = '1';
    };
    const start = (e: TouchEvent) => {
      state = 'idle';
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      if (x < EDGE || x > window.innerWidth - EDGE) return;
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
        const target = peekRef.current(way);
        if (!target) { state = 'idle'; return; }    // nothing that way (first or last tab)
        state = 'drag'; tag.textContent = way === 1 ? `${target} ›` : `‹ ${target}`;
      }
      if ((dx < 0 ? 1 : -1) !== way) { state = 'idle'; reset(true); return; } // turned back past where it started
      if (e.cancelable) e.preventDefault();
      paint(dx, dx < 0 ? 1 : -1);
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
      tag.remove();
    };
  }, [enabled]);
}
