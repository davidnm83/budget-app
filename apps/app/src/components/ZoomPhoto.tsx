// A photo full screen, to look at closely: pinch or double-tap to zoom, drag to move around. Only the photo zooms
// (pop-ups don't, so the page behind them can't be zoomed by accident).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBackToClose } from '@/lib/useBackToClose';

const MAX = 6;

export function ZoomPhoto({ uri, onClose }: { uri: string; onClose: () => void }) {
  useBackToClose(true, onClose);
  const area = useRef<any>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const live = useRef(view);
  live.current = view;

  useEffect(() => {
    const el: HTMLElement | null = area.current;
    if (!el || typeof el.addEventListener !== 'function') return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { dist: number; scale: number; mid: { x: number; y: number }; x: number; y: number } | null = null;
    let drag: { x: number; y: number; ox: number; oy: number } | null = null;
    let lastTap = 0;
    let tap: { x: number; y: number; at: number } | null = null; // one finger down: a tap if it barely moves
    const clamp = (s: number, x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const mx = (r.width * (s - 1)) / 2, my = (r.height * (s - 1)) / 2;
      return { scale: s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
    };
    const centre = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const down = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = live.current;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        start = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: v.scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: v.x, y: v.y };
        drag = null;
        tap = null;
      } else if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, ox: v.x, oy: v.y }; tap = { x: e.clientX, y: e.clientY, at: Date.now() }; }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (start && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const s = Math.max(1, Math.min(MAX, (start.scale * Math.hypot(a.x - b.x, a.y - b.y)) / start.dist));
        // Keep the point between the fingers under the fingers.
        const c = centre(), k = s / start.scale;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        setView(clamp(s, (start.x - (start.mid.x - c.x)) * k + (start.mid.x - c.x) + (mid.x - start.mid.x), (start.y - (start.mid.y - c.y)) * k + (start.mid.y - c.y) + (mid.y - start.mid.y)));
      } else if (drag && live.current.scale > 1) {
        setView(clamp(live.current.scale, drag.ox + e.clientX - drag.x, drag.oy + e.clientY - drag.y));
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) start = null;
      if (!pts.size) {
        drag = null;
        const now = Date.now();
        const tapped = !!tap && now - tap.at < 250 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12;
        tap = null;
        if (!tapped) return;
        if (now - lastTap < 300) {
          // Double tap: zoom in where tapped, or back out.
          const v = live.current, c = centre();
          setView(v.scale > 1 ? { scale: 1, x: 0, y: 0 } : clamp(2.5, -(e.clientX - c.x) * 1.5, -(e.clientY - c.y) * 1.5));
          lastTap = 0;
        } else lastTap = now;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = live.current;
      setView(clamp(Math.max(1, Math.min(MAX, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), v.x, v.y));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.back}>
        <View ref={area} style={[styles.area, { touchAction: 'none' } as any]} accessibilityLabel="Receipt photo, pinch to zoom">
          <Image source={{ uri }} resizeMode="contain"
            style={[StyleSheet.absoluteFill, { transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.scale }] }]} />
        </View>
        <View style={styles.bar} pointerEvents="box-none">
          <Text style={styles.hint}>{view.scale > 1 ? 'Double-tap to fit' : 'Pinch or double-tap to zoom'}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" style={styles.close}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: '#000' },
  area: { flex: 1, overflow: 'hidden' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  hint: { color: 'rgba(255,255,255,0.75)', flex: 1, fontSize: 13 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
