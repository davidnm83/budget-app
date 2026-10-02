// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Loan interest from balance changes, as the Plaid Sync script does:
 *   interest = new balance − last balance + payments since the last balance
 * Logged only once the balance has dropped after a payment, and only when the
 * result is plausible; otherwise the caller waits for the bank to catch up.
 */
import { daysBetween, parseIso, toIso, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';

export const MAX_INTEREST_SHARE = 0.35;

export type InterestResult =
  | { status: 'interest'; interest: number }
  | { status: 'waiting-payment' | 'waiting-balance' | 'not-caught-up' | 'mismatch'; interest?: number };

export function computeLoanInterest(lastBalance: number, newBalance: number, paymentsSince: number): InterestResult {
  const interest = round2(newBalance - lastBalance + paymentsSince);
  if (paymentsSince <= 0) return { status: 'waiting-payment' };
  if (newBalance >= lastBalance - 0.005) return { status: 'waiting-balance' };
  if (interest < 0) return { status: 'mismatch', interest };
  if (interest > MAX_INTEREST_SHARE * paymentsSince) return { status: 'not-caught-up', interest };
  return { status: 'interest', interest };
}

// ───────────────────────── payoff estimate (LOAN-2, LOAN-3) ─────────────────────────

/** On a loan account: payments are money in (they lower the debt); interest rows say "interest". */
export const isInterestRow = (name: string) => /interest/i.test(name);

export interface LoanSummary {
  owed: number;
  paymentsToDate: number;
  interestToDate: number;
  since: IsoDate | null;
  perMonth: { payment: number; interest: number; principal: number } | null;
  monthsLeft: number | null;
  payoffDate: IsoDate | null;
  interestLeft: number | null;
  status: 'ok' | 'paid-off' | 'not-enough-history' | 'payments-dont-cover';
}

/**
 * Payoff estimate from the last 2 months: average monthly payment and interest, then the
 * standard amortisation formula for months left, n = −ln(1 − rB/P) / ln(1 + r), where B is what
 * you owe, P the monthly payment and r the monthly interest rate (interest ÷ balance).
 */
export function loanSummary(owed: number, txns: { date: IsoDate; amount: number; name: string }[], today: IsoDate): LoanSummary {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  const payments = sorted.filter((t) => t.amount > 0);
  const interest = sorted.filter((t) => t.amount < 0 && isInterestRow(t.name));
  const base: LoanSummary = {
    owed: round2(owed),
    paymentsToDate: round2(payments.reduce((s, t) => s + t.amount, 0)),
    interestToDate: round2(-interest.reduce((s, t) => s + t.amount, 0)),
    since: sorted[0]?.date ?? null,
    perMonth: null, monthsLeft: null, payoffDate: null, interestLeft: null, status: 'not-enough-history',
  };
  if (owed <= 0.005) return { ...base, status: 'paid-off', monthsLeft: 0 };
  // The last 2 calendar months: after the same day 2 months ago.
  const f = parseIso(today); f.setUTCMonth(f.getUTCMonth() - 2);
  const from = toIso(f);
  if (!base.since || daysBetween(base.since, today) < 56) return base;
  const p = payments.filter((t) => t.date > from).reduce((s, t) => s + t.amount, 0) / 2;
  const i = -interest.filter((t) => t.date > from).reduce((s, t) => s + t.amount, 0) / 2;
  if (p <= 0) return base;
  const perMonth = { payment: round2(p), interest: round2(i), principal: round2(p - i) };
  const r = i / owed;
  if (p <= r * owed + 0.005) return { ...base, perMonth, status: 'payments-dont-cover' };
  const n = r > 0 ? -Math.log(1 - (r * owed) / p) / Math.log(1 + r) : owed / p;
  const d = parseIso(today);
  d.setUTCMonth(d.getUTCMonth() + Math.ceil(n));
  return { ...base, perMonth, status: 'ok', monthsLeft: Math.ceil(n), payoffDate: toIso(d), interestLeft: round2(p * n - owed) };
}

// ───────────────────────── payoff projection and what-if (LOAN-4, LOAN-5) ─────────────────────────

export interface Payoff { monthsLeft: number; payoffDate: IsoDate; interestLeft: number }

/**
 * Months to pay off `owed` at `payment` a month, with interest at `rate` a month (interest ÷
 * balance). Null when the payment doesn't cover the interest.
 */
export function payoffAt(owed: number, payment: number, rate: number, today: IsoDate): Payoff | null {
  if (owed <= 0.005) return { monthsLeft: 0, payoffDate: today, interestLeft: 0 };
  if (payment <= rate * owed + 0.005) return null;
  const n = rate > 0 ? -Math.log(1 - (rate * owed) / payment) / Math.log(1 + rate) : owed / payment;
  const d = parseIso(today);
  d.setUTCMonth(d.getUTCMonth() + Math.ceil(n));
  return { monthsLeft: Math.ceil(n), payoffDate: toIso(d), interestLeft: round2(Math.max(0, payment * n - owed)) };
}

/** What's owed at the end of each month from now until it reaches 0 (first entry is today). */
export function payoffSchedule(owed: number, payment: number, rate: number, maxMonths = 480): number[] {
  const out = [round2(owed)];
  let b = owed;
  for (let i = 0; i < maxMonths && b > 0.005; i++) {
    b = Math.max(0, b * (1 + rate) - payment);
    if (b >= out[out.length - 1] && rate > 0) break; // not going down: stop rather than loop
    out.push(round2(b));
  }
  return out;
}

export interface WhatIf extends Payoff { monthsSaved: number; interestSaved: number }

/** The payoff with `extra` added to every monthly payment, against the current pace. */
export function loanWhatIf(s: LoanSummary, extra: number, today: IsoDate): WhatIf | null {
  if (s.status !== 'ok' || !s.perMonth || !(extra > 0)) return null;
  const rate = s.perMonth.interest / s.owed;
  const p = payoffAt(s.owed, s.perMonth.payment + extra, rate, today);
  if (!p) return null;
  return { ...p, monthsSaved: Math.max(0, (s.monthsLeft ?? 0) - p.monthsLeft), interestSaved: round2(Math.max(0, (s.interestLeft ?? 0) - p.interestLeft)) };
}
