import { describe, expect, it } from 'vitest';
import { cardStatement, transfersOnStatement, findTransferTxns, radarTransfers, transferProgress, cardCycle, cardInterest, cardStatus, loanSummary, monthlyFlow, utilization } from '../src/index.ts';

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

describe('balance transfers', () => {
  const bt = { id: 'b', fromAccountId: 'old', toAccountId: 'new', amount: 3000, fee: 90, date: '2026-09-01', promoApr: 0, promoEnd: '2027-03-01' };
  it('what is left and a month to clear it before the promo ends', () => {
    const p = transferProgress(bt, 3500, '2026-10-06');
    expect(p.remaining).toBe(3090); // the card also has $410 of new spending, which isn't the transfer
    expect(p.monthsLeft).toBe(5);
    expect(p.perMonth).toBe(618);
    expect(transferProgress(bt, 1200, '2026-10-06').remaining).toBe(1200);
    expect(transferProgress(bt, 1200, '2027-03-05').ended).toBe(true);
  });
  it('finds its transactions on both cards', () => {
    const rows = [
      { id: 'x', account_id: 'old', date: '2026-09-02', amount: 3000 },
      { id: 'y', account_id: 'new', date: '2026-09-01', amount: -3000 },
      { id: 'z', account_id: 'new', date: '2026-09-20', amount: -90 },
      { id: 'w', account_id: 'new', date: '2026-09-03', amount: -45 },
    ];
    const f = findTransferTxns(bt, rows);
    expect([f.out?.id, f.into?.id, f.fee?.id]).toEqual(['x', 'y', 'z']);
  });
  it('Radar: promo ending soon, or ended', () => {
    expect(radarTransfers([{ id: 'b', to: 'Visa', remaining: 1200, promoEnd: '2026-11-15', daysLeft: 40, perMonth: 600 }])[0].severity).toBe('heads');
    expect(radarTransfers([{ id: 'b', to: 'Visa', remaining: 1200, promoEnd: '2026-10-01', daysLeft: -5, perMonth: null }])[0].severity).toBe('act');
    expect(radarTransfers([{ id: 'b', to: 'Visa', remaining: 0, promoEnd: '2026-11-15', daysLeft: 40, perMonth: 0 }])).toEqual([]);
  });
});

describe('statements with a balance transfer', () => {
  it('a promo transfer already on the card is left out of the amount due; its charge is not spending', () => {
    const bt = { id: 'b', fromAccountId: 'old', toAccountId: 'new', amount: 3000, fee: 90, date: '2026-09-01', promoApr: 0, promoEnd: '2027-03-01', inTxnId: 'in' };
    // Closed Sep 20 owing $3,090 + $400 of purchases; $100 spent since.
    const txns = [{ id: 'in', date: '2026-09-01', amount: -3000 }, { id: 'f', date: '2026-09-02', amount: -90 }, { id: 'p', date: '2026-09-10', amount: -400 }, { id: 'q', date: '2026-09-25', amount: -100 }];
    const tr = transfersOnStatement([bt], 3590, '2026-09-20', '2026-10-06');
    expect(tr.held).toBe(3090);
    const s = cardStatement(3590, txns, '2026-09-20', 30, null, [], tr);
    expect([s.statementOwed, s.leftToPay, s.spentThisCycle]).toEqual([400, 400, 100]);
    expect(s.minimumLeft).toBe(104.7); // 3% of the whole statement, $3,490 with the transfer
    // All of it on the transfer: nothing beyond the minimum.
    const only = cardStatement(3090, txns.slice(0, 2), '2026-09-20', 30, null, [], transfersOnStatement([bt], 3090, '2026-09-20', '2026-10-06'));
    expect([only.leftToPay, only.minimumLeft]).toEqual([0, 92.7]);
    // Made this cycle: not on the statement yet, and not counted as spending either.
    const late = { ...bt, date: '2026-09-25', inTxnId: 'in2' };
    const s2 = cardStatement(3590, [{ id: 'in2', date: '2026-09-25', amount: -3000 }], '2026-09-20', 30, null, [], transfersOnStatement([late], 3590, '2026-09-20', '2026-10-06'));
    expect([s2.statementOwed, s2.spentThisCycle]).toEqual([590, 0]);
  });
});
