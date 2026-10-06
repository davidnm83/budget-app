// A month as a calendar, Monday first: the Planner's month view and the Calendar view of charts.
// Each day shows its number and whatever the caller puts in it (amounts in and out, a balance).
import { monthEnd } from '@budget-app/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@/lib/theme';

export interface DayCell {
  /** Short lines under the day's number (an amount out, an amount in). */
  lines?: { text: string; color: string }[];
  /** The last line, set apart (the day's closing balance). */
  foot?: { text: string; color: string };
  /** A small dot in the corner (something overdue, a warning). */
  dot?: string;
  /** Shades the day (a stronger shade for a bigger value), for spending heat maps. */
  shade?: { color: string; level: number };
}

const HEAD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Amounts in a few characters: $85, $1.2k, $12k. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const s = a >= 10000 ? `${Math.round(a / 1000)}k` : a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(a)}`;
  return `${n < 0 ? '−' : ''}$${s}`;
}

export function MonthGrid({ t, month, today, cells, selected, onPress, height = 58 }: {
  t: Theme; month: string; today: string; cells: Record<string, DayCell>; selected?: string | null; onPress?: (date: string) => void;
  /** Each day's height: taller in the Planner, shorter in a widget. */
  height?: number;
}) {
  const lead = (new Date(month + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const count = Number(monthEnd(month).slice(8, 10));
  const slots: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)];
  while (slots.length % 7) slots.push(null);
  const small = height < 50;
  return (
    <View>
      <View style={styles.row}>{HEAD.map((d, i) => <Text key={i} style={[styles.head, { color: t.muted }]}>{d}</Text>)}</View>
      {Array.from({ length: slots.length / 7 }, (_, w) => (
        <View key={w} style={styles.row}>
          {slots.slice(w * 7, w * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={[styles.cell, { height }]} />;
            const c = cells[d] ?? {};
            const isToday = d === today, sel = d === selected;
            return (
              <Pressable key={d} onPress={onPress ? () => onPress(d) : undefined} disabled={!onPress} accessibilityLabel={d}
                style={({ hovered }: any) => [styles.cell, styles.box, { height, borderColor: sel ? t.accent : isToday ? t.text + '55' : 'transparent' },
                  c.shade && { backgroundColor: c.shade.color + Math.round(14 + c.shade.level * 70).toString(16).padStart(2, '0') },
                  sel && !c.shade && { backgroundColor: t.accent + '14' }, hovered && onPress && { backgroundColor: t.line }]}>
                <View style={styles.top}>
                  <Text style={{ color: isToday ? t.text : t.muted, fontSize: small ? 9 : 11, fontWeight: isToday ? '800' : '500' }}>{Number(d.slice(8, 10))}</Text>
                  {c.dot && <View style={[styles.dot, { backgroundColor: c.dot }]} />}
                </View>
                {(c.lines ?? []).map((l, k) => <Text key={k} style={[styles.line, { color: l.color, fontSize: small ? 9 : 10 }]} numberOfLines={1}>{l.text}</Text>)}
                {c.foot && <Text style={[styles.line, styles.foot, { color: c.foot.color, fontSize: small ? 8 : 9 }]} numberOfLines={1}>{c.foot.text}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  head: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', paddingBottom: 3 },
  cell: { flex: 1, minWidth: 0, margin: 1 },
  box: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 3, paddingVertical: 2, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  line: { fontVariant: ['tabular-nums'], lineHeight: 12 },
  foot: { marginTop: 'auto' as any },
});
