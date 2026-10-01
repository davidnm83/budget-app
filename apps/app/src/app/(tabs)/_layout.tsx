import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useTheme } from '@/lib/theme';

// No headers: each tab starts with its own TopBar (menu button + its controls).
export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: t.accent, tabBarStyle: { backgroundColor: t.card } }}>
      <Tabs.Screen name="index" options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} /> }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
