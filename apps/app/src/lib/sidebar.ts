// Whether the wide-screen sidebar is open. Remembered on this device.
import { useSyncExternalStore } from 'react';

const KEY = 'budget.sidebar';
const read = () => { try { return globalThis.localStorage?.getItem(KEY) !== 'closed'; } catch { return true; } };
let open = read();
const subs = new Set<() => void>();

export function setSidebar(v: boolean) {
  open = v;
  try { globalThis.localStorage?.setItem(KEY, v ? 'open' : 'closed'); } catch { /* private window: lasts until reload */ }
  subs.forEach((f) => f());
}
export function useSidebar(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => open, () => true);
}
export const toggleSidebar = () => setSidebar(!open);
