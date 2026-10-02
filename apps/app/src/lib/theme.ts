// Colours. Follows the device's light/dark setting unless you pick one in Settings (kept on this device).
import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

const light = { bg: '#f0f0ec', card: '#ffffff', text: '#1d1d1b', muted: '#6b6b66', line: '#e2e2dc', accent: '#1f6f5c', danger: '#b4541a', positive: '#1f6f5c', track: '#e9e9e3', series1: '#2a78d6', series2: '#eb6834' };
const dark = { bg: '#111110', card: '#1e1e1c', text: '#ececea', muted: '#a3a39c', line: '#2f2f2b', accent: '#4fb398', danger: '#e3894f', positive: '#4fb398', track: '#2c2c29', series1: '#3987e5', series2: '#d95926' };
export type Theme = typeof light;
export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'budget.theme';
const read = (): ThemeMode => { try { const v = globalThis.localStorage?.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } };
let mode: ThemeMode = read();
const subs = new Set<() => void>();
export function setThemeMode(m: ThemeMode) {
  mode = m;
  try { if (m === 'auto') globalThis.localStorage?.removeItem(KEY); else globalThis.localStorage?.setItem(KEY, m); } catch { /* private window: lasts until reload */ }
  subs.forEach((f) => f());
}
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => mode, () => 'auto' as ThemeMode);
}
export function useScheme(): 'light' | 'dark' {
  const device = useColorScheme();
  const m = useThemeMode();
  return m === 'auto' ? (device === 'dark' ? 'dark' : 'light') : m;
}
export function useTheme(): Theme {
  return useScheme() === 'dark' ? dark : light;
}
