// The row of weeks or months at the top of the Planner and the Budget: one tab per period with a
// figure under it, scrolling sideways, the open one filled in and the present one marked. It keeps
// the open period in view, with an arrow back to it when scrolled away, and goes back to the present
// period after the page has been left for a while (useBackToNow). The same look and place on both pages.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { EASE } from '@/lib/motion';
import type { Theme } from '@/lib/theme';

export interface Period { key: string; label: string; value?: string; bad?: boolean; dim?: boolean }

/** Title of the open period, and a way back to the present one when you've moved away. */
export function PeriodTitle({ t, title, sub, away, hereText, onHere }: { t: Theme; title: string; sub?: string; away: boolean; hereText: string; onHere: () => void }) {
  return (
    <View style={styles.titleRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 }} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={{ color: t.muted, fontSize: 12 }}>{sub}</Text>}
      </View>
      {away && (
        <Pressable onPress={onHere} accessibilityLabel={`Go to ${hereText.toLowerCase()}`} hitSlop={8} style={[styles.here, { backgroundColor: t.accent + '1f' }]}>
          <Ionicons name="return-down-back" size={14} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>{hereText}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function PeriodStrip({ t, items, selected, current, onSelect }: { t: Theme; items: Period[]; selected: string; current: string; onSelect: (key: string) => void }) {
  const scroll = useRef<ScrollView>(null);
  const cells = useRef(new Map<string, any>());
  const spots = useRef(new Map<string, { x: number; w: number }>());
  const [width, setWidth] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [at, setAt] = useState(0);
  const moved = useRef(false);
  // Where a period sits in the row. On the web, read from the page itself: when months are added in
  // front, the others move without changing size, and onLayout only reports size changes there.
  const spot = (key: string) => {
    const el = cells.current.get(key);
    if (Platform.OS === 'web' && el && typeof el.offsetLeft === 'number') return { x: el.offsetLeft, w: el.offsetWidth };
    return spots.current.get(key);
  };
  const center = (animated: boolean) => {
    const s = spot(selected);
    if (!s || !width) return;
    scroll.current?.scrollTo({ x: Math.max(0, s.x - width / 2 + s.w / 2), animated });
  };
  // Bring the open period to the middle when it changes, when the row is measured or grows, and when
  // the page comes back into view (so a strip left scrolled elsewhere starts where it should).
  useEffect(() => { center(moved.current); moved.current = true; }, [selected, width, contentW, items.length, items[0]?.key]);
  useFocusEffect(useCallback(() => { center(false); }, [selected, width, contentW]));
  // Scrolled away from the open period: an arrow on that side brings it back.
  const s = spot(selected);
  const off = s && width && contentW ? (s.x + s.w < at + 8 ? 'left' : s.x > at + width - 8 ? 'right' : null) : null;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.track, { backgroundColor: t.line }]}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, padding: 3 }}
        onContentSizeChange={(w) => setContentW(w)} onScroll={(e) => setAt(e.nativeEvent.contentOffset.x)} scrollEventThrottle={64}>
        {items.map((p) => {
          const on = p.key === selected, now = p.key === current;
          return (
            <Pressable key={p.key} ref={(el) => { if (el) cells.current.set(p.key, el); else cells.current.delete(p.key); }}
              onPress={() => (on ? center(true) : onSelect(p.key))} accessibilityRole="tab" accessibilityState={{ selected: on }}
              onLayout={(e) => { spots.current.set(p.key, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }); }}
              style={[styles.cell, EASE, on && { backgroundColor: t.accent }, !on && now && { borderColor: t.accent, borderWidth: 1 }]}>
              <Text style={{ color: on ? '#ffffffcc' : now ? t.accent : t.muted, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>{p.label}</Text>
              {p.value != null && <Text style={{ color: on ? '#fff' : p.bad ? t.danger : p.dim ? t.muted : t.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{p.bad && !on ? '⚠ ' : ''}{p.value}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
      {off && (
        <Pressable onPress={() => center(true)} accessibilityLabel="Back to the open period" hitSlop={6}
          style={[styles.back, off === 'left' ? { left: 4 } : { right: 4 }, { backgroundColor: t.accent }]}>
          <Ionicons name={off === 'left' ? 'chevron-back' : 'chevron-forward'} size={16} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Back to the present period after the page (or the app) has been left for a while, so opening the
 * Budget or Planner the next day starts on this month or week rather than wherever it was left.
 */
export function useBackToNow(reset: () => void, minutes = 30) {
  const left = useRef<number | null>(null);
  const resetRef = useRef(reset);
  resetRef.current = reset;
  const check = () => { if (left.current && Date.now() - left.current > minutes * 60_000) resetRef.current(); left.current = null; };
  useFocusEffect(useCallback(() => { check(); return () => { left.current = Date.now(); }; }, []));
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const on = () => { if (document.visibilityState === 'hidden') left.current ??= Date.now(); else check(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  here: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  track: { borderRadius: 10, overflow: 'hidden' },
  back: { position: 'absolute', top: '50%', marginTop: -14, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.92 },
  cell: { minWidth: 76, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
});
