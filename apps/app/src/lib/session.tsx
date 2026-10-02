import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { isOffline, offlineUser, refreshSaved, wipeOffline } from './offline';
import { forgetLock } from './lock';

// Without a connection the sign-in can't be renewed, and after an hour Supabase reports no session
// at all. The saved one is still on the device, so use it to show the saved data; it is renewed
// the moment the connection is back.
function savedSession(force = false): Session | null {
  if ((!force && !isOffline()) || typeof localStorage === 'undefined') return null;
  try { const s = JSON.parse(localStorage.getItem((supabase.auth as any).storageKey) ?? 'null'); return s?.user && s?.refresh_token ? (s as Session) : null; }
  catch { return null; }
}
let warmed: ReturnType<typeof setTimeout> | null = null;
function signedIn(s: Session) {
  offlineUser(s.user.id);
  if (warmed) clearTimeout(warmed);
  warmed = setTimeout(() => {
    refreshSaved(s.access_token).catch(() => {});
    // Card payment plans: add any instalment that has come due since the app was last open.
    import('./paymentPlans').then((m) => m.syncPlans()).catch(() => {});
  }, 4000);
}

const SessionContext = createContext<{ session: Session | null; loading: boolean }>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Renewing an expired sign-in without a connection keeps retrying for half a minute. Don't
    // hold the app on a blank screen for that: show it with the saved sign-in straight away when
    // the device says it's offline, or after a few seconds on a connection that isn't answering.
    const early = () => { const s = savedSession(true); if (s) { setSession((cur) => cur ?? s); setLoading(false); } };
    if (isOffline()) early();
    const slow = setTimeout(early, 4000);
    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(slow);
      const s = data.session ?? savedSession();
      setSession(s);
      setLoading(false);
      if (data.session) signedIn(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Signing out clears this device: the offline copy and the app lock (it protected that sign-in).
      if (event === 'SIGNED_OUT') { wipeOffline(); forgetLock(); setSession(null); return; }
      setSession(s ?? savedSession());
      if (s && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) signedIn(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
