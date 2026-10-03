// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Card payment plans: a purchase on a credit card paid off in monthly instalments, with an
 * optional one-time fee and interest on the plan.
 *
 * The bank doesn't list each instalment as a transaction, so the schedule is worked out here:
 * equal monthly payments (the usual loan formula when there is interest), each made of a part
 * that pays down the purchase and a part that is interest.
 */
import { parseIso, toIso, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';

export interface PaymentPlan {
  id: string;
  description: string;
  principal: number;        // the purchase amount put on the plan (positive)
  months: number;
  startDate: IsoDate;       // date of the first instalment
  setupFee: number;         // one-time fee, charged with the first instalment
  apr: number;              // yearly interest on the plan, in percent (0 = none)
  monthlyFee?: number;      // a fixed fee charged with every instalment (some cards charge this instead of interest)
  countFrom?: IsoDate | null; // instalments before this are tracked but not added to the budget
  closedOn?: IsoDate | null;  // paid off early on this date
}

export interface Instalment {
  n: number;                // 1-based
  date: IsoDate;
  principal: number;        // the part that pays down the purchase
  interest: number;
  fee: number;              // the one-time fee, on the first instalment
  monthlyFee: number;       // the fixed fee charged every month
  total: number;            // what this instalment adds to the card's bill
  balanceAfter: number;     // of the purchase still on the plan
}

/** The same day each month, falling back to the month's last day (the 31st → the 30th or 28th). */
export function monthsAfter(start: IsoDate, k: number): IsoDate {
  const s = parseIso(start);
  const last = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, Math.min(s.getUTCDate(), last))));
}

/** Every instalment of a plan. Paid off early: the instalments before that date, then one final payment of what was left. */
export function planSchedule(p: PaymentPlan): Instalment[] {
  const n = Math.max(1, Math.round(p.months));
  const r = p.apr > 0 ? p.apr / 100 / 12 : 0;
  const payment = r ? (p.principal * r) / (1 - (1 + r) ** -n) : p.principal / n;
  const out: Instalment[] = [];
  const monthlyFee = round2(Math.max(0, p.monthlyFee ?? 0));
  let balance = p.principal;
  for (let i = 0; i < n; i++) {
    const date = monthsAfter(p.startDate, i);
    if (p.closedOn && date > p.closedOn) {
      // What was left when it was paid off, as one last instalment on that date.
      if (balance > 0.005) out.push({ n: out.length + 1, date: p.closedOn, principal: round2(balance), interest: 0, fee: 0, monthlyFee: 0, total: round2(balance), balanceAfter: 0 });
      return out;
    }
    const interest = round2(balance * r);
    const principal = i === n - 1 ? round2(balance) : round2(payment - interest);
    balance = round2(balance - principal);
    const fee = i === 0 ? round2(p.setupFee) : 0;
    out.push({ n: i + 1, date, principal, interest, fee, monthlyFee, total: round2(principal + interest + fee + monthlyFee), balanceAfter: balance });
  }
  return out;
}

export interface PlanProgress {
  count: number; done: number;            // instalments in all, and dated on or before today
  monthly: number;                        // a usual instalment (purchase part + interest + monthly fee), without the one-time fee
  paid: number; left: number;             // of the purchase
  costPaid: number; costLeft: number;     // fee and interest so far, and still to come
  next: Instalment | null;
  endDate: IsoDate;
  finished: boolean;
}

export function planProgress(p: PaymentPlan, today: IsoDate): PlanProgress {
  const s = planSchedule(p);
  const past = s.filter((x) => x.date <= today), future = s.filter((x) => x.date > today);
  const sum = (xs: Instalment[], f: (x: Instalment) => number) => round2(xs.reduce((a, x) => a + f(x), 0));
  const usual = s.find((x) => x.n === Math.min(2, s.length)) ?? s[0];
  return {
    count: s.length, done: past.length, monthly: round2(usual.principal + usual.interest + usual.monthlyFee),
    paid: sum(past, (x) => x.principal), left: sum(future, (x) => x.principal),
    costPaid: sum(past, (x) => x.interest + x.fee + x.monthlyFee), costLeft: sum(future, (x) => x.interest + x.fee + x.monthlyFee),
    next: future[0] ?? null, endDate: s[s.length - 1].date, finished: !future.length,
  };
}

/**
 * How much of a card's balance is on plans and not yet billed as of `date`: the purchase amounts
 * of instalments still to come. A statement asks for the rest of the balance plus the instalments
 * that have come due, so this is what to leave out of "left to pay".
 */
export function plansDeferred(plans: PaymentPlan[], date: IsoDate): number {
  return round2(plans.reduce((s, p) => s + planSchedule(p).filter((x) => x.date > date).reduce((a, x) => a + x.principal, 0), 0));
}

/** Instalments of these plans dated in a range (for the planner and the bills calendar). */
export function instalmentsBetween<T extends PaymentPlan>(plans: T[], from: IsoDate, to: IsoDate): { plan: T; inst: Instalment; count: number }[] {
  return plans.flatMap((plan) => { const s = planSchedule(plan); return s.filter((x) => x.date >= from && x.date <= to).map((inst) => ({ plan, inst, count: s.length })); })
    .sort((a, b) => a.inst.date.localeCompare(b.inst.date));
}
