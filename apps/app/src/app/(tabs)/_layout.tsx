import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

// No headers: each tab starts with its own TopBar (menu button + its controls).
// Phones and small tablets: tabs along the bottom. Laptops and big tablets: no tab bar; the
// sidebar (root layout) lists the tabs.
export default function TabLayout() {
  const t = useTheme();
  const wide = useWide();
  return (
    <Tabs tabBar={wide ? () => null : undefined}
      screenOptions={{ headerShown: false, tabBarActiveTintColor: t.accent, sceneStyle: { backgroundColor: t.bg }, tabBarPosition: wide ? 'top' : 'bottom', tabBarStyle: { backgroundColor: t.card } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} /> }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}

