// The strip at the top of every tab (tabs have no header): a menu button on the left and the
// tab's own controls beside it. The menu holds the other pages, with setup (categories,
// imports, settings, sign out) at the bottom.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { MenuButton } from '@/components/Menu';
import { PAGE_MAX, useWide } from '@/lib/layout';
import { loadPrefs, type Page } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';
import { afterClose, useBackToClose } from '@/lib/useBackToClose';

export function TopBar({ children, title }: { children?: ReactNode; title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8, backgroundColor: t.bg }]}>
      {!wide && <MenuButton />}
      {title ? <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: children ? 0 : 1 }}>{title}</Text> : null}
      {children ? <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>{children}</View> : null}
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
