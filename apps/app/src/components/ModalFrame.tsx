// The frame every pop-up shares. On phones it is a sheet that slides up over a dimmed page; on wide screens
// it is a centred panel over a dimmed page (click outside to close).
//   fit: the panel is only as tall as its content (forms); otherwise it takes most of the height (lists).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FADE, POP, SHEET } from '@/lib/motion';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

export function ModalFrame({ visible = true, onClose, children, fit, width = 560 }: {
  /** May return false to stay open (unsaved changes: the form asks first). */
  visible?: boolean; onClose: () => void | boolean; children: ReactNode; fit?: boolean; width?: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  if (!wide) {
    // Phones: a sheet that rises from the bottom. Forms take only the height they need; lists
    // (pickers) take most of the screen. The page behind stays visible so you keep your place.
    return <PhoneSheet visible={visible} onClose={onClose} fit={fit}>{children}</PhoneSheet>;
  }
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <View style={[StyleSheet.absoluteFill, styles.dim, FADE]} pointerEvents="none" />
        <Pressable onPress={() => {}} style={[styles.panel, POP, { backgroundColor: t.bg, borderColor: t.line, maxWidth: width }, fit ? { maxHeight: '90%' } : { height: '90%' }]}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The dimming fades in place while only the sheet itself slides up. The page behind is dimmed, not
 * blurred: blurring a whole page on every frame of the slide is what made pop-ups stutter on phones.
 */
function PhoneSheet({ visible, onClose, children, fit }: { visible: boolean; onClose: () => void | boolean; children: ReactNode; fit?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Drag down to close, from anywhere on the sheet as long as whatever is under your finger is
  // scrolled to its top (so a list still scrolls normally). A short drag springs back.
  // A full-height sheet starts rising empty and its content is drawn a frame later, so the tap is
  // answered at once even when the content takes a moment to build. (A sheet sized by its content
  // needs the content first, to know how tall to be.)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!visible) { setReady(false); return; }
    if (Platform.OS !== 'web') { setReady(true); return; }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, [visible]);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const sheet = useRef<any>(null);
  useEffect(() => {
    const el = sheet.current as HTMLElement | null;
    if (Platform.OS !== 'web' || !visible || !el?.addEventListener) return;
    let y0 = 0, x0 = 0, t0 = 0, state: 'idle' | 'maybe' | 'drag' = 'idle', last = 0;
    const atTop = (target: Element | null) => {
      for (let n = target; n && n !== el; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return false;
      }
      return true;
    };
    const start = (e: TouchEvent) => {
      const target = e.target as Element | null;
      state = 'idle';
      if (e.touches.length !== 1 || !target || target.closest('input, textarea, select, [role="slider"]')) return;
      if (!atTop(target)) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = Date.now(); state = 'maybe';
    };
    const move = (e: TouchEvent) => {
      if (state === 'idle') return;
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      if (state === 'maybe') {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { state = 'idle'; return; } // a sideways swipe (chips, tabs)
        if (dy < -4) { state = 'idle'; return; }                                        // scrolling up the list
        if (dy > 8) state = 'drag'; else return;
      }
      if (e.cancelable) e.preventDefault();
      // Move the sheet itself, straight on the element: no re-render per frame.
      last = Math.max(0, dy); el.style.transition = 'none'; el.style.transform = `translateY(${last}px)`;
    };
    const end = () => {
      if (state !== 'drag') { state = 'idle'; return; }
      state = 'idle';
      const fast = last / Math.max(1, Date.now() - t0) > 0.9;
      const back = () => { el.style.transition = 'transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1)'; el.style.transform = 'translateY(0px)'; };
      if (last > 110 || (fast && last > 40)) { if (closeRef.current() === false) back(); }
      else back();
    };
    el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); };
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.phoneScrim} onPress={onClose}>
        <View style={[StyleSheet.absoluteFill, styles.phoneDim, FADE]} pointerEvents="none" />
        <View ref={sheet} style={[styles.sheet, SHEET, { backgroundColor: t.bg, marginTop: insets.top + 24 }, fit ? { maxHeight: '100%' } : { flex: 1 }]}>
          <Pressable onPress={() => {}} style={[{ cursor: 'auto' as any }, fit ? { flexShrink: 1 } : { flex: 1 }]}>
            <View style={styles.grabZone} accessibilityLabel="Drag down to close"><View style={[styles.grabber, { backgroundColor: t.muted }]} /></View>
            {fit || ready ? children : null}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // The dimming is its own layer so it can fade in under a sheet that stays solid (see FADE).
  // --kb: the keyboard's height while it's up (lib/keyboard), so the sheet sits above it and its Save button stays in reach.
  phoneScrim: { flex: 1, justifyContent: 'flex-end', paddingBottom: 'var(--kb, 0px)', transitionProperty: 'padding-bottom', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' } as any,
  phoneDim: { backgroundColor: 'rgba(0,0,0,0.38)' },
  dim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -8px 30px rgba(0,0,0,0.18)' as any, overflow: 'hidden', flexShrink: 1, cursor: 'auto' as any },
  grabZone: { height: 26, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, opacity: 0.45 },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 } as any,
  panel: { width: '100%', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' as any, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', cursor: 'auto' as any },
});
