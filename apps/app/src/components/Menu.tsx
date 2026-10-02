// The menu: Home at the top, then your pages (built-in and custom, in the order you choose),
// with setup at the bottom. The same button sits in every tab's top strip, in the top tab bar on
// wide screens, and in place of the back arrow on menu pages, so any page is two taps away.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadPrefs, savePrefs, type Page } from '@/lib/prefs';
import { supabase } from '@/lib/supabase';
import { useWide } from '@/lib/layout';
import { setSidebar, useSidebar } from '@/lib/sidebar';
import { useTheme } from '@/lib/theme';
import { afterClose, useBackToClose } from '@/lib/useBackToClose';

type Item = { icon?: keyof typeof Ionicons.glyphMap; emoji?: string; label: string; href: string };
const PAGES: Item[] = [
  { icon: 'bicycle-outline', label: 'Gig work', href: '/gig' },
  { icon: 'card-outline', label: 'Credit cards', href: '/credit' },
  { icon: 'trending-down-outline', label: 'Spending watch', href: '/watch' },
  { icon: 'car-outline', label: 'Car & loans', href: '/loans' },
  { icon: 'bar-chart-outline', label: 'Reports', href: '/reports' },
];
const SETUP: Item[] = [
  { icon: 'pricetags-outline', label: 'Categories', href: '/categories' },
  { icon: 'storefront-outline', label: 'Merchants', href: '/merchants' },
  { icon: 'settings-outline', label: 'Settings', href: '/settings' },
];
const TABS = ['/', '/transactions', '/planner', '/budget', '/accounts'];

/** The tabs, shown in the sidebar on wide screens (there the sidebar replaces the top tab bar). */
const TAB_ITEMS: Item[] = [
  { icon: 'home-outline', label: 'Home', href: '/' },
  { icon: 'list', label: 'Transactions', href: '/transactions' },
  { icon: 'calendar-outline', label: 'Planner', href: '/planner' },
  { icon: 'pie-chart-outline', label: 'Budget', href: '/budget' },
  { icon: 'wallet-outline', label: 'Accounts', href: '/accounts' },
];

/** What's inside the menu, shared by the phone drawer and the wide-screen sidebar. */
function MenuBody({ go, tabs, active }: { go: (href: string) => void; tabs?: boolean; active: boolean }) {
  const t = useTheme();
  const path = usePathname();
  const [pages, setPages] = useState<Page[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [sorting, setSorting] = useState(false);
  // Reload when shown and when the page changes (a custom page may have been added or renamed).
  useEffect(() => { if (active) loadPrefs().then((p) => { setPages(p.pages ?? []); setOrder(p.menu_order ?? []); }).catch(() => {}); else setSorting(false); }, [active, path]);

  const all: Item[] = [...PAGES, ...pages.map((p) => ({ emoji: p.icon, label: p.name, href: `/page/${p.id}` }))];
  const rank = (h: string) => { const i = order.indexOf(h); return i < 0 ? 1000 + all.findIndex((x) => x.href === h) : i; };
  const items = [...all].sort((a, b) => rank(a.href) - rank(b.href));
  const move = (href: string, d: -1 | 1) => {
    const list = items.map((x) => x.href);
    const i = list.indexOf(href), j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
    savePrefs({ menu_order: list }).catch(() => {});
  };
  const here = (href: string) => path === href;
  return (
    <>
      {tabs ? TAB_ITEMS.map((i) => (
        <Pressable key={i.href} onPress={() => go(i.href)} accessibilityRole="link" style={({ pressed, hovered }: any) => [styles.item, (pressed || hovered) && { backgroundColor: t.bg }, here(i.href) && { backgroundColor: t.line }]}>
          <Ionicons name={i.icon!} size={20} color={here(i.href) ? t.accent : t.text} />
          <Text style={{ color: here(i.href) ? t.accent : t.text, fontSize: 15, fontWeight: '600' }}>{i.label}</Text>
        </Pressable>
      )) : (
        <Pressable onPress={() => go('/')} style={({ pressed }) => [styles.item, (pressed || TABS.includes(path)) && { backgroundColor: t.line }]}>
          <Ionicons name="home-outline" size={20} color={t.text} />
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Home</Text>
        </Pressable>
      )}
      <View style={[styles.between, { paddingHorizontal: 16, marginTop: 10, marginBottom: 4 }]}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>PAGES</Text>
        <Pressable onPress={() => setSorting(!sorting)} hitSlop={8}><Text style={{ color: t.accent, fontSize: 12 }}>{sorting ? 'Done' : 'Reorder'}</Text></Pressable>
      </View>
      <ScrollView style={{ flexShrink: 1 }}>
        {items.map((i) => (
          <Pressable key={i.href} onPress={() => !sorting && go(i.href)} style={({ pressed, hovered }: any) => [styles.item, tabs && { paddingVertical: 10 }, hovered && !sorting && { backgroundColor: t.bg }, ((pressed && !sorting) || here(i.href)) && { backgroundColor: t.line }]}>
            {i.emoji ? <Text style={{ fontSize: 18, width: 20, textAlign: 'center' }}>{i.emoji}</Text> : <Ionicons name={i.icon!} size={20} color={t.text} />}
            <Text style={{ color: t.text, fontSize: tabs ? 15 : 16, flex: 1 }} numberOfLines={1}>{i.label}</Text>
            {sorting && (
              <>
                <Pressable onPress={() => move(i.href, -1)} hitSlop={6} accessibilityLabel={`Move ${i.label} up`}><Ionicons name="chevron-up" size={20} color={t.accent} /></Pressable>
                <Pressable onPress={() => move(i.href, 1)} hitSlop={6} accessibilityLabel={`Move ${i.label} down`}><Ionicons name="chevron-down" size={20} color={t.accent} /></Pressable>
              </>
            )}
          </Pressable>
        ))}
        <Pressable onPress={() => go('/page/new')} style={({ pressed }) => [styles.item, tabs && { paddingVertical: 10 }, pressed && { backgroundColor: t.line }]}>
          <Ionicons name="add-circle-outline" size={20} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: tabs ? 15 : 16 }}>New page</Text>
        </Pressable>
      </ScrollView>
      <View style={{ flex: 1 }} />
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 6 }} />
      {SETUP.map((i) => (
        <Pressable key={i.href} onPress={() => go(i.href)} style={({ pressed, hovered }: any) => [styles.itemSmall, hovered && { backgroundColor: t.bg }, (pressed || here(i.href)) && { backgroundColor: t.line }]}>
          <Ionicons name={i.icon!} size={17} color={t.muted} />
          <Text style={{ color: t.muted, fontSize: 14 }}>{i.label}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => supabase.auth.signOut()} style={styles.itemSmall}>
        <Ionicons name="log-out-outline" size={17} color={t.muted} />
        <Text style={{ color: t.muted, fontSize: 14 }}>Sign out</Text>
      </Pressable>
    </>
  );
}

function navigateTo(href: string, path: string) {
  if (TABS.includes(href)) { if (router.canDismiss()) router.dismissAll(); router.navigate(href as any); }
  else if (TABS.includes(path)) router.push(href as any);
  else router.replace(href as any);
}

/** Wide screens: the menu as a permanent column on the left, with a button to tuck it away. */
export function Sidebar() {
  const t = useTheme();
  const path = usePathname();
  const wide = useWide();
  const open = useSidebar();
  if (!wide || !open) return null;
  return (
    <View style={[styles.sidebar, { backgroundColor: t.card, borderColor: t.line }]}>
      <View style={[styles.between, { paddingLeft: 16, paddingRight: 8, height: 52 }]}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>Budget</Text>
        <Pressable onPress={() => setSidebar(false)} accessibilityLabel="Hide sidebar" hitSlop={6} style={({ hovered }: any) => [styles.iconBtn, { borderWidth: 0 }, hovered && { backgroundColor: t.bg }]}>
          <Ionicons name="chevron-back" size={20} color={t.muted} />
        </Pressable>
      </View>
      <MenuBody tabs active go={(href) => navigateTo(href, path)} />
    </View>
  );
}

export function MenuButton({ plain }: { plain?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const wide = useWide();
  const sidebar = useSidebar();
  const [open, setOpen] = useState(false);
  useBackToClose(open, () => setOpen(false));
  useEffect(() => { if (wide) setOpen(false); }, [wide]);
  if (wide && sidebar) return null; // the sidebar is the menu
  // Close the menu (and its history entry) first. From a tab a page opens on top; from another
  // menu page it takes that page's place, so pages don't pile up behind each other.
  const go = (href: string) => { setOpen(false); afterClose(() => navigateTo(href, path)); };
  return (
    <>
      <Pressable onPress={() => (wide ? setSidebar(true) : setOpen(true))} accessibilityLabel={wide ? 'Show sidebar' : 'Menu'} hitSlop={8}
        style={[styles.iconBtn, plain ? { borderWidth: 0 } : { borderColor: t.line, backgroundColor: t.card }]}>
        <Ionicons name="menu" size={plain ? 24 : 20} color={t.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={[styles.drawer, { backgroundColor: t.card, paddingTop: insets.top + 12 }]} onPress={() => {}}>
            <MenuBody active={open} go={go} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', flexDirection: 'row' },
  sidebar: { width: 232, borderRightWidth: 1, paddingBottom: 12 },
  drawer: { width: 280, maxWidth: '82%', height: '100%', paddingBottom: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  itemSmall: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
