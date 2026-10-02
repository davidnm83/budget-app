import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { refreshPlannerBadge, usePlannerBadge } from '@/lib/badges';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

// No headers: each tab starts with its own TopBar (menu button + its controls).
// Phones and small tablets: tabs along the bottom. Laptops and big tablets: no tab bar; the
// sidebar (root layout) lists the tabs.
export default function TabLayout() {
  const t = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const overdue = usePlannerBadge();
  useEffect(() => { refreshPlannerBadge(); }, []);
  return (
    <Tabs tabBar={wide ? () => null : undefined}
      screenOptions={{ headerShown: false, tabBarActiveTintColor: t.accent, sceneStyle: { backgroundColor: t.bg }, tabBarPosition: wide ? 'top' : 'bottom', tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line, height: 62 + insets.bottom, paddingTop: 6 }, tabBarInactiveTintColor: t.muted, tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: -0.1 }, tabBarBadgeStyle: { backgroundColor: t.danger, color: '#fff', fontSize: 10, fontWeight: '700', minWidth: 17, height: 17, lineHeight: 16 } }}>
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} color={color} size={23} /> }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'list' : 'list'} color={color} size={23} /> }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner', tabBarBadge: overdue || undefined, tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} color={color} size={23} /> }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'pie-chart' : 'pie-chart-outline'} color={color} size={23} /> }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'wallet' : 'wallet-outline'} color={color} size={23} /> }} />
    </Tabs>
  );
}

