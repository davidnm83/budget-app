// Pull down to refresh, on every page (phones and tablets). The page showing registers how to
// reload itself; a pull from the top of whatever is scrolling runs it. The browser's own
// pull-to-reload (which restarts the whole app) is switched off in the root layout.
import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

let handler: (() => unknown) | null = null;
let pull = 0;          // 0–1 while dragging, 2 while refreshing
const subs = new Set<() => void>();
const set = (v: number) => { if (v !== pull) { pull = v; subs.forEach((f) => f()); } };

/** Register this page's reload while it is the one showing. */
export function usePullRefresh(fn: () => unknown) {
  useFocusEffect(useCallback(() => { handler = fn; return () => { if (handler === fn) handler = null; }; }, [fn]));
}
export function usePullState(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => pull, () => 0);
}
export async function refreshNow() {
  if (!handler) return;
  set(2);
  try { await handler(); } finally { setTimeout(() => set(0), 350); }
}

const THRESHOLD = 84;
/** Attach the touch listeners (web). Returns a function that removes them. */
export function installPullRefresh(): () => void {
  if (typeof document === 'undefined') return () => {};
  let startY = 0, tracking = false;
  const scroller = (el: Element | null): Element | null => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  };
  const start = (e: TouchEvent) => {
    const target = e.target as Element | null;
    tracking = false;
    if (!handler || pull === 2 || !target || e.touches.length !== 1) return;
    if (target.closest('[aria-modal="true"], input, textarea')) return; // not inside pop-ups or while typing
    const sc = scroller(target);
    if (sc && sc.scrollTop > 0) return;
    startY = e.touches[0].clientY; tracking = true;
  };
  const move = (e: TouchEvent) => {
    if (!tracking) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { set(0); return; }
    set(Math.min(1, dy / THRESHOLD));
  };
  const end = () => {
    if (!tracking) return;
    tracking = false;
    if (pull >= 1) refreshNow(); else set(0);
  };
  document.addEventListener('touchstart', start, { passive: true });
  document.addEventListener('touchmove', move, { passive: true });
  document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
  return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end); };
}
