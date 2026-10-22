import { describe, expect, it } from 'vitest';
import { payLaterRegular, payLaterSchedule, payLaterStatus, payLaterStatuses, type PayLater } from '../src/index.ts';

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

describe('pay later payments linked by hand, and close amounts', () => {
  const txn = (id: string, date: string, amount: number, name = 'PAYPAL') => ({ id, date, amount, accountId: 'chq', name, merchant: null });
  it('a payment linked by hand is paid by that transaction, whatever its day or description', () => {
    const p = { ...pay4, paidWith: { '2': 'late' } };
    const s = payLaterStatus(p, [txn('a', '2026-10-01', -25.01), txn('late', '2026-10-24', -25, 'BANK TRANSFER')], '2026-11-05');
    expect(s.schedule.map((x) => [x.n, x.txnId, x.paid, x.missed])).toEqual([[1, 'a', true, false], [2, 'late', true, false], [3, null, false, true], [4, null, false, false]]);
  });
  it('payments of exactly the amount are matched first, so a plan a cent off doesn’t take another’s', () => {
    // Two plans paying on the same day: $25.00 and $25.01. Matched one after the other by closeness alone, the first
    // plan could take the $25.01 payment and leave the second with none.
    const a = { ...pay4, id: 'a', total: 100 }, b = { ...pay4, id: 'b', total: 100.04, firstDate: '2026-10-01' };
    const [sa, sb] = payLaterStatuses([b, a], [txn('x', '2026-10-01', -25), txn('y', '2026-10-01', -25.01)], '2026-10-02');
    expect([sa.schedule[0].txnId, sb.schedule[0].txnId]).toEqual(['y', 'x']);
    // One cent off with nothing exact: still matched.
    expect(payLaterStatus(pay4, [txn('z', '2026-10-02', -25.02)], '2026-10-03').schedule[0].txnId).toBe('z');
  });
});

