// Data for Bills and the Planner: recurring bills/income, one-off planned entries, the
// accounts the plan covers, and posted transactions to match against.
import {
  addDays, addMonths, balanceAt, buildWeek, monthEnd, monthOf, cardCycle, cardStatement, minimumPayment, planHeld, planUnbilled, transfersOnStatement, expandPlan, round2, todayIn, weekStart as mondayOf,
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
 *   minimum   — the card's own minimum rule (Credit cards → the card → Check against a statement), else 3%, at least $10
 *   custom    — the amount you entered
 */
async function resolveCardBills(list: (Recurring & { card_account_id?: string | null; card_rule?: string | null })[]): Promise<Recurring[]> {
  const cards = [...new Set(list.filter((r) => r.card_account_id && r.card_rule && r.card_rule !== 'custom').map((r) => r.card_account_id!))];
  if (!cards.length) return list;
  const now = today();
  const [{ data: accts }, { data: txns }] = await Promise.all([
    supabase.from('account_balances').select('id, type, balance, statement_day, due_day').in('id', cards),
    supabase.from('transactions').select('id, account_id, date, amount, name, import_id').in('account_id', cards).gte('date', addDays(now, -70)).eq('pending', false),
  ]);
  const minimums = await import('./cardMinimums').then((m) => m.loadMinimums()).catch(() => new Map());
  const ruleOf = (id: string) => minimums.get(id)?.rule ?? undefined;
  // Payment plans on these cards: what isn't billed yet is left out of the amount to pay.
  const plans = await import('./paymentPlans').then((m) => m.loadPlans()).catch(() => []);
  const transfers = await import('./balanceTransfers').then((m) => m.loadTransfers()).catch(() => []);
  const due = new Map<string, number>();
  const mins = new Map<string, number>(); // the statement's minimum still to pay, interest and fees included where the card's rule adds them
  for (const a of (accts ?? []) as any[]) {
    const owed = Math.max(0, Number(a.balance ?? 0)); // cards: amount owing is positive in balance
    const mine = plans.filter((p) => p.accountId === a.id);
    // With nothing left on the statement (or no statement dates), it's what's owed now, less the payment
    // plan instalments not billed yet: those come due on later statements, not this payment.
    // Promo balance transfers on the card are paid off on their own schedule, like plans.
    const bts = transfers.filter((x) => x.toAccountId === a.id && !x.closedOn);
    let amount = Math.max(0, owed - mine.reduce((s, p) => s + planHeld(p, now), 0) - transfersOnStatement(bts, owed, now, now).held);
    if (a.statement_day && a.due_day) {
      const c = cardCycle(now, a.statement_day, a.due_day, !!minimums.get(a.id)?.mondays);
      const st = cardStatement(owed, (txns ?? []).filter((x: any) => x.account_id === a.id).map((x: any) => ({ id: x.id, date: x.date, amount: Number(x.amount), name: x.name, importId: x.import_id })), c.lastClose, c.cycleDays, null, mine,
        transfersOnStatement(bts, owed, c.lastClose, now), ruleOf(a.id), c.prevClose);
      // A statement that's all on a balance transfer still asks for its minimum.
      if (st.leftToPay > 0 || st.minimumLeft) amount = Math.max(st.leftToPay, st.minimumLeft ?? 0);
      if (st.leftToPay > 0 || st.minimumLeft) mins.set(a.id, st.minimumLeft ?? 0);
    }
    due.set(a.id, round2(amount));
  }
  return list.map((r) => {
    if (!r.card_account_id || !r.card_rule || r.card_rule === 'custom' || !due.has(r.card_account_id)) return r;
    const full = due.get(r.card_account_id)!;
    const amount = r.card_rule === 'minimum' ? mins.get(r.card_account_id) ?? minimumPayment(full, minimums.get(r.card_account_id)?.rule ?? undefined) : full;
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
    .in('account_id', accountIds).gte('date', from).lte('date', to).eq('pending', false).order('id').range(a, b));
  return rows.map((r) => ({ id: r.id, date: r.date, amount: Number(r.amount), accountId: r.account_id, name: r.name, merchant: r.display_name }));
}

export async function loadAccounts(): Promise<Account[]> {
  const { data, error } = await supabase.from('account_balances').select('*').eq('is_hidden', false).order('name');
  if (error) throw new Error(error.message);
  return withOffBalance((data ?? []).map((a: any) => ({ ...a, current_balance: a.balance, balance_updated_at: a.balance_as_of, plan_buffer: Number(a.plan_buffer ?? 0) })));
}

/**
 * Cards: add what's still owed on payment plans the bank has moved off the balance, so every "owed"
 * (card lists, utilisation, net worth, charts) is the whole debt. Statements use the bank's balance.
 */
export async function withOffBalance(list: Account[]): Promise<Account[]> {
  if (!list.some((a) => a.type === 'credit')) return list;
  const plans = await import('./paymentPlans').then((m) => m.loadPlans()).catch(() => []);
  const now = today();
  return list.map((a) => {
    if (a.type !== 'credit') return a;
    const off = plans.filter((p) => p.accountId === a.id && p.creditDate);
    return off.length ? { ...a, off_plans: off, off_balance: off.reduce((s, p) => s + (p.creditDate! <= now ? planUnbilled(p, now) : 0), 0) } : a;
  });
}

/** Per account, what the bank has counted in its balance but not listed yet (the sync's balance_gap). */
export const unlistedOf = (accounts: Account[]): Record<string, number> =>
  Object.fromEntries(accounts.map((a) => [a.id, Number((a as any).balance_gap ?? 0)] as const).filter(([, g]) => Math.abs(g) >= 0.01));

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
  const plannedFor = (w: string, from = w) => expandPlan(recurring, entries, from, addDays(w, 6));

  const balanceOn = (d: string) => Object.fromEntries(planAccounts.map((a) => [a.id, balanceAt(signedBalance(a), posted.filter((t) => t.accountId === a.id && t.date <= now), d)]));
  const shown = only ? planAccounts.filter((a) => a.id === only) : planAccounts;
  const shownIds = new Set(shown.map((a) => a.id));
  const unlisted = unlistedOf(planAccounts);
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
    const v = buildWeek({ weekStart: w, today: now, planned: plannedFor(w, w === thisWeek ? addDays(now, -10) : w), actuals: posted, accounts: accountsFor(roll), unlisted });
    if (w <= aheadEnd) strip.push({ week: w, end: total(v.endBalanceByAccount), warning: v.warnings.find((x) => shownIds.has(x.accountId)) ?? null, past: false });
    if (ahead.length < 4) {
      ahead.push({ week: w, end: Math.round(shown.reduce((s2, a) => s2 + v.endBalanceByAccount[a.id], 0) * 100) / 100, warning: v.warnings.find((x) => shownIds.has(x.accountId)) ?? null });
    }
    roll = v.endBalanceByAccount;
  }
  // Past weeks start from the real balance back then.
  const start = week < thisWeek ? balanceOn(week) : starts.get(week)!;
  const view = buildWeek({
    weekStart: week, today: now, planned: plannedFor(week, week === thisWeek ? addDays(now, -10) : week), actuals: posted, unlisted,
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

export interface MonthData {
  month: string; view: WeekView; accounts: Account[];
  /** The real end-of-day balance of the shown accounts, for each day of the month up to today. */
  actual: Record<string, number>;
  /** Each month's planned bills and income added up, 6 months back to 12 ahead (the month strip). */
  strip: { month: string; net: number }[];
}
const monthCache = new Map<string, MonthData>();
/** The last month loaded for these settings, to show at once while it loads again. */
export const cachedMonth = (month: string, only: string | null) => monthCache.get(`${month}|${only ?? ''}`) ?? null;

/**
 * One month of the plan, day by day, the same way as a week: bills, income and one-offs matched to what
 * posted, with the running balance. A past or the current month starts from the real balance on its first
 * day; a later one from the projected balance carried forward from the start of this month.
 */
export async function loadMonth(month: string, only: string | null): Promise<MonthData> {
  const now = today();
  const cur = monthOf(now);
  const all = await loadAccounts();
  const planAccounts = all.filter((a) => a.plan_include);
  const ids = planAccounts.map((a) => a.id);
  const first = month < cur ? month : cur, end = monthEnd(month);
  const stripFrom = addMonths(cur, -6), stripTo = monthEnd(addMonths(cur, 12));
  const [recurring, entries, posted] = await Promise.all([
    loadRecurring(), loadEntries(addDays(first < stripFrom ? first : stripFrom, -31), addDays(end > stripTo ? end : stripTo, 31)),
    ids.length ? loadPosted(ids, addDays(first, -4), addDays(end > now ? end : now, 4)) : Promise.resolve([] as PostedTxn[]),
  ]);
  const shown = only ? planAccounts.filter((a) => a.id === only) : planAccounts;
  const unlisted = unlistedOf(planAccounts);
  // This month's plan reaches back 10 days for entries the bank may have done without listing them yet.
  const back10 = addDays(now, -10);
  const balanceOn = (d: string) => Object.fromEntries(planAccounts.map((a) => [a.id, balanceAt(signedBalance(a), posted.filter((t) => t.accountId === a.id && t.date <= now), d)]));
  const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  let start = balanceOn(month <= cur ? month : cur);
  if (month > cur) {
    // Carry the plan forward from the start of this month to the day before this one.
    const run = buildWeek({ weekStart: cur, days: days(cur, addDays(month, -1)), today: now, planned: expandPlan(recurring, entries, back10 < cur ? back10 : cur, addDays(month, -1)), actuals: posted, unlisted,
      accounts: planAccounts.map((a) => ({ id: a.id, name: a.name, startBalance: start[a.id], buffer: Number(a.plan_buffer ?? 0) })) });
    start = run.endBalanceByAccount;
  }
  const view = buildWeek({ weekStart: month, days: days(month, end), today: now, planned: expandPlan(recurring, entries, month === cur && back10 < month ? back10 : month, end), actuals: posted, unlisted,
    accounts: shown.map((a) => ({ id: a.id, name: a.name, startBalance: start[a.id], buffer: Number(a.plan_buffer ?? 0) })) });
  const actual: Record<string, number> = {};
  for (let d = month; d <= end && d <= now; d = addDays(d, 1)) {
    actual[d] = round2(shown.reduce((s, a) => s + balanceAt(signedBalance(a), posted.filter((t) => t.accountId === a.id && t.date <= now), addDays(d, 1)), 0));
  }
  const strip: MonthData['strip'] = [];
  for (let m = stripFrom; m <= addMonths(cur, 12); m = addMonths(m, 1)) {
    strip.push({ month: m, net: round2(expandPlan(recurring, entries, m, monthEnd(m)).filter((p) => !p.transfer).reduce((x, p) => x + p.amount, 0)) });
  }
  const out = { month, view, accounts: all, actual, strip };
  monthCache.set(`${month}|${only ?? ''}`, out);
  return out;
}

/** Saved daily balances (IDEA-2) for these accounts from a date, by account, oldest first. None before the migration. */
export async function loadSnapshots(accountIds: string[], from: string): Promise<Map<string, { date: string; balance: number }[]>> {
  const out = new Map<string, { date: string; balance: number }[]>();
  if (!accountIds.length) return out;
  const { data, error } = await supabase.from('balance_snapshots').select('account_id, date, balance').in('account_id', accountIds).gte('date', from).order('date').limit(5000);
  if (error) return out;
  for (const r of (data ?? []) as any[]) (out.get(r.account_id) ?? out.set(r.account_id, []).get(r.account_id)!).push({ date: r.date, balance: Number(r.balance) });
  return out;
}
