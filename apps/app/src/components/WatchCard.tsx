// One category on the spending watch list: this month so far and where it's heading, against
// the 3-month average, with the last 6 months as bars (compact: no bars).
import { categoryIcon, formatMoney } from '@budget-app/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import type { Theme } from '@/lib/theme';
import type { Watched } from '@/lib/watch';

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
        {w.avg3 ? ` (${diff <= 0 ? '−' : '+'}${money0(Math.abs(diff))})` : ''}{w.budget != null ? ` · budget ${money0(w.budget)}` : ''}
      </Text>
      {!compact && (
        <View style={styles.chart}>
          {w.months.map((m, i) => {
            const last = i === w.months.length - 1;
            return (
              <Pressable key={m.month} onPress={onMonth ? () => onMonth(m.month) : undefined} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Text style={{ color: t.muted, fontSize: 9 }}>{m.actual ? money0(m.actual).replace('$', '') : ''}</Text>
                <View style={{ flex: 1, width: '70%', justifyContent: 'flex-end' }}>
                  {last && w.projected > m.actual && <View style={{ height: `${((w.projected - m.actual) / max) * 100}%`, borderWidth: 1, borderStyle: 'dashed', borderColor: color, borderBottomWidth: 0, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />}
                  <View style={{ height: `${(m.actual / max) * 100}%`, backgroundColor: last ? color : t.series1, opacity: last ? 1 : 0.6, borderRadius: 2 }} />
                </View>
                <Text style={{ color: t.muted, fontSize: 9 }}>{monthShort(m.month)}</Text>
              </Pressable>
            );
          })}
          {w.avg3 > 0 && <View style={{ position: 'absolute', left: 0, right: 0, bottom: 13 + (w.avg3 / max) * (CHART_H - 26), borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.text, opacity: 0.35 }} />}
        </View>
      )}
    </Card>
  );
}

const CHART_H = 110;
const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chart: { height: CHART_H, flexDirection: 'row', gap: 4 },
});
