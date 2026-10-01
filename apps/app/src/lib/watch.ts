// Spending watch list (VIEW-5): chosen categories, month by month, against their usual level.
import { actualFor, addMonths, monthEnd, type Month } from '@budget-app/core';
import { loadPrefs } from './prefs';
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

/** Categories most people want to keep an eye on, used until a list is chosen. */
const DEFAULTS = /^(credit card interest|groceries|gas|toiletries|general goods|fast food)$/i;

export async function loadWatch(today: string, months = 6): Promise<{ list: Watched[]; chosen: boolean; cats: Category[] }> {
  const [prefs, cats, budgets] = await Promise.all([loadPrefs(), loadCategories(), loadBudgets()]);
  const chosen = !!prefs.watch_categories?.length;
  const ids = chosen ? prefs.watch_categories! : cats.filter((c) => c.kind === 'expense' && DEFAULTS.test(c.name)).map((c) => c.id);
  const now = thisMonth();
  const first = addMonths(now, -(months - 1));
  const rows = await loadCategoryMonths(first, now);
  const day = Number(today.slice(8, 10)), daysIn = Number(monthEnd(now).slice(8, 10));
  const list = ids.map((id) => cats.find((c) => c.id === id)).filter((c): c is Category => !!c).map((c) => {
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
  });
  return { list, chosen, cats };
}
