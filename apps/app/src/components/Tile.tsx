// A small stat tile: label, value, optional note. `color` tints it (status colours).
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@/lib/theme';

export function Tile({ t, label, value, sub, color }: { t: Theme; label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: color ? color + '14' : t.card, borderColor: color ?? t.line }, color && { borderLeftWidth: 3 }]}>
      <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: color ?? t.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}


const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: '45%', minWidth: 120, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
});
