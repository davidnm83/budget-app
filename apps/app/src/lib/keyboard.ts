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
  const show = (el: Element | null) => {
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    // After the pop-up has moved up, bring the field to the middle of what's left above the keyboard.
    setTimeout(() => (el as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 60);
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
