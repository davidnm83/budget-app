// The one stat tile used everywhere: a label, a value, an optional note. `color` tints it (status
// colours); `warn` is the danger colour; `strong` is for the headline number in a row. Tiles in a
// row share the width equally and wrap when they'd get too narrow.
import { StyleSheet, Text, View } from 'react-native';
import { TYPE, useWide } from '@/lib/layout';
import type { Theme } from '@/lib/theme';

export function Tile({ t, label, value, sub, color, warn, strong }: {
  t: Theme; label: string; value: string; sub?: string; color?: string; warn?: boolean; strong?: boolean;
}) {
  const c = color ?? (warn ? t.danger : undefined);
  const wide = useWide(); // phones: two tiles per row, so notes aren't cut off
  return (
    <View style={[styles.tile, !wide && { minWidth: 140 }, { backgroundColor: c ? c + '14' : t.card, borderColor: c ?? t.line }, c && { borderLeftWidth: 3 }]}>
      <Text style={{ color: t.muted, fontSize: TYPE.tileNote, fontWeight: '600', letterSpacing: 0.3 }} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: c ?? t.text, fontSize: strong ? TYPE.tileValue + 2 : TYPE.tileValue, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: TYPE.tileNote }} numberOfLines={2}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, gap: 2 },
});
