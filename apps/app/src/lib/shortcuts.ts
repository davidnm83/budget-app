// Keyboard shortcuts (desktop). The list here is also what the shortcut guide shows.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { getPanel, setPanel } from './panels';
import { toggleSidebar } from './sidebar';

/** `on`: only on pages that have it (a + button, a strip of weeks or months), listed first as "On this page". */
export const SHORTCUTS: { group: string; keys: string[]; does: string; on?: 'add' | 'period' }[] = [
  { group: 'On this page', keys: ['N'], does: 'Add (the page’s + button)', on: 'add' },
  { group: 'On this page', keys: ['←', '→'], does: 'Previous or next week or month', on: 'period' },
  { group: 'On this page', keys: ['T'], does: 'Back to this week or month', on: 'period' },
  { group: 'Anywhere', keys: ['Ctrl', 'K'], does: 'Search everything' },
  { group: 'Anywhere', keys: ['?'], does: 'Show this guide' },
  { group: 'Anywhere', keys: ['['], does: 'Open or tuck away the sidebar' },
  { group: 'Anywhere', keys: ['Esc'], does: 'Close a pop-up or panel' },
  { group: 'Go to', keys: ['1'], does: 'Home' },
  { group: 'Go to', keys: ['2'], does: 'Transactions' },
  { group: 'Go to', keys: ['3'], does: 'Planner' },
  { group: 'Go to', keys: ['4'], does: 'Budget' },
  { group: 'Go to', keys: ['5'], does: 'Accounts' },
  { group: 'Go to', keys: ['G', 'R'], does: 'Reports' },
  { group: 'Go to', keys: ['G', 'C'], does: 'Credit cards' },
  { group: 'Go to', keys: ['G', 'S'], does: 'Settings' },
  { group: 'Go to', keys: ['G', 'H / T / P / B / A'], does: 'Home, Transactions, Planner, Budget, Accounts' },
  { group: 'Transactions', keys: ['/'], does: 'Jump to the search box' },
  { group: 'Transactions', keys: ['↑', '↓'], does: 'Move to the previous or next transaction' },
  { group: 'Transactions', keys: ['Esc'], does: 'Close the details panel' },
  { group: 'Charts', keys: ['Hover'], does: 'Read out a point' },
  { group: 'Charts', keys: ['Click'], does: 'Open the transactions behind it' },
];

// What the page in view offers: its + button, and its strip of weeks or months. Set by those parts while their
// page is in view (usePageKeys), so every page with one gets the keys.
type PageKeys = { add?: () => void; prev?: () => void; next?: () => void; now?: () => void };
const page: { add?: () => void; period?: Omit<PageKeys, 'add'> } = {};
/** Which page keys are live now (for the guide). */
export const pageHas = () => ({ add: !!page.add, period: !!page.period });
/** While this page is in view, N runs `add` (its + button). */
export function useAddKey(add: () => void) {
  const ref = useRef(add); ref.current = add;
  useFocusEffect(useCallback(() => { const f = () => ref.current(); page.add = f; return () => { if (page.add === f) page.add = undefined; }; }, []));
}
/** While this page is in view, ← → step its period and T goes back to now. */
export function usePeriodKeys(keys: Omit<PageKeys, 'add'>) {
  const ref = useRef(keys); ref.current = keys;
  useFocusEffect(useCallback(() => {
    const k = { prev: () => ref.current.prev?.(), next: () => ref.current.next?.(), now: () => ref.current.now?.() };
    page.period = k; return () => { if (page.period === k) page.period = undefined; };
  }, []));
}

const NUM: Record<string, string> = { 1: '/', 2: '/transactions', 3: '/planner', 4: '/budget', 5: '/accounts' };
const GO: Record<string, string> = { h: '/', t: '/transactions', p: '/planner', b: '/budget', a: '/accounts', r: '/reports', c: '/credit', s: '/settings' };

export function installShortcuts(): () => void {
  if (typeof document === 'undefined') return () => {};
  let g = 0; // time "g" was pressed
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPanel(getPanel() === 'search' ? null : 'search'); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (getPanel()) return; // a panel is open: leave keys to it
    if (document.querySelector('[aria-modal="true"]')) return;
    const k = e.key.toLowerCase();
    if (e.key === '?') { e.preventDefault(); setPanel('shortcuts'); return; }
    if (e.key === '[') { toggleSidebar(); return; }
    if (Date.now() - g >= 1200) {
      if (NUM[e.key]) { e.preventDefault(); router.navigate(NUM[e.key] as any); return; }
      if (k === 'n' && page.add) { e.preventDefault(); page.add(); return; }
      if (e.key === 'ArrowLeft' && page.period) { e.preventDefault(); page.period.prev?.(); return; }
      if (e.key === 'ArrowRight' && page.period) { e.preventDefault(); page.period.next?.(); return; }
      if (k === 't' && page.period) { e.preventDefault(); page.period.now?.(); return; }
    }
    if (k === 'g') { g = Date.now(); return; }
    if (Date.now() - g < 1200 && GO[k]) { g = 0; e.preventDefault(); router.navigate(GO[k] as any); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
