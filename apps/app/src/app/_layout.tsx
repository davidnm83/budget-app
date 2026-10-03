import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { installPullRefresh } from '@/lib/pullRefresh';
import { installShortcuts } from '@/lib/shortcuts';
import { OfflinePill, PullIndicator, Toaster } from '@/components/Overlays';
import { registerServiceWorker } from '@/lib/sw';
import { LockScreen } from '@/components/LockScreen';
import { installAutoLock } from '@/lib/lock';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Panels, Sidebar } from '@/components/Menu';
import { CsvReminder } from '@/components/CsvReminder';
import { useScheme } from '@/lib/theme';
import { SessionProvider, useSession } from '@/lib/session';
import Setup from '@/components/Setup';
import { useSetup } from '@/lib/setup';

SplashScreen.preventAutoHideAsync();


function RootStack() {
  const { session, loading } = useSession();
  const scheme = useScheme();
  useEffect(() => { if (!loading) SplashScreen.hideAsync(); }, [loading]);
  const setup = useSetup(session?.user.id);
  if (loading) return null;
  // A brand-new account sees the setup screen first, laid over the app (which stays mounted so
  // navigation keeps working). While that's being worked out, a blank cover avoids a flash.
  const cover = !session || setup.state === 'done' ? null : (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: scheme === 'dark' ? '#111110' : '#f0f0ec' }}>
      {setup.state === 'needed' && <Setup onDone={setup.finish} demo={session.user.app_metadata?.demo === true} />}
    </View>
  );
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
        <Stack.Screen name="report" options={{ title: 'Report' }} />
      </Stack.Protected>
    </Stack>
    </View>
    {!!session && <PullIndicator />}
    {!!session && <Panels />}
    {!!session && !cover && <CsvReminder />}
    {cover}
    {!!session && <OfflinePill />}
    <Toaster />
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
      // React removes a type it didn't set every time the field re-renders (each keystroke), which is why the
      // autofill row came back on some fields: this field keeps its type.
      if (el.tagName === 'INPUT' && (el.getAttribute('type') ?? 'text') === 'text') {
        el.setAttribute('type', 'search');
        const remove = el.removeAttribute.bind(el);
        el.removeAttribute = (name: string) => { if (name !== 'type') remove(name); };
      }
    };
    const css = document.createElement('style');
    css.textContent = 'html,body{overscroll-behavior-y:contain}'
      + '[tabindex="0"],[role="button"],[role="tab"],[role="link"]{transition:background-color .16s ease-out,border-color .16s ease-out,box-shadow .2s ease-out,transform .14s cubic-bezier(.2,.8,.2,1),opacity .16s ease-out}'
      // Closing a pop-up with Esc hands focus back to the row or button behind it, and the browser then drew its
      // blue ring round it. Rows and buttons already show selection and hover in their own way; fields keep theirs.
      + '[tabindex="0"]:focus,[role="button"]:focus,[role="tab"]:focus,[role="link"]:focus{outline:none}'
      + '@media (hover:hover){[data-emoji]:hover{background-color:rgba(128,128,128,.22)}}'
      + '@media (hover:hover){*{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,.35) transparent}}'
      + '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}input[type=search]{-webkit-appearance:none;appearance:none}input[type=search]::-webkit-search-cancel-button,input[type=search]::-webkit-search-decoration{-webkit-appearance:none;display:none}';
    document.head.appendChild(css);
    // Most of what gets added to a page has no fields in it, so only look inside when there are children at all.
    const mark = (root: ParentNode) => { if ((root as Element).firstElementChild !== null) root.querySelectorAll?.('input, textarea').forEach(fix); };
    mark(document);
    const obs = new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { fix(n as Element); mark(n as Element); } })));
    obs.observe(document.body, { childList: true, subtree: true });
    const stopPull = installPullRefresh(), stopKeys = installShortcuts(), stopLock = installAutoLock();
    registerServiceWorker();
    return () => { obs.disconnect(); css.remove(); stopPull(); stopKeys(); stopLock(); };
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
      {/* In front of everything while locked; the sign-in itself can't be read until it is unlocked. */}
      <LockScreen />
    </ThemeProvider>
  );
}
