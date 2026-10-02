import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MenuButton } from '@/components/Menu';
import { PAGE_MAX, useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

// No headers: each tab starts with its own TopBar (menu button + its controls).
// Phones and small tablets: tabs along the bottom. Laptops and big tablets: one bar across the
// top with the menu button at its left.
export default function TabLayout() {
  const t = useTheme();
  const wide = useWide();
  return (
    <Tabs tabBar={wide ? (p: any) => <WideBar {...p} /> : undefined}
      screenOptions={{ headerShown: false, tabBarActiveTintColor: t.accent, sceneStyle: { backgroundColor: t.bg }, tabBarPosition: wide ? 'top' : 'bottom', tabBarStyle: { backgroundColor: t.card } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} /> }} />
      <Tabs.Screen name="planner" options={{ title: 'Planner', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}

function WideBar({ state, descriptors, navigation }: any) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.card, borderBottomWidth: 1, borderColor: t.line }}>
      <View style={styles.bar}>
        <MenuButton plain />
        {state.routes.map((r: any, i: number) => {
          const o = descriptors[r.key].options;
          const on = state.index === i;
          const color = on ? t.accent : t.muted;
          return (
            <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => navigation.navigate(r.name)}
              style={({ hovered }: any) => [styles.tab, on && { borderBottomColor: t.accent }, hovered && !on && { backgroundColor: t.bg }]}>
              {o.tabBarIcon?.({ color, size: 20, focused: on })}
              <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{o.title}</Text>
              {o.tabBarBadge != null && <View style={[styles.badge, { backgroundColor: t.danger }]}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{o.tabBarBadge}</Text></View>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'stretch', gap: 4, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center', paddingHorizontal: 8, height: 52 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderBottomWidth: 3, borderBottomColor: 'transparent', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
});
