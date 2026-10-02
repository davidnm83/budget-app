import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { EASE, PRESS, RISE } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

export function Button({ title, onPress, kind = 'primary', disabled, busy, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean; busy?: boolean; style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : 'transparent';
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.btn, PRESS, { backgroundColor: bg, borderColor: kind === 'primary' ? t.accent : t.line, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, pressed && { transform: [{ scale: 0.97 }] }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/** A soft lift for cards, so they read as surfaces without heavy borders. */
export const LIFT = { boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 1px 6px rgba(0,0,0,0.03)' } as any;

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, LIFT, RISE, { backgroundColor: t.card, borderColor: t.line }, style]}>{children}</View>;
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, textAlign: 'center', padding: 32 }}>{text}</Text>;
}

const styles = StyleSheet.create({
  btn: { borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnText: { fontSize: 15, fontWeight: '600' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  step: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: 9 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
});

/** A thin horizontal bar: `value` of `max`, 4px rounded end. Over 100% fills in `overColor`. */
export function Bar({ value, max, color, overColor, height = 8 }: { value: number; max: number; color: string; overColor?: string; height?: number }) {
  const t = useTheme();
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : value > 0 ? 1 : 0;
  const over = max > 0 && value > max;
  return (
    <View style={{ height, borderRadius: 4, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={[{ width: `${pct * 100}%`, height, borderRadius: 4, backgroundColor: over && overColor ? overColor : color }, EASE, { transitionDuration: '350ms' } as any]} />
    </View>
  );
}

/** Row of mutually exclusive choices. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.seg, { borderColor: t.line, backgroundColor: t.card }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[styles.segItem, EASE, { backgroundColor: on ? t.accent : 'transparent' }]}>
            <Text style={{ color: on ? '#fff' : t.text, fontWeight: on ? '600' : '400', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small selectable pill. */
export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, EASE, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : 'transparent' }]}>
      <Text style={{ color: on ? '#fff' : t.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** ‹ September 2026 › */
export function Stepper({ label, onPrev, onNext, nextDisabled }: { label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable onPress={onPrev} hitSlop={8} accessibilityLabel="Previous" style={styles.step}><Ionicons name="chevron-back" size={22} color={t.accent} /></Pressable>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{label}</Text>
      <Pressable onPress={onNext} disabled={nextDisabled} hitSlop={8} accessibilityLabel="Next" style={styles.step}>
        <Ionicons name="chevron-forward" size={22} color={nextDisabled ? t.line : t.accent} />
      </Pressable>
    </View>
  );
}
