// Which app-wide panel is open: the phone's "More" sheet (menu + search), the desktop search, or
// the keyboard shortcut guide. Kept outside React so the bar, the sidebar and shortcuts can all open them.
import { useSyncExternalStore } from 'react';

export type Panel = 'more' | 'search' | 'shortcuts' | null;
let panel: Panel = null;
const subs = new Set<() => void>();
export function setPanel(p: Panel) { if (p !== panel) { panel = p; subs.forEach((f) => f()); } }
export const getPanel = () => panel;
export function usePanel(): Panel {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => panel, () => null);
}
