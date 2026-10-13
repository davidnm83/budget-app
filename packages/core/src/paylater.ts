/**
 * Pay later (buy now, pay later: Affirm, Klarna, PayPal Pay in 4…): a purchase paid in fixed instalments from a bank
 * account or card. Each payment is spending in what was bought, counted as it's paid; what's still owed is a debt.
 */
import type { IsoDate } from './dates.ts';
import { round2 } from './money.ts';
import { matchDues, occurrences, type PostedTxn } from './recurring.ts';

export interface PayLater {
  id: string; provider: string; description: string;
  total: number; downPayment: number; payments: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  firstDate: IsoDate; apr: number;
  accountId: string | null; matchText: string | null;
  paidByHand: number[]; closedOn: IsoDate | null;
}
export interface PayLaterPayment { n: number; date: IsoDate; amount: number; principal: number; interest: number }

const PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12 } as const;

/** What's financed: the price less the down payment. */
export const payLaterPrincipal = (p: Pick<PayLater, 'total' | 'downPayment'>) => round2(Math.max(0, p.total - p.downPayment));

/**
 * The payments, on the same dates a bill with this schedule has (so the planner's bill lines up). Without interest the
 * price is split evenly, the odd cents on the first payment; with interest, equal payments that pay it off, the last
 * one evening out the rounding.
 */
export function payLaterSchedule(p: Pick<PayLater, 'total' | 'downPayment' | 'payments' | 'frequency' | 'firstDate' | 'apr'>): PayLaterPayment[] {
  const n = Math.max(1, Math.round(p.payments));
  const far = new Date(Date.parse(p.firstDate + 'T00:00:00Z') + (n + 2) * 32 * 86_400_000).toISOString().slice(0, 10);
  const dates = occurrences({ frequency: p.frequency, start_date: p.firstDate, end_date: null }, p.firstDate, far).slice(0, n);
  const principal = payLaterPrincipal(p);
  const out: PayLaterPayment[] = [];
  if (!(p.apr > 0)) {
    const base = Math.floor((principal / n) * 100) / 100;
    const first = round2(principal - base * (n - 1));
    dates.forEach((date, i) => { const a = i === 0 ? first : base; out.push({ n: i + 1, date, amount: a, principal: a, interest: 0 }); });
    return out;
  }
  const r = p.apr / 100 / PER_YEAR[p.frequency];
  const pay = round2((principal * r) / (1 - Math.pow(1 + r, -n)));
  let bal = principal;
  dates.forEach((date, i) => {
    const interest = round2(bal * r);
    const part = i === n - 1 ? bal : round2(Math.min(bal, pay - interest));
    bal = round2(bal - part);
    out.push({ n: i + 1, date, amount: round2(part + interest), principal: part, interest });
  });
  return out;
}

/** The amount most payments are (the bill's amount); the odd first or last one differs. */
export const payLaterRegular = (s: PayLaterPayment[]) => (s.length > 1 ? s[1].amount : s[0]?.amount ?? 0);

export interface PayLaterStatus {
  schedule: (PayLaterPayment & { txnId: string | null; paid: boolean; missed: boolean })[];
  paidCount: number; paidAmount: number; interestPaid: number;
  /** What's still owed on the purchase (interest still to come not included); 0 once closed. */
  owing: number;
  /** What was left unpaid of the price, closed or not (a plan closed early: what closing it cleared). */
  unpaid: number;
  next: (PayLaterPayment & { txnId: string | null; paid: boolean; missed: boolean }) | null;
  done: boolean;
}

/**
 * Which payments have been made: matched to a payment from the account (amount, a few days either way, and the
 * bank's description when the plan has one), or marked paid by hand. A payment more than 4 days late with nothing
 * matched is missed. `taken` are transactions already paying something else.
 */
export function payLaterStatus(p: PayLater, txns: PostedTxn[], today: IsoDate, taken: Set<string> = new Set()): PayLaterStatus {
  const s = payLaterSchedule(p);
  const free = txns.filter((t) => !taken.has(t.id) && t.amount < 0 && (!p.accountId || t.accountId === p.accountId));
  const matched = matchDues(s.filter((x) => !p.paidByHand.includes(x.n)).map((x) => ({ key: String(x.n), date: x.date, amount: -x.amount, accountId: p.accountId, matchText: p.matchText, estimated: false })), free, 4);
  const schedule = s.map((x) => {
    const txnId = matched.get(String(x.n)) ?? null;
    const paid = !!txnId || p.paidByHand.includes(x.n);
    return { ...x, txnId, paid, missed: !paid && !p.closedOn && daysAfter(x.date, today) > 4 };
  });
  const paid = schedule.filter((x) => x.paid);
  const unpaid = Math.max(0, round2(payLaterPrincipal(p) - paid.reduce((t, x) => t + x.principal, 0)));
  const owing = p.closedOn ? 0 : unpaid;
  const next = p.closedOn ? null : schedule.find((x) => !x.paid) ?? null;
  return {
    schedule, paidCount: paid.length, paidAmount: round2(paid.reduce((t, x) => t + x.amount, 0)), interestPaid: round2(paid.reduce((t, x) => t + x.interest, 0)),
    owing, unpaid, next, done: !!p.closedOn || paid.length === schedule.length,
  };
}

function daysAfter(a: IsoDate, b: IsoDate): number { return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000); }
