// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * A plan to pay off your cards: one monthly amount for all of them, each card's minimum paid first and the
 * rest put on one card at a time. Avalanche puts it on the highest interest rate first (least interest
 * overall); snowball on the smallest balance first (cards gone soonest). A card cleared frees its minimum for
 * the next. A promo balance (a balance transfer at a low rate until a date) has its own rate until then;
 * money above the minimum goes to the part at the regular rate first, as Canadian card issuers apply it.
 */
import { addMonths, monthOf, type Month } from './budget.ts';
import { DEFAULT_MINIMUM, minimumPayment, type MinimumRule } from './cards.ts';
import type { IsoDate } from './dates.ts';
import { round2 } from './money.ts';

export interface Debt {
  id: string; name: string;
  /** Owed now, positive. */
  balance: number;
  /** Yearly interest rate, %. */
  apr: number;
  rule?: MinimumRule | null;
  /** Part of the balance at a promo rate until `until` (the first of the month it ends in, or the day). */
  promo?: { balance: number; apr: number; until: IsoDate } | null;
}
export type Strategy = 'avalanche' | 'snowball' | 'minimums';

export interface PayoffResult {
  /** Months until every card is paid off; null if it isn't within 50 years. */
  months: number | null;
  debtFree: Month | null;
  interest: number;
  /** Each card in the order it's paid off: the month, and the interest it costs on the way. */
  cards: { id: string; name: string; paidOff: Month | null; months: number | null; interest: number }[];
  /** Promo balances still owing when their rate ends, at this pace. */
  promoLeft: { id: string; name: string; until: IsoDate; left: number }[];
  /** This month's minimums: the monthly amount can't be less. */
  minimums: number;
}

const MAX_MONTHS = 600;

export function payoffPlan(debts: Debt[], monthly: number, strategy: Strategy, today: IsoDate): PayoffResult {
  const start = monthOf(today);
  const live = debts.filter((d) => d.balance > 0.005).map((d) => {
    const promo = d.promo && d.promo.balance > 0 && d.promo.until > today ? Math.min(d.promo.balance, d.balance) : 0;
    return { ...d, regular: round2(d.balance - promo), promoBal: round2(promo), interest: 0, paidOff: null as number | null, promoChecked: false };
  });
  const owed = (d: (typeof live)[number]) => d.regular + d.promoBal;
  const minimumOf = (d: (typeof live)[number]) => minimumPayment(round2(owed(d)), d.rule ?? DEFAULT_MINIMUM);
  const minimums = round2(live.reduce((s, d) => s + minimumOf(d), 0));
  const promoLeft: PayoffResult['promoLeft'] = [];
  let month = 0;
  for (; month < MAX_MONTHS && live.some((d) => owed(d) > 0.005); month++) {
    const date = addMonths(start, month + 1);
    // Interest for the month, at the promo rate while it lasts; when it ends, what's left joins the regular part.
    for (const d of live) {
      if (owed(d) <= 0.005) continue;
      if (d.promoBal > 0 && d.promo && date > d.promo.until) {
        if (!d.promoChecked) promoLeft.push({ id: d.id, name: d.name, until: d.promo.until, left: round2(d.promoBal) });
        d.promoChecked = true;
        d.regular = round2(d.regular + d.promoBal); d.promoBal = 0;
      }
      const i = round2((d.regular * d.apr + d.promoBal * (d.promoBal > 0 && d.promo ? d.promo.apr : d.apr)) / 1200);
      d.regular = round2(d.regular + i); d.interest = round2(d.interest + i);
    }
    // Minimums first, then the rest to one card at a time in the strategy's order.
    let left = monthly;
    const pay = (d: (typeof live)[number], amount: number) => {
      const a = Math.min(amount, owed(d));
      const toRegular = Math.min(a, d.regular);
      d.regular = round2(d.regular - toRegular); d.promoBal = round2(d.promoBal - (a - toRegular));
      left = round2(left - a);
      return a;
    };
    for (const d of live) if (owed(d) > 0.005) pay(d, minimumOf(d));
    if (strategy !== 'minimums') {
      const order = live.filter((d) => owed(d) > 0.005).sort((a, b) => strategy === 'avalanche' ? b.apr - a.apr || owed(a) - owed(b) : owed(a) - owed(b) || b.apr - a.apr);
      for (const d of order) { if (left <= 0.005) break; pay(d, left); }
    }
    for (const d of live) if (d.paidOff == null && owed(d) <= 0.005) d.paidOff = month + 1;
  }
  // Promo balances whose rate ends after the last month counted are cleared in time.
  const done = live.every((d) => owed(d) <= 0.005);
  return {
    months: done ? month : null,
    debtFree: done ? addMonths(start, month) : null,
    interest: round2(live.reduce((s, d) => s + d.interest, 0)),
    cards: [...live].sort((a, b) => (a.paidOff ?? 1e9) - (b.paidOff ?? 1e9)).map((d) => ({
      id: d.id, name: d.name, paidOff: d.paidOff == null ? null : addMonths(start, d.paidOff), months: d.paidOff, interest: d.interest,
    })),
    promoLeft,
    minimums,
  };
}
