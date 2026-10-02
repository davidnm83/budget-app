// First-run setup and the currency setting. The currency is kept with your account
// (user_prefs.currency) and remembered on the device so amounts are right from the first paint.
import { currency, setCurrency } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const KEY = 'budget.currency';
const DEFAULT = (process.env.EXPO_PUBLIC_CURRENCY || 'USD').toUpperCase();
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'INR', 'MXN', 'BRL', 'ZAR'];

function remembered(): string | null {
  try { return Platform.OS === 'web' ? window.localStorage.getItem(KEY) : null; } catch { return null; }
}
function remember(code: string) {
  try { if (Platform.OS === 'web') window.localStorage.setItem(KEY, code); } catch { /* private window */ }
}

// Applied as soon as the app's code loads, before anything draws.
setCurrency(remembered() ?? DEFAULT);

export const isCurrency = (code: string) => /^[A-Z]{3}$/.test(code);

/** Saves the currency with your account. Amounts already on screen are redrawn by reloading (web). */
export async function saveCurrency(code: string, reload = true) {
  const c = code.trim().toUpperCase();
  if (!isCurrency(c)) throw new Error('Use a 3-letter currency code, like USD or EUR.');
  const { error } = await supabase.from('user_prefs').upsert({ currency: c, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  remember(c);
  setCurrency(c);
  if (reload && Platform.OS === 'web') window.location.reload();
}

export async function finishSetup() {
  const { error } = await supabase.from('user_prefs').upsert({ setup_done: true, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function loadSampleData(): Promise<number> {
  const { data, error } = await supabase.rpc('load_sample_data');
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
export async function clearSampleData(): Promise<number> {
  const { data, error } = await supabase.rpc('clear_sample_data');
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Whether to show the setup screen: only for an account that hasn't finished it and has no
 * accounts yet. Also brings the saved currency onto a new device.
 */
export function useSetup(userId: string | undefined): { state: 'loading' | 'needed' | 'done'; finish: () => void } {
  const [state, setState] = useState<'loading' | 'needed' | 'done'>('loading');
  useEffect(() => {
    if (!userId) { setState('loading'); return; }
    let live = true;
    (async () => {
      const [prefs, accounts] = await Promise.all([
        supabase.from('user_prefs').select('currency, setup_done').maybeSingle(),
        supabase.from('accounts').select('id', { count: 'exact', head: true }),
      ]);
      if (!live) return;
      const saved = prefs.data?.currency as string | null | undefined;
      if (saved && saved !== currency()) {
        remember(saved); setCurrency(saved);
        if (Platform.OS === 'web') { window.location.reload(); return; }
      }
      // If the question can't be answered (offline, old database), don't block the app.
      const needed = !prefs.error && !accounts.error && !prefs.data?.setup_done && (accounts.count ?? 0) === 0;
      setState(needed ? 'needed' : 'done');
    })();
    return () => { live = false; };
  }, [userId]);
  return { state, finish: () => setState('done') };
}
