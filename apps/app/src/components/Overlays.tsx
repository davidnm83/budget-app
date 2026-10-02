// The two things that float over every page: the message at the bottom (with Undo when there is
// something to undo) and the pull-to-refresh indicator at the top.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWide } from '@/lib/layout';
import { RISE } from '@/lib/motion';
import { usePullState } from '@/lib/pullRefresh';
import { useTheme } from '@/lib/theme';
import { dismissToast, runUndo, useToast } from '@/lib/toast';

export function Toaster() {
  const t = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const m = useToast();
  if (!m) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: wide ? 24 : Math.max(insets.bottom, 12) + 72 }]}>
      <View key={m.id} style={[styles.toast, RISE, { backgroundColor: t.text }]} accessibilityRole="alert">
        {m.error && <Ionicons name="alert-circle" size={18} color={t.bg} />}
        <Text style={{ color: t.bg, fontSize: 14, fontWeight: '600', flexShrink: 1 }} numberOfLines={2}>{m.text}</Text>
        {m.undo && (
          <Pressable onPress={() => runUndo(m)} hitSlop={10} accessibilityLabel="Undo" style={[styles.undo, { borderColor: t.bg + '55' }]}>
            <Text style={{ color: t.bg, fontWeight: '800', fontSize: 13 }}>Undo</Text>
          </Pressable>
        )}
        <Pressable onPress={dismissToast} hitSlop={10} accessibilityLabel="Dismiss message"><Ionicons name="close" size={16} color={t.bg} /></Pressable>
      </View>
    </View>
  );
}

export function PullIndicator() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const p = usePullState();
  if (p <= 0) return null;
  const busy = p === 2;
  return (
    <View pointerEvents="none" style={[styles.pull, { top: insets.top + 6 + Math.min(1, p) * 34, opacity: busy ? 1 : p }]}>
      <View style={[styles.pullDot, { backgroundColor: t.card, borderColor: t.line }]}>
        {busy ? <ActivityIndicator size="small" color={t.accent} />
          : <Ionicons name="arrow-down" size={18} color={p >= 1 ? t.accent : t.muted} style={{ transform: [{ rotate: p >= 1 ? '180deg' : '0deg' }] }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16, zIndex: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingLeft: 16, paddingRight: 12, minHeight: 46, maxWidth: 520, boxShadow: '0 8px 28px rgba(0,0,0,0.28)' as any },
  undo: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  pull: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 40 },
  pullDot: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.16)' as any },
});
