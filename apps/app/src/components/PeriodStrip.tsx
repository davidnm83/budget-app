// The row of weeks or months at the top of the Planner and the Budget: one tab per period with a
// figure under it, scrolling sideways, the open one filled in and the present one marked. It keeps
// the open period in view. The same look and place on both pages.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const spots = useRef(new Map<string, { x: number; w: number }>());
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(0);
  // Bring the open period to the middle when it changes (or once everything has been measured).
  useEffect(() => {
    const s = spots.current.get(selected);
    if (s && width) scroll.current?.scrollTo({ x: Math.max(0, s.x - width / 2 + s.w / 2), animated: ready > 1 });
  }, [selected, width, ready]);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.track, { backgroundColor: t.line }]}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, padding: 3 }}>
        {items.map((p) => {
          const on = p.key === selected, now = p.key === current;
          return (
            <Pressable key={p.key} onPress={() => onSelect(p.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              onLayout={(e) => { spots.current.set(p.key, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }); if (spots.current.size === items.length) setReady((r) => r + 1); }}
              style={[styles.cell, EASE, on && { backgroundColor: t.accent }, !on && now && { borderColor: t.accent, borderWidth: 1 }]}>
              <Text style={{ color: on ? '#ffffffcc' : now ? t.accent : t.muted, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>{p.label}</Text>
              {p.value != null && <Text style={{ color: on ? '#fff' : p.bad ? t.danger : p.dim ? t.muted : t.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{p.bad && !on ? '⚠ ' : ''}{p.value}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  here: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  track: { borderRadius: 10, overflow: 'hidden' },
  cell: { minWidth: 76, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
});
