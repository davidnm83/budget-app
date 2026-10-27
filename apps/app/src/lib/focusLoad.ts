// A tab page's data: loaded each time the page comes into view, and also when the page is opened ahead
// of time beside the current tab (lib/swipeTabs), so a swipe brings it in with its content already there.
import { useNavigation } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { justClosed } from './useBackToClose';

export function useFocusLoad(load: () => void) {
  const navigation = useNavigation();
  const loaded = useRef(false);
  const run = useCallback(() => { loaded.current = true; load(); }, [load]);
  // Closing a pop-up steps the browser's history back; in the installed app that can count as the page
  // coming into view again, which reloaded everything under the pop-up. Nothing changed, so it's skipped.
  // Never the first time, though: a page opened from the menu (a pop-up on the phone, just closed) still loads.
  useFocusEffect(useCallback(() => { if (!loaded.current || !justClosed()) run(); }, [run]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!navigation.isFocused()) run(); }, []);
}
