// Data for Bills and the Planner: recurring bills/income, one-off planned entries, the
// accounts the plan covers, and posted transactions to match against.
import {
  addDays, balanceAt, buildWeek, expandPlan, todayIn, weekStart as mondayOf,
  type PlanEntry, type PostedTxn, type Recurring, type WeekView,
} from '@budget-app/core';
import { supabase } from './supabase';
import { signedBalance, type Account } from './types';

export const today = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadRecurring(): Promise<Recurring[]> {
  const { data, error } = await supabase.from('recurring').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
}

export async function loadEntries(from: string, to: string): Promise<PlanEntry[]> {
  // One-offs dated in the range, plus changes to recurring dates that fall in it (moved or not).
  const { data, error } = await supabase.from('plan_entries').select('*')
    .or(`and(date.gte.${from},date.lte.${to}),and(occurrence_date.gte.${from},occurrence_date.lte.${to})`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: any) => ({ ...e, amount: Number(e.amount) }));
}

export async function loadPosted(accountIds: string[], from: string, to: string): Promise<PostedTxn[]> {
  if (!accountIds.length) return [];
  const rows = await fetchAll<any>((a, b) => supabase.from('transaction_list').select('id, date, amount, account_id, name, display_name')
    .in('account_id', accountIds).gte('date', from).lte('date', to).order('id').range(a, b));
  return rows.map((r) => ({ id: r.id, date: r.date, amount: Number(r.amount), accountId: r.account_id, name: r.name, merchant: r.display_name }));
}

export async function loadAccounts(): Promise<Account[]> {
  const { data, error } = await supabase.from('account_balances').select('*').eq('is_hidden', false).order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((a: any) => ({ ...a, current_balance: a.balance, balance_updated_at: a.balance_as_of, plan_buffer: Number(a.plan_buffer ?? 0) }));
}

export interface PlannerData { view: WeekView; accounts: Account[]; recurring: Recurring[]; entries: PlanEntry[] }

/**
 * One week of the plan. Start balances: for this week and past weeks, today's balance minus
 * everything posted since the week began (PLN-2); for future weeks, the projected end of the
 * week before, carried forward week by week.
 */
export async function loadWeek(week: string, only: string | null): Promise<PlannerData> {
  const now = today();
  const thisWeek = mondayOf(now);
  const all = await loadAccounts();
  const planAccounts = all.filter((a) => a.plan_include);
  const ids = planAccounts.map((a) => a.id);
  const from = week < thisWeek ? week : thisWeek;
  const to = addDays(week > thisWeek ? week : thisWeek, 6);
  const [recurring, entries, posted] = await Promise.all([
    loadRecurring(), loadEntries(addDays(from, -31), addDays(to, 31)), loadPosted(ids, addDays(from, -4), addDays(to > now ? to : now, 4)),
  ]);

  const start: Record<string, number> = {};
  for (const a of planAccounts) start[a.id] = balanceAt(signedBalance(a), posted.filter((t) => t.accountId === a.id && t.date <= now), week <= thisWeek ? week : thisWeek);
  for (let w = thisWeek; w < week; w = addDays(w, 7)) {
    const v = buildWeek({
      weekStart: w, today: now, planned: expandPlan(recurring, entries, w, addDays(w, 6)), actuals: posted,
      accounts: planAccounts.map((a) => ({ id: a.id, name: a.name, startBalance: start[a.id], buffer: Number(a.plan_buffer ?? 0) })),
    });
    Object.assign(start, v.endBalanceByAccount);
  }
  const shown = only ? planAccounts.filter((a) => a.id === only) : planAccounts;
  const view = buildWeek({
    weekStart: week, today: now, planned: expandPlan(recurring, entries, week, addDays(week, 6)), actuals: posted,
    accounts: shown.map((a) => ({ id: a.id, name: a.name, startBalance: start[a.id], buffer: Number(a.plan_buffer ?? 0) })),
  });
  return { view, accounts: all, recurring, entries };
}
