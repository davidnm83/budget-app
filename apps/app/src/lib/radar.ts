// Radar: gathers what the checks in @budget-app/core need (the plan, this month's budget, recent
// spending by category) and returns the cards to show, most urgent first. Worked out in the app
// from data it already loads, so it also works from the offline copy.
import {
  addDays, addMonths, buildBudgetMonth, monthEnd, monthOf, weekStart as mondayOf, radarBills, radarBuffer, radarPace, radarUnusual, rankRadar, actualFor,
  type RadarCard,
} from '@budget-app/core';
import { loadWeek, today } from './plan';
import { loadPrefs, savePrefs } from './prefs';
import { loadBudgets, loadCategories, loadCategoryMonths, totalsFor } from './reports';

const PREFIX = 'radar:';

export async function loadRadar(): Promise<{ cards: RadarCard[]; hidden: number }> {
  const now = today();
  const month = monthOf(now);
  const week = mondayOf(now);
  const [thisWeek, lastWeek, cats, budgets, rows, prefs] = await Promise.all([
    loadWeek(week, null), loadWeek(addDays(week, -7), null), loadCategories(), loadBudgets(), loadCategoryMonths(addMonths(month, -3), month), loadPrefs(),
  ]);
  const name = (id: string) => thisWeek.accounts.find((a) => a.id === id)?.name ?? 'An account';
  const lastDay = Number(monthEnd(month).slice(8, 10)), day = Number(now.slice(8, 10));
  const view = buildBudgetMonth(cats, budgets.filter((b) => b.month === month), totalsFor(rows, month));
  const spent = (m: string) => new Map(cats.filter((c) => c.kind === 'expense').map((c) => [c.id, actualFor('expense', totalsFor(rows, m).get(c.id) ?? 0)]));

  const pace = radarPace(view.expenses.flatMap((l) => [l, ...(l.children ?? []).filter((c) => c.available > 0)]), day / lastDay, month);
  const overIds = new Set(pace.map((c) => c.id.split(':')[2])); // a category already flagged against its budget isn't also "unusual"
  const all = [
    ...radarBuffer(thisWeek.ahead.map((a) => a.warning).filter((w): w is NonNullable<typeof w> => !!w), name, now),
    ...radarBills([...lastWeek.view.days, ...thisWeek.view.days].flatMap((d) => d.rows), now),
    ...pace,
    ...radarUnusual(cats.filter((c) => !c.hidden && !overIds.has(c.id)), spent(month), [1, 2, 3].map((n) => spent(addMonths(month, -n))), month, lastDay - day),
  ];
  const dismissed = (prefs.dismissed_suggestions ?? []).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
  const cards = rankRadar(all, dismissed);
  return { cards, hidden: new Set(all.map((c) => c.id)).size - cards.length };
}

/** Hide a card until the facts behind it change. Dismissals for things no longer true are tidied away. */
export async function dismissRadar(id: string, stillTrue: string[]) {
  const prefs = await loadPrefs();
  const keep = new Set(stillTrue);
  const others = (prefs.dismissed_suggestions ?? []).filter((k) => !k.startsWith(PREFIX) || keep.has(k.slice(PREFIX.length)));
  await savePrefs({ dismissed_suggestions: [...new Set([...others, PREFIX + id])] });
}
export async function restoreRadar() {
  const prefs = await loadPrefs();
  await savePrefs({ dismissed_suggestions: (prefs.dismissed_suggestions ?? []).filter((k) => !k.startsWith(PREFIX)) });
}
