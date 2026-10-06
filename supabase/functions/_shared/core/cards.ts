// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Credit cards: the statement cycle from its closing and due days, how much of the last
 * statement is still to pay, an interest estimate if it isn't paid in full, and utilisation.
 */
import { daysBetween, parseIso, toIso, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';
import { planHeld, type PlanOnCard } from './plans.ts';

function onDay(y: number, m: number, day: number): IsoDate {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

/** Last and next statement closing dates around `today`, and the payment due date for the last statement. */
export function cardCycle(today: IsoDate, statementDay: number, dueDay: number) {
  const t = parseIso(today);
  let y = t.getUTCFullYear(), m = t.getUTCMonth();
  let lastClose = onDay(y, m, statementDay);
  if (lastClose > today) { m -= 1; if (m < 0) { m = 11; y -= 1; } lastClose = onDay(y, m, statementDay); }
  const lc = parseIso(lastClose);
  const nextClose = onDay(lc.getUTCFullYear(), lc.getUTCMonth() + 1, statementDay);
  // The due day comes after the close: same month if the day is later, otherwise next month.
  let due = onDay(lc.getUTCFullYear(), lc.getUTCMonth(), dueDay);
  if (due <= lastClose) due = onDay(lc.getUTCFullYear(), lc.getUTCMonth() + 1, dueDay);
  return { lastClose, nextClose, due, cycleDays: daysBetween(lastClose, nextClose), daysToDue: daysBetween(today, due) };
}

/** Interest on a balance for some days at an annual rate in percent (simple daily interest). */
export function cardInterest(owed: number, aprPercent: number, days: number): number {
  return round2(Math.max(0, owed) * (aprPercent / 100 / 365) * days);
}

export function utilization(owed: number, limit: number | null | undefined): number | null {
  return limit && limit > 0 ? Math.max(0, owed) / limit : null;
}

export interface CardStatus {
  statementOwed: number;   // what you owed when the last statement closed
  paidSince: number;       // payments since then
  leftToPay: number;       // to pay in full by the due date
  spentThisCycle: number;  // charges since the statement closed
  interestIfUnpaid: number | null; // one cycle of interest on what's left, if APR is known
}

/** `owedNow` positive; txns in app sign (charges negative, payments positive). */
/** `deferred`: the part of the balance on payment plans that wasn't billed yet when the statement closed (see plansDeferred); a statement doesn't ask for it. */
export function cardStatus(owedNow: number, txns: { date: IsoDate; amount: number }[], lastClose: IsoDate, cycleDays: number, apr: number | null, deferred = 0): CardStatus {
  const after = txns.filter((t) => t.date > lastClose);
  const paidSince = round2(after.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const spentThisCycle = round2(-after.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const statementOwed = round2(Math.max(0, owedNow + paidSince - spentThisCycle - Math.max(0, deferred)));
  const leftToPay = round2(Math.max(0, statementOwed - paidSince));
  return { statementOwed, paidSince, leftToPay, spentThisCycle, interestIfUnpaid: apr ? cardInterest(leftToPay + spentThisCycle / 2, apr, cycleDays) : null };
}

/**
 * The card's statement with payment plans in it (option B). The balance when the statement closed
 * is worked back from today's; the part of it that was a plan not yet billed is left out, since a
 * statement doesn't ask for that. The purchase and the bank's plan credit are plan movements: they
 * count as neither spending nor payments, so a $1,800 plan credit no longer looks like a payment.
 */
export function cardStatement(owedNow: number, txns: { id?: string; date: IsoDate; amount: number }[], lastClose: IsoDate, cycleDays: number, apr: number | null, plans: PlanOnCard[] = []): CardStatus {
  const moves = new Set(plans.flatMap((p) => [p.purchaseTxnId, p.creditTxnId]).filter(Boolean) as string[]);
  const after = txns.filter((t) => t.date > lastClose);
  const atClose = owedNow + after.reduce((s, t) => s + t.amount, 0);
  const statementOwed = round2(Math.max(0, atClose - plans.reduce((s, p) => s + planHeld(p, lastClose), 0)));
  const real = after.filter((t) => !(t.id && moves.has(t.id)));
  const paidSince = round2(real.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const spentThisCycle = round2(-real.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const leftToPay = round2(Math.max(0, statementOwed - paidSince));
  return { statementOwed, paidSince, leftToPay, spentThisCycle, interestIfUnpaid: apr ? cardInterest(leftToPay + spentThisCycle / 2, apr, cycleDays) : null };
}

/** Money in and out per month for the last `months` months (oldest first). */
export function monthlyFlow(txns: { date: IsoDate; amount: number }[], today: IsoDate, months: number) {
  const out: { month: IsoDate; in: number; out: number }[] = [];
  const t = parseIso(today);
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - k, 1));
    const month = toIso(d);
    const end = toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    const rows = txns.filter((x) => x.date >= month && x.date <= end);
    out.push({ month, in: round2(rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0)), out: round2(-rows.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0)) });
  }
  return out;
}


// ───────────── balance transfers ─────────────

/** Money moved from one card to another, usually at a low promo rate until `promoEnd`, for a fee. */
export interface BalanceTransfer {
  id: string;
  fromAccountId: string;   // the card paid off
  toAccountId: string;     // the card now carrying it
  amount: number;          // positive
  fee: number;             // positive, charged on the new card
  date: IsoDate;
  promoApr: number | null; // yearly %, while the promo lasts
  promoEnd: IsoDate | null;
  outTxnId?: string | null; inTxnId?: string | null; feeTxnId?: string | null;
}

export interface TransferProgress {
  /** Still on the new card from it: what that card owes, up to the amount moved and its fee. */
  remaining: number;
  daysLeft: number | null;
  monthsLeft: number | null;
  /** A month, to clear it before the promo rate ends. */
  perMonth: number | null;
  ended: boolean;
}

export function transferProgress(t: BalanceTransfer, owedOnTo: number, today: IsoDate): TransferProgress {
  const remaining = round2(Math.max(0, Math.min(owedOnTo, t.amount + t.fee)));
  if (!t.promoEnd) return { remaining, daysLeft: null, monthsLeft: null, perMonth: null, ended: false };
  const daysLeft = daysBetween(today, t.promoEnd);
  const monthsLeft = daysLeft <= 0 ? 0 : Math.max(1, Math.ceil(daysLeft / 30.44));
  return { remaining, daysLeft, monthsLeft, perMonth: monthsLeft ? round2(remaining / monthsLeft) : null, ended: daysLeft < 0 };
}

/**
 * The transactions of a balance transfer, among both cards' rows: the credit on the old card and the
 * charge on the new one for the amount (within 5 days of its date), and the fee on the new card
 * (within a month). Each null when not found yet.
 */
export function findTransferTxns<T extends { id: string; account_id: string; date: IsoDate; amount: number }>(t: BalanceTransfer, txns: T[], taken: Set<string> = new Set()) {
  const near = (r: T, days: number) => Math.abs(daysBetween(t.date, r.date)) <= days && !taken.has(r.id);
  const same = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const out = txns.find((r) => r.account_id === t.fromAccountId && same(r.amount, t.amount) && near(r, 5)) ?? null;
  const into = txns.find((r) => r.account_id === t.toAccountId && same(r.amount, -t.amount) && near(r, 5)) ?? null;
  const fee = t.fee > 0 ? txns.find((r) => r.account_id === t.toAccountId && same(r.amount, -t.fee) && near(r, 35) && r.id !== into?.id) ?? null : null;
  return { out, into, fee };
}
