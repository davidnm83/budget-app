// Phones: a sideways swipe along the bottom navigation bar (on it or just above it) moves to the
// tab beside it (left → next, right → previous). Swipes anywhere else on the page are left alone,
// so chip rows, charts and lists never switch tabs by accident. Not near the screen edges (Android's
// back gesture lives there) and not while a pop-up is open.
//
// Like a row of pages: while the finger moves, the page and the one beside it move together, edge to
// edge. Let go past a third of the way (or with a flick) and the next page settles in; short of that
// both slide back. The tab only changes once the slide has finished, so the work of switching happens
// with the new page already in place. Done on the elements directly: nothing re-renders per frame.
//
// On the web the tabs that have been opened stay laid out under the current one (the navigator stacks
// them), so the page beside is already drawn; the tab bar loads the pages beside the current one ahead
// of time (see preload in app/(tabs)/_layout). If one isn't there yet, the current page follows the
// finger part of the way and the next one slides in once it's open.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const EDGE = 28;       // px from each side left to the system's own gestures
const ZONE = 130;      // px up from the bottom of the screen: the bar and a strip just above it
const COMMIT = 0.33;   // share of the width the finger has to travel to switch
const FLICK = 50;      // or this far, quickly
const FLICK_MS = 250;
const SETTLE_MS = 240;
const EASE = 'cubic-bezier(0.2, 0.9, 0.2, 1)';

/** Each tab's page, by route name (registered while mounted), and the one showing now. */
const scenes = new Map<string, HTMLElement>();
let scene: HTMLElement | null = null;
export function registerScene(name: string, el: HTMLElement | null) { if (el) scenes.set(name, el); else scenes.delete(name); }
export function hasScene(name: string) { return scenes.has(name); }
export function setActiveScene(el: HTMLElement | null) { scene = el; }

/** Which side the next page should slide in from, once (only when the page beside wasn't there to drag along). */
let enterFrom: 1 | -1 | 0 = 0;

// For that case: between letting go and the next page's entrance starting, the next page is kept hidden.
// Its entrance only starts once it has been drawn, so without this it showed for a frame in its final
// place first.
const HIDE = 'html[data-swiping] [data-scene]:not([data-leaving]) { opacity: 0 !important; }';
let hideTimer: ReturnType<typeof setTimeout> | null = null;
function hideNext(on: boolean) {
  const root = document.documentElement;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (!on) { root.removeAttribute('data-swiping'); return; }
  if (!document.getElementById('swipe-hide')) { const st = document.createElement('style'); st.id = 'swipe-hide'; st.textContent = HIDE; document.head.appendChild(st); }
  root.setAttribute('data-swiping', '');
  hideTimer = setTimeout(() => hideNext(false), 700); // in case the next page never says it's in
}

/** Put the dragged pages back to normal: run once the new tab has taken over (or right away when cancelled). */
let tidy: (() => void) | null = null;
function runTidy() { const f = tidy; tidy = null; f?.(); }

/** Called by a tab's page as it comes into view. */
export function enterScene(el: HTMLElement | null) {
  runTidy();
  const d = enterFrom; enterFrom = 0;
  if (typeof document === 'undefined') return;
  if (d && el?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.animate([{ opacity: 0.4, transform: `translateX(${d * 60}px)` }, { opacity: 1, transform: 'translateX(0px)' }], { duration: 220, easing: EASE });
  }
  hideNext(false); // same task as the animation's start, so nothing is drawn in between
}

/** The element the navigator positions for a page: the page's ancestor just inside the box holding all the pages. */
function frames(a: HTMLElement, b: HTMLElement): [HTMLElement, HTMLElement] | null {
  const up = new Set<HTMLElement>();
  for (let n: HTMLElement | null = a; n; n = n.parentElement) up.add(n);
  let common: HTMLElement | null = b;
  while (common && !up.has(common)) common = common.parentElement;
  if (!common) return null;
  const childOf = (x: HTMLElement) => { let n = x; while (n.parentElement && n.parentElement !== common) n = n.parentElement; return n.parentElement === common ? n : null; };
  const fa = childOf(a), fb = childOf(b);
  return fa && fb && fa !== fb ? [fa, fb] : null;
}

function ownsSideways(start: Element | null): boolean {
  for (let n = start; n && n !== document.body; n = n.parentElement) {
    if (n.closest('input, textarea, select, svg, [data-scrub], [role="slider"], [role="dialog"], [aria-modal="true"]')) return true;
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

/** `beside(dir)`: the route name of the tab that way, or null at the first or last. */
export function useSwipeTabs(enabled: boolean, beside: (dir: 1 | -1) => string | null, go: (dir: 1 | -1) => void) {
  const goRef = useRef(go); goRef.current = go;
  const besideRef = useRef(beside); besideRef.current = beside;
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    let x0 = 0, y0 = 0, t0 = 0, state: 'idle' | 'maybe' | 'drag' = 'idle', dx = 0, way: 1 | -1 = 1;
    // While dragging with the page beside: the two frames and the width they move across.
    let pair: { cur: HTMLElement; next: HTMLElement; w: number } | null = null;

    const set = (el: HTMLElement, x: number, ms = 0) => {
      el.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
      el.style.transform = `translateX(${x}px)`;
    };
    // The page beside is lifted above the other stacked pages while it's dragged in; afterwards the navigator's
    // own value applies again (it has usually written its own by then, which is left alone).
    let lifted: { el: HTMLElement; z: string } | null = null;
    const clear = (...els: HTMLElement[]) => {
      for (const el of els) { el.style.transition = ''; el.style.transform = ''; }
      if (lifted) { if (lifted.el.style.zIndex === '5') lifted.el.style.zIndex = lifted.z; lifted = null; }
    };
    const paint = (dist: number) => {
      if (pair) { set(pair.cur, dist); set(pair.next, dist + way * pair.w); return; }
      if (scene) { scene.style.transition = 'none'; scene.style.transform = `translateX(${dist * 0.45}px)`; scene.style.opacity = String(1 - Math.min(0.35, Math.abs(dist) / 600)); }
    };
    const springBack = () => {
      if (pair) {
        const { cur, next, w } = pair; pair = null;
        set(cur, 0, 200); set(next, way * w, 200);
        setTimeout(() => clear(cur, next), 220);
        return;
      }
      if (!scene) return;
      scene.style.transition = 'transform 200ms cubic-bezier(0.2,0.9,0.2,1), opacity 200ms';
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
      runTidy(); // a slide still settling from the last swipe
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
        const name = besideRef.current(way);
        if (!name) { state = 'idle'; return; }    // nothing that way (first or last tab)
        const next = scenes.get(name);
        const f = scene && next ? frames(scene, next) : null;
        pair = f ? { cur: f[0], next: f[1], w: f[0].offsetWidth } : null;
        if (pair) { lifted = { el: pair.next, z: pair.next.style.zIndex }; pair.next.style.zIndex = '5'; }
        state = 'drag';
      }
      if ((dx < 0 ? 1 : -1) !== way) { state = 'idle'; springBack(); return; } // turned back past where it started
      if (e.cancelable) e.preventDefault();
      paint(dx);
    };
    const end = () => {
      if (state !== 'drag') { state = 'idle'; return; }
      state = 'idle';
      const quick = Date.now() - t0 < FLICK_MS && Math.abs(dx) >= FLICK;
      const far = Math.abs(dx) >= COMMIT * (pair?.w ?? window.innerWidth);
      if (!far && !quick) { springBack(); return; }
      const dir = way;
      if (pair) {
        // Both pages finish the slide; then the tab changes under them, and they're put straight once it has.
        const { cur, next, w } = pair; pair = null;
        const ms = Math.max(120, Math.round(SETTLE_MS * (1 - Math.min(1, Math.abs(dx) / w) * 0.5)));
        set(cur, -dir * w, ms); set(next, 0, ms);
        tidy = () => clear(cur, next);
        setTimeout(() => {
          goRef.current(dir);
          setTimeout(runTidy, 600); // in case the new page doesn't report in
        }, ms);
        return;
      }
      // The page beside wasn't open yet: it slides in once it is.
      enterFrom = dir;
      const old = scene;
      old?.setAttribute('data-leaving', '');
      hideNext(true);
      goRef.current(dir);
      setTimeout(() => { if (old) { old.removeAttribute('data-leaving'); old.style.transition = 'none'; old.style.transform = ''; old.style.opacity = ''; } }, 400);
    };
    const cancel = () => { if (state === 'drag') springBack(); state = 'idle'; };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', cancel);
    return () => {
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', cancel);
    };
  }, [enabled]);
}
