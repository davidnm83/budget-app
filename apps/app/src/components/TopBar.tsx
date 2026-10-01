// The strip at the top of every tab (tabs have no header): a menu button on the left and the
// tab's own controls beside it. The menu holds the other pages, with setup (categories,
// imports, settings, sign out) at the bottom.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { PAGE_MAX } from '@/lib/layout';
import { loadPrefs, type Page } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';
import { afterClose, useBackToClose } from '@/lib/useBackToClose';

type Item = { icon: keyof typeof Ionicons.glyphMap; label: string; href: string };
// Pages first; setup and housekeeping at the bottom.
const PAGES: Item[] = [
  { icon: 'repeat', label: 'Bills & income', href: '/bills' },
  { icon: 'bicycle-outline', label: 'Gig work', href: '/gig' },
  { icon: 'card-outline', label: 'Credit cards', href: '/credit' },
  { icon: 'trending-down-outline', label: 'Spending watch', href: '/watch' },
  { icon: 'car-outline', label: 'Car & loans', href: '/loans' },
  { icon: 'bar-chart-outline', label: 'Reports', href: '/reports' },
];
const SETUP: Item[] = [
  { icon: 'pricetags-outline', label: 'Categories', href: '/categories' },
  { icon: 'document-text-outline', label: 'Import CSV', href: '/import' },
  { icon: 'cloud-download-outline', label: 'Import from Fina', href: '/fina-import' },
  { icon: 'settings-outline', label: 'Settings', href: '/settings' },
];

export function TopBar({ children, title }: { children?: ReactNode; title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  useEffect(() => { if (open) loadPrefs().then((p) => setPages(p.pages ?? [])).catch(() => {}); }, [open]);
  useBackToClose(open, () => setOpen(false));
  // Close the menu (and its history entry) first, then open the page.
  const go = (href: string) => { setOpen(false); afterClose(() => router.push(href as any)); };
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
            {PAGES.map((i) => (
              <Pressable key={i.href} onPress={() => go(i.href)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.line }]}>
                <Ionicons name={i.icon} size={20} color={t.text} />
                <Text style={{ color: t.text, fontSize: 16 }}>{i.label}</Text>
              </Pressable>
            ))}
            {pages.map((p) => (
              <Pressable key={p.id} onPress={() => go(`/page/${p.id}`)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.line }]}>
                <Text style={{ fontSize: 18, width: 20, textAlign: 'center' }}>{p.icon}</Text>
                <Text style={{ color: t.text, fontSize: 16 }} numberOfLines={1}>{p.name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => go('/page/new')} style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.line }]}>
              <Ionicons name="add-circle-outline" size={20} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 16 }}>New page</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 6 }} />
            {SETUP.map((i) => (
              <Pressable key={i.href} onPress={() => go(i.href)} style={({ pressed }) => [styles.itemSmall, pressed && { backgroundColor: t.line }]}>
                <Ionicons name={i.icon} size={17} color={t.muted} />
                <Text style={{ color: t.muted, fontSize: 14 }}>{i.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => { setOpen(false); supabase.auth.signOut(); }} style={styles.itemSmall}>
              <Ionicons name="log-out-outline" size={17} color={t.muted} />
              <Text style={{ color: t.muted, fontSize: 14 }}>Sign out</Text>
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
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', flexDirection: 'row' },
  drawer: { width: 270, maxWidth: '80%', height: '100%', paddingBottom: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  itemSmall: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
});
