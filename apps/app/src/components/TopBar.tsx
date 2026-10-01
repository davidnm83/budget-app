// The strip at the top of every tab (tabs have no header): a menu button on the left and the
// tab's own controls beside it. The menu holds the less-used screens: Bills, Settings, imports.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const ITEMS: { icon: keyof typeof Ionicons.glyphMap; label: string; href: string }[] = [
  { icon: 'repeat', label: 'Bills & income', href: '/bills' },
  { icon: 'settings-outline', label: 'Settings', href: '/settings' },
  { icon: 'document-text-outline', label: 'Import CSV', href: '/import' },
  { icon: 'cloud-download-outline', label: 'Import from Fina', href: '/fina-import' },
];

export function TopBar({ children, title }: { children?: ReactNode; title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const go = (href: string) => { setOpen(false); router.push(href as any); };
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8, backgroundColor: t.bg }]}>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel="Menu" hitSlop={8} style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }]}>
        <Ionicons name="menu" size={20} color={t.text} />
      </Pressable>
      {title ? <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: children ? 0 : 1 }}>{title}</Text> : null}
      {children ? <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>{children}</View> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={[styles.drawer, { backgroundColor: t.card, paddingTop: insets.top + 16 }]} onPress={() => {}}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', marginBottom: 8, paddingHorizontal: 16 }}>MENU</Text>
            {ITEMS.map((i) => (
              <Pressable key={i.href} onPress={() => go(i.href)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.line }]}>
                <Ionicons name={i.icon} size={20} color={t.text} />
                <Text style={{ color: t.text, fontSize: 16 }}>{i.label}</Text>
              </Pressable>
            ))}
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 8 }} />
            <Pressable onPress={() => { setOpen(false); supabase.auth.signOut(); }} style={styles.item}>
              <Ionicons name="log-out-outline" size={20} color={t.muted} />
              <Text style={{ color: t.muted, fontSize: 16 }}>Sign out</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Square icon button used in top bars, with an optional count badge. */
export function IconButton({ icon, onPress, on, badge, label }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; on?: boolean; badge?: number; label: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected: !!on }} hitSlop={6}
      style={[styles.iconBtn, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : t.card }]}>
      <Ionicons name={icon} size={19} color={on ? '#fff' : t.text} />
      {!!badge && (
        <View style={[styles.badge, { backgroundColor: t.danger }]}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', flexDirection: 'row' },
  drawer: { width: 270, maxWidth: '80%', height: '100%', paddingBottom: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
});
