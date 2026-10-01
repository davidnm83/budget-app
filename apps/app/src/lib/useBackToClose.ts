// On the web (incl. the app installed from Chrome), pop-ups aren't pages, so the back gesture
// would leave the page underneath. While a pop-up is open this adds a history entry for it:
// back then closes the pop-up instead. Closing it with its own button removes that entry again.
// On Android/iOS the Modal's onRequestClose already handles the back gesture.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export function useBackToClose(visible: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || typeof window === 'undefined') return;
    const tag = Math.random().toString(36).slice(2);
    // Keep the router's own state in the entry so it sees "the same page" when we go back to it.
    window.history.pushState({ ...(window.history.state ?? {}), __sheet: tag }, '');
    let closedByBack = false;
    const onPop = () => {
      if ((window.history.state as any)?.__sheet === tag) return; // moved forward onto ours again
      closedByBack = true;
      window.removeEventListener('popstate', onPop);
      close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByBack && (window.history.state as any)?.__sheet === tag) window.history.back();
    };
  }, [visible]);
}
