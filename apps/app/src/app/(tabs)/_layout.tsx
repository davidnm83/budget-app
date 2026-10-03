import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { refreshPlannerBadge, usePlannerBadge } from '@/lib/badges';
import { useWide } from '@/lib/layout';
import { EASE, ENTER, PRESS, SWIPE_IN } from '@/lib/motion';
import { setPanel } from '@/lib/panels';
import { setActiveScene, takeEnterFrom, useSwipeTabs } from '@/lib/swipeTabs';
import { useScheme, useTheme } from '@/lib/theme';

// Every signed-in page lives here, so the navigation bar stays put wherever you are.
//   • The five tabs have no header: each starts with its own TopBar.
//   • Menu pages (Reports, Settings…) get a header with the menu button.
// Phones: a floating bar of five icons at the bottom. Wide screens: no bar; the sidebar lists everything.
const TABS: { name: string; title: string; icon: keyof typeof Ionicons.glyphMap; on: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', on: 'home' },
  { name: 'transactions', title: 'Transactions', icon: 'list-outline', on: 'list' },
  { name: 'planner', title: 'Planner', icon: 'calendar-outline', on: 'calendar' },
  { name: 'budget', title: 'Budget', icon: 'pie-chart-outline', on: 'pie-chart' },
  { name: 'accounts', title: 'Accounts', icon: 'wallet-outline', on: 'wallet' },
];
const PAGES: [string, string][] = [
  ['credit', 'Credit cards'], ['watch', 'Spending watch'], ['loans', 'Car & loans'], ['reports', 'Reports'],
  ['categories', 'Categories'], ['merchants', 'Merchants'], ['rules', 'Rules'], ['settings', 'Settings'], ['bills', 'Bills & income'], ['page/[id]', 'Page'],
];
// Reached from Settings, so they go back there.
const FROM_SETTINGS: [string, string][] = [['import', 'Import a bank file'], ['history-import', 'Import from another app']];

export default function TabLayout() {
  const t = useTheme();
  const wide = useWide();
  const overdue = usePlannerBadge();
  useEffect(() => { refreshPlannerBadge(); }, []);
  const header = { headerShown: true, headerStyle: { backgroundColor: t.bg, borderBottomWidth: 0 }, headerTintColor: t.text, headerShadowVisible: false, headerTitleAlign: 'left' as const, headerTitleStyle: { fontSize: 20, fontWeight: '700' as const } };
  return (
    <Tabs backBehavior="history" screenLayout={({ children }: any) => <Enter>{children}</Enter>} tabBar={(p: any) => (wide ? null : <FloatingBar {...p} />)}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg } }}>
      {TABS.map((x) => <Tabs.Screen key={x.name} name={x.name} options={{ title: x.title, tabBarBadge: x.name === 'planner' ? overdue || undefined : undefined }} />)}
      {PAGES.map(([name, title]) => (
        <Tabs.Screen key={name} name={name} options={{ title, ...header }} />
      ))}
      {FROM_SETTINGS.map(([name, title]) => (
        <Tabs.Screen key={name} name={name} options={{ title, ...header, headerLeft: () => (
          <Pressable onPress={() => router.navigate('/settings')} hitSlop={10} accessibilityLabel="Back to Settings" style={{ marginLeft: 12, marginRight: 8 }}>
            <Ionicons name="arrow-back" size={24} color={t.text} />
          </Pressable>
        ) }} />
      ))}
    </Tabs>
  );
}

/** Replays a short rise-and-fade each time its page comes into view, without rebuilding the page. */
function Enter({ children }: { children: React.ReactNode }) {
  const [n, setN] = useState(0);
  const [from, setFrom] = useState<1 | -1 | 0>(0);
  const ref = useRef<View>(null);
  useFocusEffect(useCallback(() => {
    setN((x) => x + 1);
    setFrom(takeEnterFrom()); // reached by a swipe: slide in from that side
    setActiveScene(ref.current as unknown as HTMLElement | null);
    return () => setActiveScene(null);
  }, []));
  const wide = useWide(); // phones switch pages plainly (or slide, after a swipe); the fade is for wide screens
  return <View ref={ref} style={[{ flex: 1 }, wide ? ENTER[n % 2] : from ? SWIPE_IN[from === 1 ? 0 : 1][n % 2] : null]}>{children}</View>;
}

/** A rounded bar of five icons that sits clear of the screen edges. The current tab's icon is filled inside a soft pill. */
function FloatingBar({ state, descriptors, navigation }: any) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const onTab = TABS.some((x) => x.name === current);
  const dark = useScheme() === 'dark';
  // Swipe sideways on one of the five tabs to reach the one beside it.
  const beside = (dir: 1 | -1) => TABS[TABS.findIndex((x) => x.name === current) + dir] ?? null;
  useSwipeTabs(onTab, (dir) => { const x = beside(dir); if (x) navigation.navigate(x.name); }, (dir) => beside(dir)?.title ?? null,
    { text: t.text, card: t.card, accent: t.accent, line: t.line });
  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {/* Content fades out as it passes under the bar, down to the edge of the screen. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundImage: `linear-gradient(to top, ${t.bg} 0%, ${t.bg}d9 35%, ${t.bg}00 100%)` } as any]} />
      <View style={[styles.bar, { backgroundColor: t.card + (dark ? 'cc' : 'd9'), borderColor: t.line, backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' } as any]}>
        {TABS.map((x) => {
          const route = state.routes.find((r: any) => r.name === x.name);
          if (!route) return null;
          const on = current === x.name;
          const badge = descriptors[route.key].options.tabBarBadge;
          return (
            <Pressable key={x.name} accessibilityRole="tab" accessibilityLabel={x.title} accessibilityState={{ selected: on }} hitSlop={4}
              onPress={() => navigation.navigate(x.name)} style={({ pressed }) => [styles.item, PRESS, pressed && { transform: [{ scale: 0.88 }] }]}>
              <View style={[styles.pill, EASE, { backgroundColor: on ? t.accent + '26' : 'transparent', transform: [{ scale: on ? 1 : 0.9 }] }]}>
                <Ionicons name={on ? x.on : x.icon} size={23} color={on ? t.accent : t.muted} />
              </View>
              {badge != null && <View style={[styles.badge, { backgroundColor: t.danger, borderColor: t.card }]}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text></View>}
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="More: search and all pages" hitSlop={4} onPress={() => setPanel('more')}
          style={({ pressed }) => [styles.item, PRESS, pressed && { transform: [{ scale: 0.88 }] }]}>
          {/* Lit while you're on a page that isn't one of the five tabs. */}
          <View style={[styles.pill, EASE, { backgroundColor: onTab ? 'transparent' : t.accent + '26', transform: [{ scale: onTab ? 0.9 : 1 }] }]}>
            <Ionicons name={onTab ? 'ellipsis-horizontal' : 'ellipsis-horizontal-circle'} size={24} color={onTab ? t.muted : t.accent} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 28 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 28, paddingHorizontal: 8, height: 56, boxShadow: '0 8px 28px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.08)' as any },
  item: { width: 52, height: 56, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 46, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
});
