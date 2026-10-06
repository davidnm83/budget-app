// Radar: gathers what the checks in @budget-app/core need (the plan, this month's budget, recent
// spending by category) and returns the cards to show, most urgent first. Worked out in the app
// from data it already loads, so it also works from the offline copy.
import {
  addDays, addMonths, buildBudgetMonth, monthEnd, monthOf, weekStart as mondayOf, radarBanks, radarBills, radarGoals, radarSubscriptions, radarBuffer, radarCards, radarLimits, radarPace, radarRunway, radarUnusual, rankRadar, actualFor,
  type RadarCard, type RadarCheck, type RadarSettings,
} from '@budget-app/core';
import { loadAccounts, loadWeek, today } from './plan';
import { loadPrefs, savePrefs } from './prefs';
import { loadBudgets, loadCategories, loadCategoryMonths, loadMonthSummaries, totalsFor } from './reports';
import { supabase } from './supabase';
import { loadGoals } from './goals';
import { signedBalance } from './types';

const PREFIX = 'radar:';

export async function loadRadar(settings: RadarSettings = {}): Promise<{ cards: RadarCard[]; hidden: number; ids: string[] }> {
  const now = today();
  const month = monthOf(now);
  const week = mondayOf(now);
  const L = radarLimits(settings);
  const on = (c: RadarCheck) => !(settings.off ?? []).includes(c);
  const skip = <T,>(v: T) => Promise.resolve(v);
  // Each check only costs its queries when it is switched on. Accounts are needed by several.
  const [thisWeek, lastWeek, cats, budgets, rows, prefs, accounts, months, banks] = await Promise.all([
    on('buffer') || on('bill') ? loadWeek(week, null) : skip(null),
    on('bill') ? loadWeek(addDays(week, -7), null) : skip(null),
    on('pace') || on('unusual') ? loadCategories() : skip([]),
    on('pace') ? loadBudgets() : skip([]),
    on('pace') || on('unusual') ? loadCategoryMonths(addMonths(month, -3), month) : skip([]),
    loadPrefs(),
    on('cards') || on('runway') ? loadAccounts() : skip([]),
    on('runway') ? loadMonthSummaries(addMonths(month, -3), addDays(month, -1)) : skip([]),
    on('bank') ? supabase.from('plaid_items').select('id, institution_name, status').then(({ data }) => data ?? []) : skip([]),
  ]);
  // Goals and subscriptions: their own queries, and quietly nothing when the tables aren't there yet.
  const [goals, charges] = await Promise.all([
    on('goals') ? loadGoals().then((r) => r.goals).catch(() => []) : skip([]),
    on('subs') ? supabase.from('transactions').select('id, date, amount, name, merchant, account_id').lt('amount', 0).eq('pending', false).gte('date', addDays(now, -200)).order('date').limit(5000)
      .then(({ data }) => (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }))) : skip([]),
  ]);
  const name = (id: string) => thisWeek?.accounts.find((a) => a.id === id)?.name ?? 'An account';
  const lastDay = Number(monthEnd(month).slice(8, 10)), day = Number(now.slice(8, 10));
  const spent = (m: string) => new Map(cats.filter((c) => c.kind === 'expense').map((c) => [c.id, actualFor('expense', totalsFor(rows, m).get(c.id) ?? 0)]));

  const view = on('pace') ? buildBudgetMonth(cats, budgets.filter((b) => b.month === month), totalsFor(rows, month)) : null;
  const pace = view ? radarPace(view.expenses.flatMap((l) => [l, ...(l.children ?? []).filter((c) => c.available > 0)]), day / lastDay, month, L) : [];
  const overIds = new Set(pace.map((c) => c.id.split(':')[2])); // a category already flagged against its budget isn't also "unusual"
  const cash = accounts.filter((a) => a.type === 'depository' && !a.is_hidden).reduce((s, a) => s + signedBalance(a), 0);
  const spendDays = months.reduce((s, m) => s + Number(monthEnd(m.month).slice(8, 10)), 0);
  const all = [
    ...(on('bank') ? radarBanks(banks.map((b: any) => ({ id: b.id, name: b.institution_name ?? 'A bank', status: b.status }))) : []),
    ...(on('buffer') && thisWeek ? radarBuffer(thisWeek.ahead.map((a) => a.warning).filter((w): w is NonNullable<typeof w> => !!w), name, now) : []),
    ...(on('bill') && thisWeek && lastWeek ? radarBills([...lastWeek.view.days, ...thisWeek.view.days].flatMap((d) => d.rows), now, L) : []),
    ...pace,
    ...(on('unusual') ? radarUnusual(cats.filter((c) => !c.hidden && !overIds.has(c.id)), spent(month), [1, 2, 3].map((n) => spent(addMonths(month, -n))), month, lastDay - day, L) : []),
    ...(on('cards') ? radarCards(accounts.filter((a) => a.type === 'credit' && !a.is_hidden).map((a) => ({ id: a.id, name: a.name, owed: Math.max(0, -signedBalance(a)), limit: a.credit_limit == null ? null : Number(a.credit_limit) })), L) : []),
    ...(on('goals') ? radarGoals(goals.filter((g) => !g.closed_on && !g.progress.done).map((g) => ({ id: g.id, name: g.name, behind: g.progress.behind, perMonth: g.progress.perMonth, kind: g.kind }))) : []),
    ...(on('subs') ? radarSubscriptions(charges, now) : []),
    ...(on('runway') ? radarRunway(cash, spendDays ? months.reduce((s, m) => s + Math.abs(m.spending), 0) / spendDays : 0, month, L) : []),
  ];
  const dismissed = (prefs.dismissed_suggestions ?? []).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
  const cards = rankRadar(all, dismissed);
  const ids = [...new Set(all.map((c) => c.id))];
  return { cards, hidden: ids.length - cards.length, ids };
}

/**
 * Hide a card until the facts behind it change. `stillTrue` is every card the checks produce right
 * now, shown or already dismissed: earlier dismissals among them are kept, the rest are tidied away.
 */
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
