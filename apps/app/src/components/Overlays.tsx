// What floats over every page: the message at the bottom (with Undo when there is something to
// undo), the pull-to-refresh indicator at the top, and the "Offline" pill.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWide } from '@/lib/layout';
import { RISE } from '@/lib/motion';
import { useEffect } from 'react';
import { backOnline, useOffline } from '@/lib/offline';
import { refreshNow, usePullState } from '@/lib/pullRefresh';
import { useTheme } from '@/lib/theme';
import { dismissToast, runUndo, useToast } from '@/lib/toast';

export function Toaster() {
  const t = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const m = useToast();
  const off = useOffline().offline;
  if (!m) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: (wide ? 24 : Math.max(insets.bottom, 12) + 72) + (off ? 38 : 0) }]}>
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

/** Shown while there is no connection: what's on screen is the saved copy, and from when. */
export function OfflinePill() {
  const t = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const { offline, since } = useOffline();
  // When the connection comes back, reload the page showing; the first answer clears the pill.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const back = () => { backOnline(); refreshNow(); };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, []);
  if (!offline) return null;
  const d = new Date(since);
  const today = d.toDateString() === new Date().toDateString();
  const when = !since ? '' : today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { bottom: wide ? 20 : Math.max(insets.bottom, 12) + 70 }]}>
      <View style={[styles.offline, { backgroundColor: t.card, borderColor: t.line }]} accessibilityRole="alert">
        <Ionicons name="cloud-offline-outline" size={14} color={t.muted} />
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>Offline{when ? ` · showing data from ${when}` : ''}</Text>
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
  offline: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, height: 28, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' as any },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingLeft: 16, paddingRight: 12, minHeight: 46, maxWidth: 520, boxShadow: '0 8px 28px rgba(0,0,0,0.28)' as any },
  undo: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  pull: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 40 },
  pullDot: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.16)' as any },
});
