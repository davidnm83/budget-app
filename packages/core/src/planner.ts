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
      const date = o?.date ?? d;
      if (date < from || date > to) continue;
      out.push({
        key: `r:${r.id}:${d}`, date, description: o?.description ?? r.name, amount: o ? Number(o.amount) : r.amount,
        accountId: o?.account_id ?? r.account_id, categoryId: r.category_id, estimated: r.estimated, matchText: r.match_text,
        recurringId: r.id, occurrenceDate: d, entryId: o?.id ?? null, transfer: false, matchedTxnId: o?.matched_transaction_id ?? null,
      });
    }
  }
  for (const e of entries.filter((x) => !x.recurring_id && !x.skipped && x.date >= from && x.date <= to)) {
    const base = { date: e.date, description: e.description, categoryId: e.category_id, estimated: false, matchText: null,
      recurringId: null, occurrenceDate: null, entryId: e.id, matchedTxnId: e.matched_transaction_id };
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
  summary: { plannedIn: number; plannedOut: number; actualIn: number; actualOut: number; unplannedOut: number; overdue: number };
}

/**
 * Builds one week (7 days from `weekStart`) for the given accounts. With several accounts the
 * running balance is their total (transfers between them cancel out); warnings are still per
 * account against each one's buffer.
 */
export function buildWeek(opts: {
  weekStart: IsoDate;
  today: IsoDate;
  accounts: { id: string; startBalance: number; buffer: number; name: string }[];
  planned: PlannedItem[];
  actuals: PostedTxn[];
}): WeekView {
  const ids = new Set(opts.accounts.map((a) => a.id));
  const end = addDays(opts.weekStart, 6);
  const planned = opts.planned.filter((p) => p.accountId && ids.has(p.accountId) && p.date >= opts.weekStart && p.date <= end);
  // Actuals a few days either side can still pay a planned entry; only this week's count as unplanned.
  const actuals = opts.actuals.filter((t) => ids.has(t.accountId));

  const manual = new Map(planned.filter((p) => p.matchedTxnId).map((p) => [p.key, p.matchedTxnId!]));
  const auto = matchDues(
    planned.filter((p) => !p.matchedTxnId).map((p) => ({ key: p.key, date: p.date, amount: p.amount, accountId: p.accountId, matchText: p.matchText, estimated: p.estimated })),
    actuals.filter((t) => ![...manual.values()].includes(t.id)),
    3,
  );
  const match = new Map([...auto, ...manual]);
  const txnById = new Map(actuals.map((t) => [t.id, t]));
  const usedTxn = new Set(match.values());

  const rows: Omit<WeekRow, 'balanceAfter'>[] = [];
  for (const p of planned) {
    const t = match.has(p.key) ? txnById.get(match.get(p.key)!) ?? null : null;
    rows.push({
      key: p.key, date: p.date, kind: 'planned', description: p.description, accountId: p.accountId,
      planned: p.amount, actual: t ? t.amount : null, counted: t ? t.amount : p.amount,
      overdue: !t && p.date < opts.today, item: p, txn: t,
    });
  }
  for (const t of actuals.filter((x) => !usedTxn.has(x.id) && x.date >= opts.weekStart && x.date <= end)) {
    rows.push({ key: `t:${t.id}`, date: t.date, kind: 'actual', description: t.merchant || t.name, accountId: t.accountId,
      planned: null, actual: t.amount, counted: t.amount, overdue: false, item: null, txn: t });
  }
  // Within a day: money in first, so a paycheque landing the same day as a bill doesn't false-alarm.
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.counted - a.counted);

  const perAccount: Record<string, number> = Object.fromEntries(opts.accounts.map((a) => [a.id, a.startBalance]));
  const buffer = Object.fromEntries(opts.accounts.map((a) => [a.id, a.buffer]));
  const warned = new Set<string>();
  const warnings: WeekWarning[] = [];
  let running = round2(opts.accounts.reduce((s, a) => s + a.startBalance, 0));
  const startBalance = running;
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
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
    days, startBalance, endBalance: running, endBalanceByAccount: perAccount, warnings,
    summary: {
      plannedIn: sum((r) => (r.planned ?? 0) > 0 ? r.planned! : 0),
      plannedOut: sum((r) => (r.planned ?? 0) < 0 ? -r.planned! : 0),
      actualIn: sum((r) => (r.actual ?? 0) > 0 ? r.actual! : 0),
      actualOut: sum((r) => (r.actual ?? 0) < 0 ? -r.actual! : 0),
      unplannedOut: sum((r) => (r.kind === 'actual' && (r.actual ?? 0) < 0 ? -r.actual! : 0)),
      overdue: rows.filter((r) => r.overdue).length,
    },
  };
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
