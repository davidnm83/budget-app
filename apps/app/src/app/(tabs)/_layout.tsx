import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MenuButton } from '@/components/Menu';
import { LIFT } from '@/components/ui';
import { refreshPlannerBadge, usePlannerBadge } from '@/lib/badges';
import { useWide } from '@/lib/layout';
import { EASE } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

// Every signed-in page lives here, so the navigation bar stays put wherever you are.
//   • The five tabs have no header: each starts with its own TopBar.
//   • Menu pages (Gig work, Reports, Settings…) get a header with the menu button.
// Phones: a floating bar of five icons at the bottom. Wide screens: no bar; the sidebar lists everything.
const TABS: { name: string; title: string; icon: keyof typeof Ionicons.glyphMap; on: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', on: 'home' },
  { name: 'transactions', title: 'Transactions', icon: 'list-outline', on: 'list' },
  { name: 'planner', title: 'Planner', icon: 'calendar-outline', on: 'calendar' },
  { name: 'budget', title: 'Budget', icon: 'pie-chart-outline', on: 'pie-chart' },
  { name: 'accounts', title: 'Accounts', icon: 'wallet-outline', on: 'wallet' },
];
const PAGES: [string, string][] = [
  ['gig', 'Gig work'], ['credit', 'Credit cards'], ['watch', 'Spending watch'], ['loans', 'Car & loans'], ['reports', 'Reports'],
  ['categories', 'Categories'], ['merchants', 'Merchants'], ['settings', 'Settings'], ['bills', 'Bills & income'], ['page/[id]', 'Page'],
];
// Reached from Settings, so they go back there.
const FROM_SETTINGS: [string, string][] = [['import', 'Import CSV'], ['fina-import', 'Import from Fina']];

export default function TabLayout() {
  const t = useTheme();
  const wide = useWide();
  const overdue = usePlannerBadge();
  useEffect(() => { refreshPlannerBadge(); }, []);
  const header = { headerShown: true, headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerShadowVisible: false, headerTitleAlign: 'left' as const };
  return (
    <Tabs backBehavior="history" tabBar={(p: any) => (wide ? null : <FloatingBar {...p} />)}
      screenOptions={{ headerShown: false, animation: 'fade', sceneStyle: { backgroundColor: t.bg } }}>
      {TABS.map((x) => <Tabs.Screen key={x.name} name={x.name} options={{ title: x.title, tabBarBadge: x.name === 'planner' ? overdue || undefined : undefined }} />)}
      {PAGES.map(([name, title]) => (
        <Tabs.Screen key={name} name={name} options={{ title, ...header, headerLeft: () => <View style={{ marginLeft: 8, marginRight: 4 }}><MenuButton plain /></View> }} />
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

/** A rounded bar of five icons that sits clear of the screen edges. The current tab's icon is filled inside a soft pill. */
function FloatingBar({ state, descriptors, navigation }: any) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    <View style={{ backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, 10), paddingTop: 6, alignItems: 'center' }}>
      <View style={[styles.bar, LIFT, { backgroundColor: t.card, borderColor: t.line }]}>
        {TABS.map((x) => {
          const route = state.routes.find((r: any) => r.name === x.name);
          if (!route) return null;
          const on = current === x.name;
          const badge = descriptors[route.key].options.tabBarBadge;
          return (
            <Pressable key={x.name} accessibilityRole="tab" accessibilityLabel={x.title} accessibilityState={{ selected: on }} hitSlop={4}
              onPress={() => navigation.navigate(x.name)} style={styles.item}>
              <View style={[styles.pill, EASE, { backgroundColor: on ? t.accent + '22' : 'transparent' }]}>
                <Ionicons name={on ? x.on : x.icon} size={23} color={on ? t.accent : t.muted} />
              </View>
              {badge != null && <View style={[styles.badge, { backgroundColor: t.danger, borderColor: t.card }]}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text></View>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 28, paddingHorizontal: 8, height: 56, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' as any },
  item: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 48, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
});
