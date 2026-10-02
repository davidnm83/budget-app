// The menu: your pages (built-in and custom, in the order you choose), with setup at the bottom.
// On a phone it lives in the More sheet (the last button on the floating bar) under the search
// box; on a wide screen it is the sidebar, which tucks away to a strip of icons.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RISE } from '@/lib/motion';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { SearchBox } from '@/components/Search';
import { setPanel, usePanel } from '@/lib/panels';
import { SHORTCUTS } from '@/lib/shortcuts';
import { loadPrefs, savePrefs, type Page } from '@/lib/prefs';
import { supabase } from '@/lib/supabase';
import { useWide } from '@/lib/layout';
import { refreshPlannerBadge, usePlannerBadge } from '@/lib/badges';
import { setSidebar, useSidebar } from '@/lib/sidebar';
import { useTheme } from '@/lib/theme';
import { afterClose } from '@/lib/useBackToClose';

type Item = { icon?: keyof typeof Ionicons.glyphMap; emoji?: string; label: string; href: string };
const PAGES: Item[] = [
  { icon: 'card-outline', label: 'Credit cards', href: '/credit' },
  { icon: 'car-outline', label: 'Car & loans', href: '/loans' },
  { icon: 'bar-chart-outline', label: 'Reports', href: '/reports' },
];
const SETUP: Item[] = [
  { icon: 'pricetags-outline', label: 'Categories', href: '/categories' },
  { icon: 'storefront-outline', label: 'Merchants', href: '/merchants' },
  { icon: 'funnel-outline', label: 'Rules', href: '/rules' },
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
function MenuBody({ go, tabs, active, fit }: { go: (href: string) => void; tabs?: boolean; active: boolean; fit?: boolean }) {
  const t = useTheme();
  const path = usePathname();
  const [pages, setPages] = useState<Page[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [toReview, setToReview] = useState(0);
  const overdue = usePlannerBadge();
  useEffect(() => { if (tabs) refreshPlannerBadge(); }, [tabs]); // also when the app opens on a menu page
  const [sorting, setSorting] = useState(false);
  useEffect(() => { if (tabs) supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('reviewed', false).then((r) => setToReview(r.count ?? 0)); }, [tabs, path]);
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
          {here(i.href) && <View style={[styles.mark, { backgroundColor: t.accent }, RISE]} />}
          <Ionicons name={i.icon!} size={20} color={here(i.href) ? t.accent : t.text} />
          <Text style={{ color: here(i.href) ? t.accent : t.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{i.label}</Text>
          {i.href === '/planner' && overdue > 0 && <View style={[styles.badge, { backgroundColor: t.danger }]}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{overdue}</Text></View>}
          {i.href === '/transactions' && toReview > 0 && <View style={[styles.badge, { backgroundColor: t.danger }]}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{toReview > 99 ? '99+' : toReview}</Text></View>}
        </Pressable>
      )) : null}
      <View style={[styles.between, { paddingHorizontal: 16, marginTop: 10, marginBottom: 4 }]}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>PAGES</Text>
        <Pressable onPress={() => setSorting(!sorting)} hitSlop={8}><Text style={{ color: t.accent, fontSize: 12 }}>{sorting ? 'Done' : 'Reorder'}</Text></Pressable>
      </View>
      <ScrollView style={{ flexShrink: 1 }}>
        {items.map((i) => (
          <Pressable key={i.href} onPress={() => !sorting && go(i.href)} style={({ pressed, hovered }: any) => [styles.item, tabs && { paddingVertical: 10 }, hovered && !sorting && { backgroundColor: t.bg }, ((pressed && !sorting) || here(i.href)) && { backgroundColor: t.line }]}>
            {tabs && here(i.href) && <View style={[styles.mark, { backgroundColor: t.accent }, RISE]} />}
            {i.emoji ? <Text style={{ fontSize: 18, width: 20, textAlign: 'center' }}>{i.emoji}</Text> : <Ionicons name={i.icon!} size={20} color={t.text} />}
            <Text style={{ color: t.text, fontSize: tabs ? 15 : 16, flex: 1 }} numberOfLines={1}>{i.label}</Text>
            {sorting && (
              <>
                <Pressable onPress={() => move(i.href, -1)} hitSlop={10} accessibilityLabel={`Move ${i.label} up`}><Ionicons name="chevron-up" size={24} color={t.accent} /></Pressable>
                <Pressable onPress={() => move(i.href, 1)} hitSlop={10} accessibilityLabel={`Move ${i.label} down`}><Ionicons name="chevron-down" size={24} color={t.accent} /></Pressable>
              </>
            )}
          </Pressable>
        ))}
        <Pressable onPress={() => go('/page/new')} style={({ pressed, hovered }: any) => [styles.item, tabs && { paddingVertical: 10 }, (pressed || hovered) && { backgroundColor: t.line }]}>
          <Ionicons name="add-circle-outline" size={20} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: tabs ? 15 : 16 }}>New page</Text>
        </Pressable>
      </ScrollView>
      {!fit && <View style={{ flex: 1 }} />}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 6 }} />
      {SETUP.map((i) => (
        <Pressable key={i.href} onPress={() => go(i.href)} style={({ pressed, hovered }: any) => [styles.itemSmall, hovered && { backgroundColor: t.bg }, (pressed || here(i.href)) && { backgroundColor: t.line }]}>
          <Ionicons name={i.icon!} size={17} color={t.muted} />
          <Text style={{ color: t.muted, fontSize: 14 }}>{i.label}</Text>
        </Pressable>
      ))}
    </>
  );
}

// Every page sits beside the tabs now, so going anywhere is one plain step.
function navigateTo(href: string, _path: string) { router.navigate(href as any); }

/** The sidebar toggle: a page outline with a strip down its left side (filled in while the sidebar is open). */
function PanelIcon({ color, open }: { color: string; open?: boolean }) {
  return (
    <View style={{ width: 20, height: 16, borderWidth: 1.5, borderColor: color, borderRadius: 4, overflow: 'hidden' }}>
      <View style={{ width: 6, height: '100%', borderRightWidth: 1.5, borderColor: color, backgroundColor: open ? color + '55' : 'transparent' }} />
    </View>
  );
}

/** Sets a hover name on an element (web), for the icon-only strip. */
function useTitle(label: string) {
  const ref = useRef<View>(null);
  useEffect(() => { (ref.current as any)?.setAttribute?.('title', label); }, [label]);
  return ref;
}
function StripIcon({ item, on, onPress, badge }: { item: Item; on: boolean; onPress: () => void; badge?: number }) {
  const t = useTheme();
  const ref = useTitle(item.label);
  return (
    <Pressable ref={ref} onPress={onPress} accessibilityLabel={item.label} style={({ hovered, pressed }: any) => [styles.stripItem, (hovered || pressed) && { backgroundColor: t.bg }, on && { backgroundColor: t.line }]}>
      {item.emoji ? <Text style={{ fontSize: 17, opacity: on ? 1 : 0.75 }}>{item.emoji}</Text> : <Ionicons name={item.icon!} size={20} color={on ? t.accent : t.muted} />}
      {!!badge && <View style={[styles.stripDot, { backgroundColor: t.danger, borderColor: t.card }]} />}
    </Pressable>
  );
}

/** Wide screens: the menu as a column on the left. Tucked away it is a quiet strip of icons. */
export function Sidebar() {
  const t = useTheme();
  const path = usePathname();
  const wide = useWide();
  const open = useSidebar();
  const m = useMenuItems(wide);
  const overdue = usePlannerBadge();
  const tipExpand = useTitle('Show sidebar ( [ )');
  const tipSearch = useTitle('Search');
  if (!wide) return null;
  const go = (href: string) => navigateTo(href, path);
  return (
    <View style={[styles.sidebarWrap, { width: open ? 232 : 56, borderRightWidth: 1, borderColor: t.line, backgroundColor: t.card }]}>
      {open ? (
        <View style={[styles.sidebar, { backgroundColor: t.card }]}>
          <View style={[styles.between, { paddingLeft: 16, paddingRight: 8, height: 52 }]}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>Budget</Text>
            <Pressable onPress={() => setSidebar(false)} accessibilityLabel="Hide sidebar" hitSlop={6} style={({ hovered }: any) => [styles.iconBtn, { borderWidth: 0 }, hovered && { backgroundColor: t.bg }]}>
              <PanelIcon color={t.muted} open />
            </Pressable>
          </View>
          <Pressable onPress={() => setPanel('search')} accessibilityLabel="Search" style={({ hovered }: any) => [styles.searchBtn, { borderColor: t.line, backgroundColor: hovered ? t.line : t.bg }]}>
            <Ionicons name="search" size={16} color={t.muted} />
            <Text style={{ color: t.muted, fontSize: 14, flex: 1 }}>Search</Text>
          </Pressable>
          <MenuBody tabs active go={go} />
        </View>
      ) : (
        // Tucked away: just the way back, search and the five tabs, with Settings at the bottom.
        <View style={[styles.strip, { width: 55, flex: 1 }]}>
          <Pressable ref={tipExpand} onPress={() => setSidebar(true)} accessibilityLabel="Show sidebar" style={({ hovered }: any) => [styles.stripItem, hovered && { backgroundColor: t.bg }]}>
            <PanelIcon color={t.muted} />
          </Pressable>
          <Pressable ref={tipSearch} onPress={() => setPanel('search')} accessibilityLabel="Search" style={({ hovered }: any) => [styles.stripItem, hovered && { backgroundColor: t.bg }]}>
            <Ionicons name="search" size={19} color={t.muted} />
          </Pressable>
          <View style={[styles.stripRule, { backgroundColor: t.line }]} />
          {TAB_ITEMS.map((i) => <StripIcon key={i.href} item={i} on={path === i.href} onPress={() => go(i.href)} badge={i.href === '/planner' ? overdue : i.href === '/transactions' ? m.toReview : 0} />)}
          <View style={{ flex: 1 }} />
          <StripIcon item={SETUP[SETUP.length - 1]} on={path === '/settings'} onPress={() => go('/settings')} />
        </View>
      )}
    </View>
  );
}

/** Your pages in menu order, and the to-review count. */
function useMenuItems(active: boolean) {
  const path = usePathname();
  const [pages, setPages] = useState<Page[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [toReview, setToReview] = useState(0);
  useEffect(() => {
    if (!active) return;
    loadPrefs().then((p) => { setPages(p.pages ?? []); setOrder(p.menu_order ?? []); }).catch(() => {});
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('reviewed', false).then((r) => setToReview(r.count ?? 0));
  }, [active, path]);
  const all: Item[] = [...PAGES, ...pages.map((p) => ({ emoji: p.icon, label: p.name, href: `/page/${p.id}` }))];
  const rank = (h: string) => { const i = order.indexOf(h); return i < 0 ? 1000 + all.findIndex((x) => x.href === h) : i; };
  return { items: [...all].sort((a, b) => rank(a.href) - rank(b.href)), toReview };
}

/**
 * The panels any page can open: on a phone the "More" sheet (search on top, the menu below);
 * on a computer the search pop-up; and the keyboard shortcut guide.
 */
export function Panels() {
  const t = useTheme();
  const wide = useWide();
  const panel = usePanel();
  const insets = useSafeAreaInsets();
  const m = useMenuItems(panel === 'more' || panel === 'search');
  useEffect(() => { if (wide && panel === 'more') setPanel('search'); }, [wide, panel]);
  const close = () => setPanel(null);
  const go = (href: string) => { close(); afterClose(() => router.navigate(href as any)); };
  const pages = [...TAB_ITEMS, ...m.items, ...SETUP, { icon: 'add-circle-outline' as const, label: 'New page', href: '/page/new' }];
  if (panel === 'shortcuts') {
    const groups = [...new Set(SHORTCUTS.map((x) => x.group))];
    return (
      <Sheet title="Keyboard shortcuts" onClose={close}>
        {groups.map((g) => (
          <View key={g} style={{ gap: 6 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{g.toUpperCase()}</Text>
            {SHORTCUTS.filter((x) => x.group === g).map((x) => (
              <View key={x.keys.join('+') + x.does} style={styles.between}>
                <Text style={{ color: t.text, fontSize: 14, flex: 1 }}>{x.does}</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>{x.keys.map((k) => <Text key={k} style={[styles.kbd, { color: t.text, borderColor: t.line, backgroundColor: t.card }]}>{k}</Text>)}</View>
              </View>
            ))}
          </View>
        ))}
        <Text style={{ color: t.muted, fontSize: 12 }}>“G then H” means press G, let go, then press H. Shortcuts pause while you’re typing in a box.</Text>
      </Sheet>
    );
  }
  if (panel !== 'more' && panel !== 'search') return null;
  return (
    <SheetFrame onClose={close} title={wide ? 'Search' : 'More'}>
      <SearchBox pages={pages} onGo={go} autoFocus={wide}
        empty={wide ? <Text style={{ color: t.muted, padding: 16 }}>Type to search pages, categories, merchants and transactions.</Text>
          : <View style={{ flexShrink: 1, paddingBottom: insets.bottom + 8 }}><MenuBody active go={go} fit /></View>} />
    </SheetFrame>
  );
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Sheet title={title} onClose={onClose} scroll={false} fit><View style={{ flexShrink: 1, paddingTop: 10 }}>{children}</View></Sheet>;
}

const styles = StyleSheet.create({
  iconBtn: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  strip: { alignItems: 'center', paddingVertical: 6, gap: 2 },
  stripItem: { width: 42, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stripRule: { width: 24, height: StyleSheet.hairlineWidth, marginVertical: 6 },
  stripDot: { position: 'absolute', top: 7, right: 8, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  searchBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 10, height: 36 },
  kbd: { fontSize: 11, fontWeight: '600', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  sidebarWrap: { overflow: 'hidden', transitionProperty: 'width', transitionDuration: '240ms', transitionTimingFunction: 'cubic-bezier(0.2, 0.9, 0.2, 1)' } as any,
  sidebar: { width: 231, flex: 1, paddingBottom: 12 },
  mark: { position: 'absolute', left: 0, top: 9, bottom: 9, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  itemSmall: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
