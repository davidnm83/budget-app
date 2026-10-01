import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { PAGE_MAX, useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

// No headers: each tab starts with its own TopBar (menu button + its controls).
export default function TabLayout() {
  const t = useTheme();
  // Phones and small tablets: tabs along the bottom. Laptops and big tablets: across the top, centred.
  const wide = useWide();
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: t.accent, sceneStyle: { backgroundColor: t.bg },
      tabBarPosition: wide ? 'top' : 'bottom', tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
      tabBarStyle: wide
        ? { backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.line, borderTopWidth: 0, height: 52, paddingHorizontal: `max(12px, calc((100% - ${PAGE_MAX}px) / 2))` as any }
        : { backgroundColor: t.card },
      tabBarLabelStyle: wide ? { fontSize: 14, fontWeight: '600' } : undefined,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} /> }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
