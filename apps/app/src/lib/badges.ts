// Counts shown as badges on the Planner (tab bar and sidebar): planned entries whose day has
// passed without a matching transaction. Worked out once at start and whenever the planner loads.
import { weekStart } from '@budget-app/core';
import { useSyncExternalStore } from 'react';
import { loadWeek, today } from './plan';

let overdue = 0;
const subs = new Set<() => void>();
export function setPlannerBadge(n: number) { if (n !== overdue) { overdue = n; subs.forEach((f) => f()); } }
export function usePlannerBadge(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => overdue, () => 0);
}
export async function refreshPlannerBadge() {
  try { setPlannerBadge((await loadWeek(weekStart(today()), null)).view?.summary.overdue ?? 0); } catch { /* a badge is never worth an error */ }
}
