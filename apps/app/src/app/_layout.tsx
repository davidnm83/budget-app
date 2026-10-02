import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { MenuButton, Sidebar } from '@/components/Menu';
import { useScheme } from '@/lib/theme';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

// Menu pages are each other's neighbours, not steps down from a tab: the menu button replaces the back arrow.
const MENU_PAGE = { headerLeft: () => <View style={{ marginLeft: 8, marginRight: 4 }}><MenuButton plain /></View>, headerBackVisible: false };

function RootStack() {
  const { session, loading } = useSession();
  useEffect(() => { if (!loading) SplashScreen.hideAsync(); }, [loading]);
  if (loading) return null;
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
    {!!session && <Sidebar />}
    <View style={{ flex: 1 }}>
    <Stack>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction', presentation: 'modal' }} />
        <Stack.Screen name="import" options={{ title: 'Import CSV' }} />
        <Stack.Screen name="fina-import" options={{ title: 'Import from Fina' }} />
        <Stack.Screen name="report" options={{ title: 'Report' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', ...MENU_PAGE }} />
        <Stack.Screen name="bills" options={{ title: 'Bills & income', ...MENU_PAGE }} />
        <Stack.Screen name="reports" options={{ title: 'Reports', ...MENU_PAGE }} />
        <Stack.Screen name="categories" options={{ title: 'Categories', ...MENU_PAGE }} />
        <Stack.Screen name="merchants" options={{ title: 'Merchants', ...MENU_PAGE }} />
        <Stack.Screen name="gig" options={{ title: 'Gig work', ...MENU_PAGE }} />
        <Stack.Screen name="credit" options={{ title: 'Credit cards', ...MENU_PAGE }} />
        <Stack.Screen name="watch" options={{ title: 'Spending watch', ...MENU_PAGE }} />
        <Stack.Screen name="loans" options={{ title: 'Car & loans', ...MENU_PAGE }} />
        <Stack.Screen name="page/[id]" options={{ title: 'Page', ...MENU_PAGE }} />
      </Stack.Protected>
    </Stack>
    </View>
    </View>
  );
}

// Chrome on Android adds a row above the keyboard (passwords, cards, addresses) for any field it
// thinks it could fill in. Nothing here is that kind of field, so say so on every one except sign-in.
function useNoAutofill() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    // React Native's text fields say autocomplete="on" unless told otherwise; sign-in names its fields, so it's left alone.
    const fix = (el: Element) => {
      if (!/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('data-form-type') === 'other') return;
      const ac = el.getAttribute('autocomplete') ?? 'on';
      if (ac !== 'on' && ac !== 'off') return; // sign-in names its fields
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('data-form-type', 'other'); el.setAttribute('data-lpignore', 'true'); el.setAttribute('data-1p-ignore', 'true');
      // Chrome often ignores autocomplete="off" on plain text fields but doesn't offer autofill on search fields.
      if (el.tagName === 'INPUT' && (el.getAttribute('type') ?? 'text') === 'text') el.setAttribute('type', 'search');
    };
    const css = document.createElement('style');
    css.textContent = 'input[type=search]{-webkit-appearance:none;appearance:none}input[type=search]::-webkit-search-cancel-button,input[type=search]::-webkit-search-decoration{-webkit-appearance:none;display:none}';
    document.head.appendChild(css);
    const mark = (root: ParentNode) => root.querySelectorAll?.('input, textarea').forEach(fix);
    mark(document);
    const obs = new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { fix(n as Element); mark(n as Element); } })));
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { obs.disconnect(); css.remove(); };
  }, []);
}

export default function RootLayout() {
  const scheme = useScheme();
  useNoAutofill();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <RootStack />
      </SessionProvider>
    </ThemeProvider>
  );
}
