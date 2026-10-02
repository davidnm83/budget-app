import './storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { isOffline, offlineFetch } from './offline';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy apps/app/.env.example to apps/app/.env.');
}

// The sign-in lasts an hour and is renewed over the network. Without a connection, Supabase would
// spend half a minute retrying that renewal before every request, and the saved offline data
// would never show. So while offline, an expired sign-in is handed over as if it had time left;
// what is stored isn't changed, and the real renewal happens as soon as the connection is back.
const sessionStore = typeof localStorage === 'undefined' ? undefined : {
  getItem: (k: string) => {
    const v = localStorage.getItem(k);
    if (!v || !isOffline()) return v;
    try {
      const s = JSON.parse(v);
      if (s?.expires_at && s.expires_at * 1000 < Date.now() + 120000) return JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    } catch { /* not a session */ }
    return v;
  },
  setItem: (k: string, v: string) => localStorage.setItem(k, v),
  removeItem: (k: string) => localStorage.removeItem(k),
};

export const supabase = createClient(url, key, {
  auth: {
    storage: sessionStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Reads are saved for offline use and served from there when there's no connection (lib/offline.ts).
  global: { fetch: offlineFetch },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Calls an Edge Function and throws a readable error if it fails. */
export async function callFunction<T = any>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) message = (await ctx.json()).error ?? message;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
