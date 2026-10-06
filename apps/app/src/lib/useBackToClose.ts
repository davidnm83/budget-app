// On the web (incl. the app installed from Chrome), pop-ups aren't pages, so the back gesture
// would leave the page underneath. While a pop-up is open this adds a history entry for it:
// back then closes the pop-up instead. Closing it with its own button removes that entry again.
// On Android/iOS the Modal's onRequestClose already handles the back gesture.
//
// Open pop-ups are kept in a stack (a category picker on top of the bill form, say), and a back
// closes only the top one. The router rewrites history entries' state as it likes, so we don't
// rely on tags stored there.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

interface Entry { close: () => void | boolean; closedByBack: boolean }
const stack: Entry[] = [];
let ownBacks = 0; // history.back() calls we made ourselves, whose popstate must be ignored
let listening = false;

let waiting: (() => void)[] = [];
let closedAt = 0;
/** True for a moment after a pop-up closes (pages use it to skip a reload the router's step back can set off). */
export const justClosed = () => Date.now() - closedAt < 1500;
function flush() { const w = waiting; waiting = []; w.forEach((f) => f()); }

function onPop() {
  if (ownBacks > 0) { ownBacks--; if (ownBacks === 0) flush(); return; }
  const top = stack.pop();
  if (!top) return;
  closedAt = Date.now();
  top.closedByBack = true;
  // A pop-up with unsaved changes can decline (it asks first): it stays open, with its history entry back.
  if (top.close() === false) {
    top.closedByBack = false;
    window.history.pushState({ ...(window.history.state ?? {}) }, '');
    stack.push(top);
  }
}

/** `onClose` may return false to stay open (a form asking before it drops unsaved changes). */
export function useBackToClose(visible: boolean, onClose: () => void | boolean) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || typeof window === 'undefined') return;
    if (!listening) { window.addEventListener('popstate', onPop); listening = true; }
    // Keep the router's own state in the entry so it sees "the same page" when we go back to it.
    window.history.pushState({ ...(window.history.state ?? {}) }, '');
    const entry: Entry = { close: () => close.current(), closedByBack: false };
    stack.push(entry);
    return () => {
      if (entry.closedByBack) return;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      closedAt = Date.now();
      ownBacks++;
      window.history.back();
    };
  }, [visible]);
}

/**
 * Navigate after closing a pop-up: `onClose(); afterClose(() => router.push(...))`.
 * Closing a pop-up steps history back, which finishes a moment later; navigating before it does
 * gets undone by that step back. On native this just runs `fn`.
 */
export function afterClose(fn: () => void) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') { fn(); return; }
  // Let React close the pop-up first (its effect cleanup is what starts the step back).
  setTimeout(() => {
    if (ownBacks === 0) { fn(); return; }
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    waiting.push(run);
    setTimeout(() => { if (!done) { ownBacks = 0; waiting = []; run(); } }, 600); // in case the step back is never reported
  }, 80);
}
