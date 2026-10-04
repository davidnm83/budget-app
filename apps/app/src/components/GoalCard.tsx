// One goal as a card: progress, the date and pace, and for money you mark yourself, Add and Spend.
// Used on the Goals page and in the Goals widget.
import { formatMoney, shortDate } from '@budget-app/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bar, Button, Card } from '@/components/ui';
import type { Goal } from '@/lib/goals';
import { today } from '@/lib/plan';
import type { Theme } from '@/lib/theme';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export function GoalCard({ t, g, onPress, onMove, compact }: { t: Theme; g: Goal; onPress?: () => void; onMove?: (dir: 1 | -1) => void; compact?: boolean }) {
  const p = g.progress;
  const save = g.kind === 'save';
  const marked = save && !g.account_id;
  const color = p.done ? t.accent : p.onPace === false ? t.series2 : t.accent;
  const line = save
    ? `${money0(g.current)} of ${money0(g.target)}`
    : `${money0(g.current)} still owed${g.start_value > 0 ? ` of ${money0(g.start_value)}` : ''}`;
  const pace = p.done ? (save ? 'Reached 🎉' : 'Paid off 🎉')
    : g.due ? `${shortDate(g.due)}${g.due.slice(0, 4) !== today().slice(0, 4) ? ` ${g.due.slice(0, 4)}` : ''} · ${p.onPace ? 'on pace' : `${money0(p.behind)} behind`}${p.perMonth != null ? ` · ${money0(p.perMonth)}/month to make it` : ''}`
    : save ? `${money0(p.left)} to go` : 'No date set';
  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <Card style={{ gap: 8, opacity: g.closed_on ? 0.7 : 1 }}>
        <View style={styles.between}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: compact ? 14 : 16, flex: 1 }} numberOfLines={1}>{g.icon ? `${g.icon} ` : ''}{g.name}</Text>
          <Text style={{ color: t.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{Math.round(p.share * 100)}%</Text>
        </View>
        <Bar value={p.share} max={1} color={color} />
        <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{line}{g.refills ? ' · refills yearly' : ''}</Text>
        <Text style={{ color: p.onPace === false && !p.done ? t.series2 : t.muted, fontSize: 12 }}>{pace}</Text>
        {!compact && marked && !g.closed_on && onMove && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Add money" kind="plain" onPress={() => onMove(1)} style={{ flex: 1 }} />
            {g.refills && <Button title="Spend from it" kind="plain" onPress={() => onMove(-1)} style={{ flex: 1 }} />}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
});
