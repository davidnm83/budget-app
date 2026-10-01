import { describe, expect, it } from 'vitest';
import { cardCycle, cardInterest, cardStatus, loanSummary, monthlyFlow, utilization } from '../src/index.ts';

describe('loan payoff', () => {
  const txns = [
    { date: '2026-07-02', amount: 400, name: 'PAYMENT' }, { date: '2026-07-28', amount: -80, name: 'Interest Accrued' },
    { date: '2026-08-02', amount: 400, name: 'PAYMENT' }, { date: '2026-08-28', amount: -78, name: 'Interest Accrued' },
    { date: '2026-09-02', amount: 400, name: 'PAYMENT' }, { date: '2026-09-28', amount: -76, name: 'Interest Accrued' },
  ];
  it('estimates months left from the last 2 months', () => {
    const s = loanSummary(15000, txns, '2026-10-01');
    expect(s.perMonth).toEqual({ payment: 400, interest: 77, principal: 323 });
    expect([s.status, s.monthsLeft, s.payoffDate]).toEqual(['ok', 42, '2030-04-01']);
    expect(s.interestLeft).toBe(1703.42); // 400 × 41.76 months − 15,000
    expect([s.paymentsToDate, s.interestToDate]).toEqual([1200, 234]);
  });
  it('says when it cannot estimate', () => {
    expect(loanSummary(15000, txns.slice(4), '2026-10-01').status).toBe('not-enough-history');
    expect(loanSummary(50000, txns.map((t) => (t.amount < 0 ? { ...t, amount: -450 } : t)), '2026-10-01').status).toBe('payments-dont-cover');
  });
});

describe('credit cards', () => {
  it('works out the cycle around today', () => {
    expect(cardCycle('2026-10-01', 20, 10)).toEqual({ lastClose: '2026-09-20', nextClose: '2026-10-20', due: '2026-10-10', cycleDays: 30, daysToDue: 9 });
    expect(cardCycle('2026-10-25', 20, 10).due).toBe('2026-11-10');
    expect(cardCycle('2026-03-01', 31, 25).lastClose).toBe('2026-02-28');
  });
  it('knows what is left on the statement, interest and utilisation', () => {
    const s = cardStatus(500, [{ date: '2026-09-25', amount: -100 }, { date: '2026-09-28', amount: 300 }, { date: '2026-09-10', amount: -50 }], '2026-09-20', 30, 20.99);
    expect([s.statementOwed, s.paidSince, s.leftToPay, s.spentThisCycle]).toEqual([700, 300, 400, 100]);
    expect(s.interestIfUnpaid).toBe(cardInterest(450, 20.99, 30));
    expect(utilization(500, 2000)).toBe(0.25);
    expect(utilization(500, null)).toBeNull();
  });
});

describe('cash flow', () => {
  it('sums money in and out by month', () => {
    expect(monthlyFlow([{ date: '2026-09-03', amount: 100 }, { date: '2026-09-04', amount: -40 }, { date: '2026-10-01', amount: -5 }], '2026-10-01', 2))
      .toEqual([{ month: '2026-09-01', in: 100, out: 40 }, { month: '2026-10-01', in: 0, out: 5 }]);
  });
});
