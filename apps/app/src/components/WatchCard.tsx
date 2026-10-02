// One category on the spending watch list: this month so far and where it's heading, against
// the 3-month average, with the last 6 months as bars (compact: no bars).
import { categoryIcon, formatMoney } from '@budget-app/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BarChart } from '@/components/Charts';
import { Card } from '@/components/ui';
import type { Theme } from '@/lib/theme';
import type { Watched, WatchStack } from '@/lib/watch';

const money0 = (n: number) => formatMoney(n).replace(/\.\d\d$/, '');
const monthShort = (m: string) => new Date(m + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });

export function WatchCard({ t, w, compact, onMonth }: { t: Theme; w: Watched; compact?: boolean; onMonth?: (month: string) => void }) {
  const better = w.projected <= w.avg3;
  const color = !w.avg3 && !w.thisMonth ? t.muted : better ? t.accent : t.series2;
  const max = Math.max(1, ...w.months.map((m) => m.actual), w.projected, w.avg3);
  const diff = w.projected - w.avg3;
  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.between}>
        <Text style={{ color: t.text, fontWeight: '700', flex: 1 }}>{categoryIcon(w.category.name, w.category.icon)}  {w.category.name}</Text>
        <Text style={{ color, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money0(w.thisMonth)}</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Heading for {money0(w.projected)} this month vs a {money0(w.avg3)} average
        {w.avg3 && Math.abs(diff) >= 0.5 ? ` (${diff <= 0 ? '−' : '+'}${money0(Math.abs(diff))})` : ''}{w.budget != null ? ` · budget ${money0(w.budget)}` : ''}
      </Text>
      {!compact && (
        <BarChart t={t} height={96} labels={w.months.map((m) => monthShort(m.month))} series={[{ name: 'Spent', values: w.months.map((m) => m.actual) }]} format={money0}
          refLine={w.avg3 > 0 ? w.avg3 : undefined} barColor={(i) => (i === w.months.length - 1 ? color : undefined)}
          outline={{ i: w.months.length - 1, value: w.projected, color }} onPick={onMonth ? (i) => onMonth(w.months[i].month) : undefined} />
      )}
    </Card>
  );
}

/**
 * Several categories as one chart: the total against its average. The bars are stacked by
 * category, but there is no colour key to read: the line above the chart names the month's total
 * and its biggest categories (the latest month until you hover or tap another).
 */
export function WatchStackCard({ t, s, onMonth, onEdit, onRemove }: { t: Theme; s: WatchStack; onMonth?: (month: string) => void; onEdit?: () => void; onRemove?: () => void }) {
  const sum = (f: (w: Watched) => number) => s.parts.reduce((a, w) => a + f(w), 0);
  const thisMonth = sum((w) => w.thisMonth), projected = sum((w) => w.projected), avg3 = sum((w) => w.avg3);
  const months = s.parts[0].months.map((m) => m.month);
  const better = projected <= avg3;
  const color = !avg3 && !thisMonth ? t.muted : better ? t.accent : t.series2;
  const diff = projected - avg3;
  const colors = s.parts.map((_, k) => t.series[k % t.series.length]);
  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.between}>
        <Text style={{ color: t.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{s.name}</Text>
        {onEdit && <Pressable onPress={onEdit} hitSlop={8}><Text style={{ color: t.accent, fontSize: 13 }}>Edit</Text></Pressable>}
        {onRemove && <Pressable onPress={onRemove} hitSlop={8}><Text style={{ color: t.muted, fontSize: 13 }}>Remove</Text></Pressable>}
        <Text style={{ color, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money0(thisMonth)}</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Heading for {money0(projected)} this month vs a {money0(avg3)} average{avg3 && Math.abs(diff) >= 0.5 ? ` (${diff <= 0 ? '−' : '+'}${money0(Math.abs(diff))})` : ''}
      </Text>
      <BarChart t={t} stacked legend={false} height={120} labels={months.map(monthShort)} colors={colors} format={money0}
        series={s.parts.map((w) => ({ name: w.category.name, values: w.months.map((m) => m.actual) }))}
        refLine={avg3 > 0 ? avg3 : undefined} onPick={onMonth ? (i) => onMonth(months[i]) : undefined} />
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
});
