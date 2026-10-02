// Spending watch list (VIEW-5): chosen categories, month by month, against their usual level.
import { actualFor, addMonths, monthEnd, type Month } from '@budget-app/core';
import { loadPrefs, type WatchCharts } from './prefs';
import { loadBudgets, loadCategories, loadCategoryMonths, thisMonth, type Category } from './reports';

export interface Watched {
  category: Category;
  /** Oldest first, this month last. */
  months: { month: Month; actual: number }[];
  /** Average of the 3 full months before this one. */
  avg3: number;
  thisMonth: number;
  /** Spent so far + the 3-month average's daily amount for the rest of the month. */
  projected: number;
  budget: number | null;
}

/** Several categories drawn as one stacked chart. */
export interface WatchStack { id: string; name: string; parts: Watched[]; custom: boolean }

/** Categories most people want to keep an eye on, used until a list is chosen. */
const DEFAULTS = /^(credit card interest|interest & fees|groceries|restaurants|gas|shopping|toiletries|general goods|fast food)$/i;

export async function loadWatch(today: string, months = 6): Promise<{ list: Watched[]; chosen: boolean; cats: Category[]; charts: WatchCharts; stacks: WatchStack[]; singles: Watched[] }> {
  const [prefs, cats, budgets] = await Promise.all([loadPrefs(), loadCategories(), loadBudgets()]);
  const chosen = !!prefs.watch_categories?.length;
  const ids = chosen ? prefs.watch_categories! : cats.filter((c) => c.kind === 'expense' && DEFAULTS.test(c.name)).map((c) => c.id);
  const now = thisMonth();
  const first = addMonths(now, -(months - 1));
  const rows = await loadCategoryMonths(first, now);
  const day = Number(today.slice(8, 10)), daysIn = Number(monthEnd(now).slice(8, 10));
  const one = (c: Category): Watched => {
    const ms = Array.from({ length: months }, (_, i) => addMonths(first, i)).map((m) => ({
      month: m, actual: actualFor(c.kind, rows.filter((r) => r.category_id === c.id && r.month === m).reduce((s, r) => s + r.total, 0)),
    }));
    const prior = ms.slice(-4, -1);
    const avg3 = prior.length ? prior.reduce((s, x) => s + x.actual, 0) / prior.length : 0;
    const cur = ms[ms.length - 1].actual;
    const b = budgets.find((x) => x.month === now && x.categoryId === c.id);
    // Heading for: what's spent so far plus the usual daily amount for the days left (steadier than
    // stretching a few days of spending over the whole month).
    return { category: c, months: ms, avg3, thisMonth: cur, projected: cur + (avg3 / daysIn) * (daysIn - day), budget: b ? b.amount : null };
  };
  const forIds = (list: string[]) => list.map((id) => cats.find((c) => c.id === id)).filter((c): c is Category => !!c).map(one);
  const list = forIds(ids);
  const charts = prefs.watch_charts ?? {};

  // Your own combined charts first; then, when stacking by group, each group with two or more
  // watched categories becomes one chart and the rest stay on their own.
  const stacks: WatchStack[] = (charts.custom ?? []).map((c) => ({ id: c.id, name: c.name, parts: forIds(c.ids), custom: true })).filter((c) => c.parts.length > 0);
  let singles = list;
  if (charts.byGroup) {
    const groups = new Map<string, Watched[]>();
    for (const w of list) (groups.get(w.category.group) ?? groups.set(w.category.group, []).get(w.category.group)!).push(w);
    singles = [];
    for (const [g, ws] of groups) { if (ws.length > 1) stacks.push({ id: `group:${g}`, name: g, parts: ws, custom: false }); else singles.push(...ws); }
  }
  return { list, chosen, cats, charts, stacks, singles };
}

/** A name for a combined chart: the group when all share one, otherwise the first names. */
export function stackName(cats: Category[]): string {
  if (!cats.length) return 'Combined';
  if (cats.every((c) => c.group === cats[0].group)) return cats[0].group;
  return cats.length <= 2 ? cats.map((c) => c.name).join(' + ') : `${cats[0].name} + ${cats.length - 1} more`;
}
