import { describe, expect, it } from 'vitest';
import { payLaterRegular, payLaterSchedule, payLaterStatus, type PayLater } from '../src/index.ts';

const pay4: PayLater = { id: 'p', provider: 'PayPal', description: 'Headphones', total: 100.01, downPayment: 0, payments: 4, frequency: 'biweekly',
  firstDate: '2026-10-01', apr: 0, accountId: 'chq', matchText: 'PAYPAL', paidByHand: [], closedOn: null };

describe('pay later', () => {
  it('splits evenly every two weeks, the odd cent on the first payment', () => {
    const s = payLaterSchedule(pay4);
    expect(s.map((x) => [x.date, x.amount])).toEqual([['2026-10-01', 25.01], ['2026-10-15', 25], ['2026-10-29', 25], ['2026-11-12', 25]]);
    expect(payLaterRegular(s)).toBe(25);
  });
  it('with interest: equal monthly payments that pay it off, interest falling as it goes', () => {
    const s = payLaterSchedule({ ...pay4, total: 1300, downPayment: 100, payments: 12, frequency: 'monthly', apr: 15 });
    expect(s).toHaveLength(12);
    expect(s[0].amount).toBe(108.31);
    expect(s[0].interest).toBe(15);
    expect(Math.round(s.reduce((t, x) => t + x.principal, 0) * 100) / 100).toBe(1200);
    expect(s[11].interest).toBeLessThan(s[1].interest);
  });
  it('payments matched to the account, or marked paid by hand; one late with nothing is missed', () => {
    const txns = [
      { id: 't1', date: '2026-10-02', amount: -25.01, accountId: 'chq', name: 'PAYPAL *PAY IN 4', merchant: null },
      { id: 'x', date: '2026-10-15', amount: -25, accountId: 'chq', name: 'GROCER', merchant: null },
    ];
    const st = payLaterStatus(pay4, txns, '2026-10-21');
    expect(st.schedule.map((x) => [x.n, x.txnId, x.paid, x.missed])).toEqual([[1, 't1', true, false], [2, null, false, true], [3, null, false, false], [4, null, false, false]]);
    expect([st.paidCount, st.owing, st.next?.n]).toEqual([1, 75, 2]);
    const byHand = payLaterStatus({ ...pay4, paidByHand: [2] }, txns, '2026-10-21');
    expect([byHand.paidCount, byHand.owing, byHand.next?.n, byHand.schedule[1].missed]).toEqual([2, 50, 3, false]);
    expect(payLaterStatus({ ...pay4, closedOn: '2026-10-20' }, txns, '2026-10-21')).toMatchObject({ owing: 0, unpaid: 75, next: null, done: true });
  });
});
