// Data for Bills and the Planner: recurring bills/income, one-off planned entries, the
// accounts the plan covers, and posted transactions to match against.
import {
  addDays, balanceAt, buildWeek, cardCycle, cardStatement, planHeld, expandPlan, round2, todayIn, weekStart as mondayOf,
  type PlanEntry, type PostedTxn, type Recurring, type WeekView,
} from '@budget-app/core';
import { supabase } from './supabase';
import { signedBalance, type Account } from './types';

/** Today's date on this device (its own time zone). Read from the clock directly: it's called for every row and heading. */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

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
  return resolveCardBills((data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })));
}

/**
 * Credit card bills (BIL-3): the amount follows the card instead of a fixed number.
 *   statement — what's left on the last statement (or, once that's paid, what you owe now)
 *   minimum   — an estimate: 3% of that, at least $10
 *   custom    — the amount you entered
 */
async function resolveCardBills(list: (Recurring & { card_account_id?: string | null; card_rule?: string | null })[]): Promise<Recurring[]> {
  const cards = [...new Set(list.filter((r) => r.card_account_id && r.card_rule && r.card_rule !== 'custom').map((r) => r.card_account_id!))];
  if (!cards.length) return list;
  const now = today();
  const [{ data: accts }, { data: txns }] = await Promise.all([
    supabase.from('account_balances').select('id, type, balance, statement_day, due_day').in('id', cards),
    supabase.from('transactions').select('id, account_id, date, amount').in('account_id', cards).gte('date', addDays(now, -70)),
  ]);
  // Payment plans on these cards: what isn't billed yet is left out of the amount to pay.
  const plans = await import('./paymentPlans').then((m) => m.loadPlans()).catch(() => []);
  const due = new Map<string, number>();
  for (const a of (accts ?? []) as any[]) {
    const owed = Math.max(0, Number(a.balance ?? 0)); // cards: amount owing is positive in balance
    const mine = plans.filter((p) => p.accountId === a.id);
    // With nothing left on the statement (or no statement dates), it's what's owed now, less the payment
    // plan instalments not billed yet: those come due on later statements, not this payment.
    let amount = Math.max(0, owed - mine.reduce((s, p) => s + planHeld(p, now), 0));
    if (a.statement_day && a.due_day) {
      const c = cardCycle(now, a.statement_day, a.due_day);
      const st = cardStatement(owed, (txns ?? []).filter((x: any) => x.account_id === a.id).map((x: any) => ({ id: x.id, date: x.date, amount: Number(x.amount) })), c.lastClose, c.cycleDays, null, mine);
      if (st.leftToPay > 0) amount = st.leftToPay;
    }
    due.set(a.id, round2(amount));
  }
  return list.map((r) => {
    if (!r.card_account_id || !r.card_rule || r.card_rule === 'custom' || !due.has(r.card_account_id)) return r;
    const full = due.get(r.card_account_id)!;
    const amount = r.card_rule === 'minimum' ? Math.min(full, Math.max(10, round2(full * 0.03))) : full;
    return { ...r, amount: -amount, estimated: true };
  });
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

export interface PlannerData {
  view: WeekView; accounts: Account[]; recurring: Recurring[]; entries: PlanEntry[];
  ahead: { week: string; end: number; warning: WeekView['warnings'][number] | null }[];
  /** The week strip: 8 weeks back (how they really ended), this week and 7 ahead (projected). */
  strip: { week: string; end: number; warning: WeekView['warnings'][number] | null; past: boolean }[];
  /** The real end-of-day balance of the shown accounts, for each day of the week up to today. */
  actual: Record<string, number>;
}

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
  // From 8 weeks back (the strip shows how past weeks really ended) to 8 weeks ahead, or the open week if further.
  const back = addDays(thisWeek, -56), aheadEnd = addDays(thisWeek, 49);
  const from = week < back ? week : back;
  const to = addDays(week > aheadEnd ? week : aheadEnd, 6);
  const [recurring, entries, posted] = await Promise.all([
    loadRecurring(), loadEntries(addDays(from, -31), addDays(to, 31)), loadPosted(ids, addDays(from, -4), addDays(to > now ? to : now, 4)),
  ]);
  // Planned items for a week: bills, income and one-offs.
  const plannedFor = (w: string) => expandPlan(recurring, entries, w, addDays(w, 6));

  const balanceOn = (d: string) => Object.fromEntries(planAccounts.map((a) => [a.id, balanceAt(signedBalance(a), posted.filter((t) => t.accountId === a.id && t.date <= now), d)]));
  const shown = only ? planAccounts.filter((a) => a.id === only) : planAccounts;
  const shownIds = new Set(shown.map((a) => a.id));
  const accountsFor = (bal: Record<string, number>) => planAccounts.map((a) => ({ id: a.id, name: a.name, startBalance: bal[a.id], buffer: Number(a.plan_buffer ?? 0) }));

  // Roll forward from this week: each week starts at the projected end of the one before.
  // Along the way, the 4-week look-ahead (PLN-11): this week and the next 3.
  const starts = new Map<string, Record<string, number>>();
  const ahead: PlannerData['ahead'] = [];
  let roll = balanceOn(thisWeek);
  const strip: PlannerData['strip'] = [];
  const total = (bal: Record<string, number>) => Math.round(shown.reduce((s2, a) => s2 + bal[a.id], 0) * 100) / 100;
  for (let w = back; w < thisWeek; w = addDays(w, 7)) strip.push({ week: w, end: total(balanceOn(addDays(w, 7))), warning: null, past: true });
  const last = week > aheadEnd ? week : aheadEnd;
  for (let w = thisWeek; w <= last; w = addDays(w, 7)) {
    starts.set(w, roll);
    const v = buildWeek({ weekStart: w, today: now, planned: plannedFor(w), actuals: posted, accounts: accountsFor(roll) });
    if (w <= aheadEnd) strip.push({ week: w, end: total(v.endBalanceByAccount), warning: v.warnings.find((x) => shownIds.has(x.accountId)) ?? null, past: false });
    if (ahead.length < 4) {
      ahead.push({ week: w, end: Math.round(shown.reduce((s2, a) => s2 + v.endBalanceByAccount[a.id], 0) * 100) / 100, warning: v.warnings.find((x) => shownIds.has(x.accountId)) ?? null });
    }
    roll = v.endBalanceByAccount;
  }
  // Past weeks start from the real balance back then.
  const start = week < thisWeek ? balanceOn(week) : starts.get(week)!;
  const view = buildWeek({
    weekStart: week, today: now, planned: plannedFor(week), actuals: posted,
    accounts: shown.map((a) => ({ id: a.id, name: a.name, startBalance: start[a.id], buffer: Number(a.plan_buffer ?? 0) })),
  });
  // What the accounts really held at the end of each day so far, to set against the plan's running balance.
  const actual: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i);
    if (d > now) break;
    actual[d] = round2(shown.reduce((s, a) => s + balanceAt(signedBalance(a), posted.filter((t) => t.accountId === a.id && t.date <= now), addDays(d, 1)), 0));
  }
  return { view, accounts: all, recurring, entries, ahead, actual, strip };
}
