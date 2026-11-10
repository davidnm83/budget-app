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
  /** Parts of the balance at a promo rate until `until` (the first of the month it ends in, or the day): one per balance transfer. */
  promos?: Promo[];
  /** One promo part (older callers). */
  promo?: Promo | null;
}
export interface Promo { balance: number; apr: number; until: IsoDate }
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
    // Each promo part on its own, soonest ending first, never more in all than the card owes.
    let room = d.balance;
    const parts = [...(d.promos ?? []), ...(d.promo ? [d.promo] : [])].filter((p) => p.balance > 0 && p.until > today)
      .sort((a, b) => a.until.localeCompare(b.until))
      .map((p) => { const bal = round2(Math.min(p.balance, room)); room -= bal; return { ...p, bal }; }).filter((p) => p.bal > 0.005);
    const promo = parts.reduce((x, p) => x + p.bal, 0);
    return { ...d, regular: round2(d.balance - promo), parts, interest: 0, paidOff: null as number | null };
  });
  const promoBal = (d: (typeof live)[number]) => d.parts.reduce((x, p) => x + p.bal, 0);
  const owed = (d: (typeof live)[number]) => d.regular + promoBal(d);
  const minimumOf = (d: (typeof live)[number]) => minimumPayment(round2(owed(d)), d.rule ?? DEFAULT_MINIMUM);
  const minimums = round2(live.reduce((s, d) => s + minimumOf(d), 0));
  const promoLeft: PayoffResult['promoLeft'] = [];
  let month = 0;
  for (; month < MAX_MONTHS && live.some((d) => owed(d) > 0.005); month++) {
    const date = addMonths(start, month + 1);
    // Interest for the month, at the promo rate while it lasts; when it ends, what's left joins the regular part.
    for (const d of live) {
      if (owed(d) <= 0.005) continue;
      for (const p of d.parts.filter((x) => x.bal > 0.005 && date > x.until)) {
        promoLeft.push({ id: d.id, name: d.name, until: p.until, left: round2(p.bal) });
        d.regular = round2(d.regular + p.bal); p.bal = 0;
      }
      d.parts = d.parts.filter((x) => x.bal > 0.005);
      const i = round2((d.regular * d.apr + d.parts.reduce((x, p) => x + p.bal * p.apr, 0)) / 1200);
      d.regular = round2(d.regular + i); d.interest = round2(d.interest + i);
    }
    // Minimums first, then the rest to one card at a time in the strategy's order.
    let left = monthly;
    const pay = (d: (typeof live)[number], amount: number) => {
      const a = Math.min(amount, owed(d));
      // The regular part first, then promo parts by rate (highest first) and the soonest ending.
      let rest = a;
      const toRegular = Math.min(rest, d.regular);
      d.regular = round2(d.regular - toRegular); rest = round2(rest - toRegular);
      for (const p of [...d.parts].sort((x, y) => y.apr - x.apr || x.until.localeCompare(y.until))) {
        if (rest <= 0.005) break;
        const take = Math.min(rest, p.bal);
        p.bal = round2(p.bal - take); rest = round2(rest - take);
      }
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
