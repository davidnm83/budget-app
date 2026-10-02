// Keyboard shortcuts (desktop). The list here is also what the shortcut guide shows.
import { router } from 'expo-router';
import { getPanel, setPanel } from './panels';
import { toggleSidebar } from './sidebar';

export const SHORTCUTS: { group: string; keys: string[]; does: string }[] = [
  { group: 'Anywhere', keys: ['Ctrl', 'K'], does: 'Search everything' },
  { group: 'Anywhere', keys: ['?'], does: 'Show this guide' },
  { group: 'Anywhere', keys: ['['], does: 'Open or tuck away the sidebar' },
  { group: 'Anywhere', keys: ['Esc'], does: 'Close a pop-up or panel' },
  { group: 'Go to', keys: ['G', 'H'], does: 'Home' },
  { group: 'Go to', keys: ['G', 'T'], does: 'Transactions' },
  { group: 'Go to', keys: ['G', 'P'], does: 'Planner' },
  { group: 'Go to', keys: ['G', 'B'], does: 'Budget' },
  { group: 'Go to', keys: ['G', 'A'], does: 'Accounts' },
  { group: 'Go to', keys: ['G', 'R'], does: 'Reports' },
  { group: 'Go to', keys: ['G', 'C'], does: 'Credit cards' },
  { group: 'Go to', keys: ['G', 'S'], does: 'Settings' },
  { group: 'Transactions', keys: ['/'], does: 'Jump to the search box' },
  { group: 'Transactions', keys: ['↑', '↓'], does: 'Move to the previous or next transaction' },
  { group: 'Transactions', keys: ['Esc'], does: 'Close the details panel' },
  { group: 'Charts', keys: ['Hover'], does: 'Read out a point' },
  { group: 'Charts', keys: ['Click'], does: 'Open the transactions behind it' },
];
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
    if (k === 'g') { g = Date.now(); return; }
    if (Date.now() - g < 1200 && GO[k]) { g = 0; e.preventDefault(); router.navigate(GO[k] as any); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
