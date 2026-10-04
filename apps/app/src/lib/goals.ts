// Goals (GOAL-1): loads goals with what each one counts (an account's balance, money marked for it,
// or what's still owed on a loan or card) and works out progress with @budget-app/core.
import { goalProgress, nextRefillDate, type GoalKind, type GoalProgress } from '@budget-app/core';
import { loadAccounts, today } from './plan';
import { supabase } from './supabase';
import { signedBalance, type Account } from './types';

export interface GoalRow {
  id: string; name: string; icon: string | null; kind: GoalKind; target: number; target_date: string | null; start_date: string;
  start_value: number; account_id: string | null; refills: boolean; sort: number; closed_on: string | null;
}
export interface GoalEntry { id: string; goal_id: string; date: string; amount: number; note: string | null }
export interface Goal extends GoalRow {
  /** What the goal counts now: saved (savings) or still owed (payoff). */
  current: number;
  /** The date the pace is measured against (a yearly fund's next one). */
  due: string | null;
  account: Account | null;
  progress: GoalProgress;
  entries: GoalEntry[];
}

/** What a payoff goal's account owes now (positive). */
export const owedOn = (a: Account) => Math.max(0, -signedBalance(a));

export async function loadGoals(): Promise<{ goals: Goal[]; accounts: Account[] }> {
  const [g, e, accounts] = await Promise.all([
    supabase.from('goals').select('*').order('sort').order('created_at'),
    supabase.from('goal_entries').select('id, goal_id, date, amount, note').order('date', { ascending: false }),
    loadAccounts(),
  ]);
  if (g.error) throw new Error(/goals/.test(g.error.message) && /exist|schema cache/.test(g.error.message) ? 'Goals need the newest database update (supabase db push).' : g.error.message);
  const entries = ((e.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })) as GoalEntry[];
  const now = today();
  const goals = ((g.data ?? []) as any[]).map((r): Goal => {
    const row: GoalRow = { ...r, target: Number(r.target), start_value: Number(r.start_value) };
    const account = accounts.find((a) => a.id === row.account_id) ?? null;
    const mine = entries.filter((x) => x.goal_id === row.id);
    const marked = mine.reduce((s, x) => s + x.amount, 0);
    const current = row.kind === 'payoff' ? (account ? owedOn(account) : row.start_value) : account ? signedBalance(account) : marked;
    // A yearly fund measures its pace over the year leading to its next date, from empty.
    const due = row.target_date && row.refills ? nextRefillDate(row.target_date, now) : row.target_date;
    const rolled = !!(row.refills && due && row.target_date && due !== row.target_date);
    const startDate = rolled ? `${Number(due!.slice(0, 4)) - 1}${due!.slice(4)}` : row.start_date;
    const startValue = rolled ? 0 : row.start_value;
    const progress = goalProgress({ kind: row.kind, target: row.target, targetDate: due, startDate, startValue, current }, now);
    return { ...row, current, due, account, progress, entries: mine };
  });
  return { goals, accounts };
}

export async function addGoalEntry(goalId: string, amount: number, note: string | null, date = today()) {
  const { error } = await supabase.from('goal_entries').insert({ goal_id: goalId, amount, note, date });
  if (error) throw new Error(error.message);
}
