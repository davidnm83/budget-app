/**
 * The weekly planner: planned entries (bill and income due dates plus one-offs) against what
 * actually posted, with a running balance per account and a warning when one would drop below
 * its buffer.
 *
 * Balance rule for each entry in the week:
 *   • planned and matched to a transaction → the actual amount counts
 *   • planned, not matched yet → the planned amount counts (flagged "overdue" once its day passed)
 *   • a transaction nobody planned → counts as an unplanned actual
 */
import { addDays, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';
import { matchDues, occurrences, type PostedTxn, type Recurring } from './recurring.ts';

export interface PlanEntry {
  id: string;
  date: IsoDate;
  description: string;
  amount: number;
  account_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  recurring_id: string | null;
  occurrence_date: IsoDate | null;
  skipped: boolean;
  matched_transaction_id: string | null;
  /** Left unmatched on purpose: not matched to a transaction automatically. */
  no_match?: boolean;
  /** Marked by hand as done by the bank: already in the balance, though not listed yet. */
  bank_done?: boolean;
}

export interface PlannedItem {
  key: string;
  date: IsoDate;
  description: string;
  amount: number;
  accountId: string | null;
  categoryId: string | null;
  estimated: boolean;
  matchText: string | null;
  recurringId: string | null;
  occurrenceDate: IsoDate | null;
  entryId: string | null;
  transfer: boolean;
  matchedTxnId: string | null; // set by hand
  /** Left unmatched by hand: automatic matching skips it. */
  noMatch?: boolean;
  /** Marked by hand as done by the bank (in the balance, not listed yet), until its transaction posts and matches. */
  bankDone?: boolean;
}

/** Every planned item between `from` and `to`: due dates of active bills/income (with per-date changes) and one-off entries. */
export function expandPlan(recurring: Recurring[], entries: PlanEntry[], from: IsoDate, to: IsoDate): PlannedItem[] {
  const out: PlannedItem[] = [];
  const overrides = new Map(entries.filter((e) => e.recurring_id && e.occurrence_date).map((e) => [`${e.recurring_id}|${e.occurrence_date}`, e]));
  for (const r of recurring.filter((x) => x.active)) {
    // Look a little past the range so an occurrence moved into it is still found.
    for (const d of occurrences(r, addDays(from, -31), addDays(to, 31))) {
      const o = overrides.get(`${r.id}|${d}`);
      if (o?.skipped) continue;
      const date = o?.date ?? (r.lead_days ? addDays(d, -r.lead_days) : d);
      if (date < from || date > to) continue;
      out.push({
        key: `r:${r.id}:${d}`, date, description: o?.description ?? r.name, amount: o ? Number(o.amount) : r.amount_until && d <= r.amount_until.date ? r.amount_until.amount : r.amount,
        accountId: o?.account_id ?? r.account_id, categoryId: r.category_id, estimated: r.estimated, matchText: r.match_text,
        recurringId: r.id, occurrenceDate: d, entryId: o?.id ?? null, transfer: false, matchedTxnId: o?.matched_transaction_id ?? null, ...(o?.no_match ? { noMatch: true } : {}), ...(o?.bank_done ? { bankDone: true } : {}),
      });
    }
  }
  for (const e of entries.filter((x) => !x.recurring_id && !x.skipped && x.date >= from && x.date <= to)) {
    const base = { date: e.date, description: e.description, categoryId: e.category_id, estimated: false, matchText: null,
      recurringId: null, occurrenceDate: null, entryId: e.id, matchedTxnId: e.matched_transaction_id, ...(e.no_match ? { noMatch: true } : {}), ...(e.bank_done ? { bankDone: true } : {}) };
    out.push({ ...base, key: `e:${e.id}`, amount: Number(e.amount), accountId: e.account_id, transfer: !!e.to_account_id });
    // A planned transfer also shows on the receiving account (PLN-9).
    if (e.to_account_id) out.push({ ...base, key: `e:${e.id}:in`, amount: -Number(e.amount), accountId: e.to_account_id, transfer: true, matchedTxnId: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

export interface WeekRow {
  key: string;
  date: IsoDate;
  kind: 'planned' | 'actual';
  description: string;
  accountId: string | null;
  planned: number | null;
  actual: number | null;
  counted: number;         // what the running balance uses
  overdue: boolean;
  /** Already in the bank's balance but not listed by the bank yet (see `unlisted` in buildWeek): counts as done. */
  unlisted?: boolean;
  /** A planned entry paid by a transaction dated outside the view: the day it was paid (it counts on that day, not here). */
  paidOn?: IsoDate;
  /** A transaction that paid a planned entry dated outside the view (so it isn't unplanned). */
  pays?: { key: string; description: string; date: IsoDate };
  item: PlannedItem | null;
  txn: PostedTxn | null;
  balanceAfter: number;    // running balance of the view (one account or the combined group)
}

export interface WeekDay { date: IsoDate; rows: WeekRow[]; endBalance: number }

export interface WeekWarning { accountId: string; date: IsoDate; balance: number; buffer: number; cause: string }

export interface WeekView {
  days: WeekDay[];
  startBalance: number;
  endBalance: number;
  endBalanceByAccount: Record<string, number>;
  warnings: WeekWarning[];
  /** The planned entries the bank has already counted in its balance without listing them (see `unlisted`). */
  unlistedFound: { key: string; date: IsoDate; amount: number; accountId: string }[];
  summary: { plannedIn: number; plannedOut: number; actualIn: number; actualOut: number; unplannedOut: number; overdue: number };
}

/**
 * Builds one week (7 days from `weekStart`) for the given accounts. With several accounts the
 * running balance is their total (transfers between them cancel out); warnings are still per
 * account against each one's buffer.
 */
export function buildWeek(opts: {
  weekStart: IsoDate;
  /** How many days from `weekStart` (7 = a week; a month's length for the month view). */
  days?: number;
  today: IsoDate;
  accounts: { id: string; startBalance: number; buffer: number; name: string }[];
  planned: PlannedItem[];
  actuals: PostedTxn[];
  /**
   * Per account, money the bank has already counted in its balance but not listed as transactions yet
   * (accounts.balance_gap). When planned entries from the last days add up to exactly that, the bank has done
   * them: they count as done, so today's balance (which already has them) doesn't lose them a second time.
   */
  unlisted?: Record<string, number>;
  /** Which planned entries those are, when already worked out (so every view of the plan agrees). */
  unlistedKeys?: string[];
  /**
   * Every such entry, wherever it falls: a view that ends before one of them (a past week) still starts without it,
   * since the bank's balance it's worked back from already has it.
   */
  unlistedAll?: { date: IsoDate; amount: number; accountId: string }[];
  /**
   * Planned entries from just before and after the view (a week either side is plenty): a transaction that paid one
   * of them isn't unplanned here, and an entry here paid on a day outside the view counts on that day, not here.
   */
  nearby?: PlannedItem[];
}): WeekView {
  const ids = new Set(opts.accounts.map((a) => a.id));
  const span = opts.days ?? 7;
  const end = addDays(opts.weekStart, span - 1);
  const planned = opts.planned.filter((p) => p.accountId && ids.has(p.accountId) && p.date >= opts.weekStart && p.date <= end);
  // Actuals a few days either side can still pay a planned entry; only this week's count as unplanned.
  const actuals = opts.actuals.filter((t) => ids.has(t.accountId));

  const manual = new Map(planned.filter((p) => p.matchedTxnId).map((p) => [p.key, p.matchedTxnId!]));
  const takenNearby = new Set((opts.nearby ?? []).filter((p) => p.matchedTxnId && (p.date < opts.weekStart || p.date > end)).map((p) => p.matchedTxnId!));
  const auto = matchDues(
    planned.filter((p) => !p.matchedTxnId && !p.noMatch).map((p) => ({ key: p.key, date: p.date, amount: p.amount, accountId: p.accountId, matchText: p.matchText, estimated: p.estimated })),
    // (Not ones you've matched to an entry outside the view.)
    actuals.filter((t) => ![...manual.values()].includes(t.id) && !takenNearby.has(t.id)),
    3,
  );
  const match = new Map([...auto, ...manual]);
  // Entries from before this view (yesterday's, when the view starts today) can be part of what the bank counted
  // too; ones already paid by a listed transaction aren't.
  const earlier = opts.planned.filter((p) => p.accountId && ids.has(p.accountId) && p.date < opts.weekStart && p.date >= addDays(opts.today, -10));
  const earlierPaid = earlier.length ? matchDues(earlier.filter((p) => !p.matchedTxnId && !p.noMatch).map((p) => ({ key: p.key, date: p.date, amount: p.amount, accountId: p.accountId, matchText: p.matchText, estimated: p.estimated })), actuals, 3) : new Map();
  const candidates = [...earlier.filter((p) => !p.matchedTxnId && !earlierPaid.has(p.key)), ...planned.filter((p) => !match.has(p.key))];
  // Entries you marked as done by the bank count as done; the rest of the bank's unlisted amount is matched as before.
  const marked = candidates.filter((p) => p.bankDone);
  const rest = Object.fromEntries(Object.entries(opts.unlisted ?? {}).map(([a, g]) => [a, round2(g - marked.filter((p) => p.accountId === a).reduce((x, p) => x + p.amount, 0))]));
  const unlisted = opts.unlistedKeys ? new Set(opts.unlistedKeys) : unlistedPlanned(candidates.filter((p) => !p.bankDone), rest, opts.today);
  for (const p of marked) unlisted.add(p.key);
  const unlistedFound = candidates.filter((p) => unlisted.has(p.key)).map((p) => ({ key: p.key, date: p.date, amount: p.amount, accountId: p.accountId! }));
  const txnById = new Map(actuals.map((t) => [t.id, t]));
  const usedTxn = new Set(match.values());
  // Transactions that paid an entry outside the view (planned Saturday, paid Tuesday of the next week).
  const outside = new Map<string, PlannedItem>();
  for (const p of [...earlier, ...(opts.nearby ?? [])]) {
    if (p.accountId && ids.has(p.accountId) && (p.date < opts.weekStart || p.date > end) && !outside.has(p.key)) outside.set(p.key, p);
  }
  const outsideList = [...outside.values()];
  const paysFor = new Map<string, PlannedItem>();
  for (const p of outsideList) if (p.matchedTxnId && !usedTxn.has(p.matchedTxnId)) paysFor.set(p.matchedTxnId, p);
  const outsideAuto = matchDues(
    outsideList.filter((p) => !p.matchedTxnId && !p.noMatch).map((p) => ({ key: p.key, date: p.date, amount: p.amount, accountId: p.accountId, matchText: p.matchText, estimated: p.estimated })),
    actuals.filter((t) => !usedTxn.has(t.id) && !paysFor.has(t.id)),
    3,
  );
  for (const [k, id] of outsideAuto) paysFor.set(id, outside.get(k)!);
  const inside = (d: IsoDate) => d >= opts.weekStart && d <= end;

  const rows: Omit<WeekRow, 'balanceAfter'>[] = [];
  for (const p of planned) {
    const t = match.has(p.key) ? txnById.get(match.get(p.key)!) ?? null : null;
    const done = !t && unlisted.has(p.key);
    // Paid on a day outside the view: that day's balance has it (the view's start, or a later view), so it counts there.
    const away = t && !inside(t.date) ? t.date : null;
    rows.push({
      key: p.key, date: p.date, kind: 'planned', description: p.description, accountId: p.accountId,
      // Done by the bank: counted on its day like a listed transaction (one dated after today is already in today's balance).
      planned: p.amount, actual: t ? t.amount : null, counted: away ? 0 : t ? t.amount : done && p.date > opts.today ? 0 : p.amount,
      overdue: !t && !done && p.date < opts.today, ...(done ? { unlisted: true } : {}), ...(away ? { paidOn: away } : {}), item: p, txn: t,
    });
  }
  for (const t of actuals.filter((x) => !usedTxn.has(x.id) && inside(x.date))) {
    const p = paysFor.get(t.id);
    rows.push({ key: `t:${t.id}`, date: t.date, kind: 'actual', description: t.merchant || t.name, accountId: t.accountId,
      planned: null, actual: t.amount, counted: t.amount, overdue: false, ...(p ? { pays: { key: p.key, description: p.description, date: p.date } } : {}), item: null, txn: t });
  }
  // Within a day: money in first, so a paycheck landing the same day as a bill doesn't false-alarm.
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.counted - a.counted);

  // A start balance worked back from the bank's balance still has the bank's unlisted entries in it; the ones
  // from this view onward come out of it, to be counted on their own day.
  // (Ones after the view, up to today, come out too: the view never counts them, and they weren't there yet.)
  const inView = (a: string) => (opts.unlistedAll ?? unlistedFound).filter((u) => u.accountId === a && u.date >= opts.weekStart && u.date <= opts.today).reduce((x, u) => x + u.amount, 0);
  const perAccount: Record<string, number> = Object.fromEntries(opts.accounts.map((a) => [a.id, round2(a.startBalance - inView(a.id))]));
  const buffer = Object.fromEntries(opts.accounts.map((a) => [a.id, a.buffer]));
  const warned = new Set<string>();
  const warnings: WeekWarning[] = [];
  let running = round2(opts.accounts.reduce((s, a) => s + perAccount[a.id], 0));
  const startBalance = running;
  const days: WeekDay[] = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(opts.weekStart, i);
    const dayRows: WeekRow[] = [];
    for (const r of rows.filter((x) => x.date === date)) {
      running = round2(running + r.counted);
      if (r.accountId) {
        perAccount[r.accountId] = round2(perAccount[r.accountId] + r.counted);
        // Only today onward: a dip that already happened can't be avoided any more.
        if (date >= opts.today && perAccount[r.accountId] < buffer[r.accountId] && !warned.has(r.accountId) && r.counted < 0) {
          warned.add(r.accountId);
          warnings.push({ accountId: r.accountId, date, balance: perAccount[r.accountId], buffer: buffer[r.accountId], cause: r.description });
        }
      }
      dayRows.push({ ...r, balanceAfter: running });
    }
    days.push({ date, rows: dayRows, endBalance: running });
  }

  const sum = (f: (r: Omit<WeekRow, 'balanceAfter'>) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  return {
    days, startBalance, endBalance: running, endBalanceByAccount: perAccount, warnings, unlistedFound,
    summary: {
      plannedIn: sum((r) => (r.planned ?? 0) > 0 ? r.planned! : 0),
      plannedOut: sum((r) => (r.planned ?? 0) < 0 ? -r.planned! : 0),
      actualIn: sum((r) => !r.paidOn && (r.actual ?? 0) > 0 ? r.actual! : 0),
      actualOut: sum((r) => !r.paidOn && (r.actual ?? 0) < 0 ? -r.actual! : 0),
      unplannedOut: sum((r) => (r.kind === 'actual' && !r.pays && (r.actual ?? 0) < 0 ? -r.actual! : 0)),
      overdue: rows.filter((r) => r.overdue).length,
    },
  };
}

/**
 * The planned entries the bank has already counted: per account, the smallest set of entries due from 10 days
 * back to tomorrow that adds up to the unlisted amount, to the cent. None when nothing adds up exactly.
 */
export function unlistedPlanned(planned: PlannedItem[], unlisted: Record<string, number>, today: IsoDate): Set<string> {
  const out = new Set<string>();
  for (const [accountId, gap] of Object.entries(unlisted)) {
    if (Math.abs(gap) < 0.01) continue;
    const near = planned.filter((p) => p.accountId === accountId && p.date >= addDays(today, -10) && p.date <= addDays(today, 1)).slice(0, 14);
    let best: PlannedItem[] | null = null;
    for (let mask = 1; mask < 1 << near.length; mask++) {
      const pick = near.filter((_, i) => mask & (1 << i));
      if (best && pick.length >= best.length) continue;
      if (Math.abs(pick.reduce((x, p) => x + p.amount, 0) - gap) < 0.005) best = pick;
    }
    for (const p of best ?? []) out.add(p.key);
  }
  return out;
}

/** Balance at the start of `date`: today's balance minus everything that posted on or after it. */
export function balanceAt(current: number, txns: { date: IsoDate; amount: number }[], date: IsoDate): number {
  return round2(current - txns.filter((t) => t.date >= date).reduce((s, t) => s + t.amount, 0));
}

/** End-of-period balances going back from today: one point per `stepDays` (e.g. 7 for weekly). */
export function balanceHistory(current: number, txns: { date: IsoDate; amount: number }[], today: IsoDate, points: number, stepDays: number) {
  const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  const out: { date: IsoDate; balance: number }[] = [];
  let bal = current, i = 0;
  for (let p = 0; p < points; p++) {
    const date = addDays(today, -p * stepDays);
    // undo everything after `date`
    while (i < sorted.length && sorted[i].date > date) { bal -= sorted[i].amount; i++; }
    out.push({ date, balance: round2(bal) });
  }
  return out.reverse();
}
