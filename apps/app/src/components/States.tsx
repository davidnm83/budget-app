// What a page shows when it has nothing yet (what it's for and the one thing to do next), and
// the grey placeholders it shows while its data loads.
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { PULSE } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

export function EmptyState({ icon, title, text, action, onAction }: { icon: keyof typeof Ionicons.glyphMap; title: string; text?: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.bubble, { backgroundColor: t.accent + '1f' }]}><Ionicons name={icon} size={26} color={t.accent} /></View>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      {!!text && <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 360 }}>{text}</Text>}
      {!!action && !!onAction && <Button title={action} onPress={onAction} style={{ marginTop: 6, alignSelf: 'center', paddingHorizontal: 22 }} />}
    </View>
  );
}

/** Placeholder rows shaped like a list: a circle, two lines and an amount. */
export function RowsSkeleton({ rows = 8, card }: { rows?: number; card?: boolean }) {
  const t = useTheme();
  return (
    <View accessibilityLabel="Loading" style={[PULSE, card && { backgroundColor: t.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, marginHorizontal: 12 }]}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.track }} />
          <View style={{ flex: 1, gap: 7 }}>
            <View style={{ height: 12, width: `${55 - (i % 3) * 12}%`, borderRadius: 6, backgroundColor: t.track }} />
            <View style={{ height: 9, width: `${72 - (i % 4) * 9}%`, borderRadius: 5, backgroundColor: t.track }} />
          </View>
          <View style={{ height: 12, width: 56, borderRadius: 6, backgroundColor: t.track }} />
        </View>
      ))}
    </View>
  );
}

/** Placeholder for a page of tiles and cards. */
export function PageSkeleton({ tiles = 3, cards = 2 }: { tiles?: number; cards?: number }) {
  const t = useTheme();
  return (
    <View accessibilityLabel="Loading" style={[{ gap: 10 }, PULSE]}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {Array.from({ length: tiles }, (_, i) => <View key={i} style={{ flex: 1, height: 62, borderRadius: 12, backgroundColor: t.track }} />)}
      </View>
      {Array.from({ length: cards }, (_, i) => <View key={i} style={{ height: i ? 150 : 210, borderRadius: 16, backgroundColor: t.track }} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 8, paddingVertical: 36, paddingHorizontal: 24 },
  bubble: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 60 },
});
