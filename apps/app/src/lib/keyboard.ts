// Phones: the keyboard is drawn over the page instead of shrinking it. Shrinking the window is
// what showed a black bar (the app's startup colour) for a moment before the keyboard slid up,
// and it made pop-ups jump. Instead, the keyboard's height is kept in the CSS variable --kb, which
// pop-ups use to sit above it, and the field being typed in is scrolled into view.
// Uses Chrome's VirtualKeyboard API; where it's missing, the browser's own behaviour stays.
export function installKeyboard(): () => void {
  const vk = typeof navigator !== 'undefined' ? (navigator as any).virtualKeyboard : null;
  if (!vk || typeof document === 'undefined') return () => {};
  vk.overlaysContent = true;
  const root = document.documentElement;
  // After the pop-up has moved up, bring the field into view inside the list it sits in. Only that list
  // scrolls: never the page itself (moving the page is what showed a bar under it).
  const show = (el: Element | null) => {
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    setTimeout(() => {
      let box: HTMLElement | null = el.parentElement;
      while (box && box !== document.body && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
      if (!box || box === document.body) return;
      const kb = vk.boundingRect?.height ?? 0;
      const room = box.getBoundingClientRect(), f = el.getBoundingClientRect();
      const bottom = Math.min(room.bottom, window.innerHeight - kb) - 16, top = room.top + 16;
      if (f.bottom > bottom) box.scrollBy({ top: f.bottom - bottom, behavior: 'smooth' });
      else if (f.top < top) box.scrollBy({ top: f.top - top, behavior: 'smooth' });
    }, 80);
  };
  const onGeometry = () => {
    const h = Math.round(vk.boundingRect?.height ?? 0);
    root.style.setProperty('--kb', `${h}px`);
    if (h > 0) show(document.activeElement);
  };
  const onFocus = (e: FocusEvent) => { if ((vk.boundingRect?.height ?? 0) > 0) show(e.target as Element); };
  vk.addEventListener('geometrychange', onGeometry);
  document.addEventListener('focusin', onFocus);
  return () => { vk.removeEventListener('geometrychange', onGeometry); document.removeEventListener('focusin', onFocus); vk.overlaysContent = false; root.style.removeProperty('--kb'); };
}
