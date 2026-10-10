import { describe, expect, it } from 'vitest';
import { cardStatement, cardStatus, statedBalance, findPlanCredit, findPlanDuplicates, planHeld, plansOffBalance, instalmentsBetween, monthsAfter, planProgress, planSchedule, plansDeferred, type PaymentPlan } from '../src/index.ts';

const plan = (o: Partial<PaymentPlan> = {}): PaymentPlan => ({ id: 'p', description: 'Laptop', principal: 1200, months: 12, startDate: '2026-01-15', setupFee: 0, apr: 0, ...o });
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('payment plans', () => {
  it('keeps the day of the month, falling back at short months', () => {
    expect(monthsAfter('2026-01-31', 1)).toBe('2026-02-28');
    expect(monthsAfter('2026-01-31', 2)).toBe('2026-03-31');
    expect(monthsAfter('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('splits a no-interest plan evenly, with the cents on the last instalment', () => {
    const s = planSchedule(plan({ principal: 1000, months: 3 }));
    expect(s.map((x) => x.principal)).toEqual([333.33, 333.33, 333.34]);
    expect(s.map((x) => x.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(s[2].balanceAfter).toBe(0);
  });

  it('charges the one-time fee with the first instalment only', () => {
    const s = planSchedule(plan({ setupFee: 24 }));
    expect(s[0].fee).toBe(24); expect(s[0].total).toBe(124);
    expect(sum(s.map((x) => x.fee))).toBe(24);
  });

  it('with interest: equal payments, interest falling, and the purchase paid off exactly', () => {
    const s = planSchedule(plan({ apr: 12 }));           // 1% a month on $1,200 over 12 months
    expect(s[0].interest).toBe(12);
    expect(s[0].principal + s[0].interest).toBeCloseTo(106.62, 2);
    expect(s[5].interest).toBeLessThan(s[0].interest);
    expect(sum(s.map((x) => x.principal))).toBe(1200);
    expect(sum(s.map((x) => x.interest))).toBeCloseTo(79.42, 0);
    expect(s[11].balanceAfter).toBe(0);
  });

  it('adds a fixed monthly fee to every instalment, and stops it when the plan is paid off early', () => {
    const s = planSchedule(plan({ monthlyFee: 4.5, setupFee: 10 }));
    expect(s[0].total).toBe(114.5); expect(s[1].total).toBe(104.5);
    expect(sum(s.map((x) => x.monthlyFee))).toBe(54);
    const g = planProgress(plan({ monthlyFee: 4.5 }), '2026-04-20');
    expect([g.monthly, g.costPaid, g.costLeft]).toEqual([104.5, 18, 36]);
    expect(sum(planSchedule(plan({ monthlyFee: 4.5, closedOn: '2026-04-01' })).map((x) => x.monthlyFee))).toBe(13.5);
  });

  it('reports progress: what is paid, what is left, and the next instalment', () => {
    const g = planProgress(plan({ setupFee: 24 }), '2026-04-20');
    expect([g.done, g.count, g.paid, g.left, g.costPaid, g.costLeft]).toEqual([4, 12, 400, 800, 24, 0]);
    expect(g.next?.date).toBe('2026-05-15');
    expect(g.endDate).toBe('2026-12-15');
    expect(planProgress(plan(), '2027-01-01').finished).toBe(true);
  });

  it('paid off early: one last instalment for what was left, and nothing after', () => {
    const s = planSchedule(plan({ closedOn: '2026-04-01' }));
    expect(s.map((x) => [x.date, x.principal])).toEqual([['2026-01-15', 100], ['2026-02-15', 100], ['2026-03-15', 100], ['2026-04-01', 900]]);
  });

  it('leaves the part of a plan not yet billed out of what a statement asks for', () => {
    const plans = [plan()];
    expect(plansDeferred(plans, '2026-03-20')).toBe(900);       // three instalments billed
    expect(plansDeferred(plans, '2027-01-01')).toBe(0);
    // $1,500 owed, statement closed with nothing paid or spent since: 900 of it isn't due yet.
    expect(cardStatus(1500, [], '2026-03-20', 30, null, 900).leftToPay).toBe(600);
    expect(cardStatus(1500, [], '2026-03-20', 30, null).leftToPay).toBe(1500);
  });

  it('lists the instalments that fall in a week', () => {
    const got = instalmentsBetween([plan(), plan({ id: 'q', startDate: '2026-02-10', months: 2 })], '2026-03-09', '2026-03-15');
    expect(got.map((x) => [x.plan.id, x.inst.n, x.count])).toEqual([['q', 2, 2], ['p', 3, 12]]);
  });

  it('moves one instalment to another date without touching the rest', () => {
    const s = planSchedule(plan({ principal: 300, months: 3, instalments: { '2': { date: '2026-02-20' } } }));
    expect(s.map((x) => x.date)).toEqual(['2026-01-15', '2026-02-20', '2026-03-15']);
    expect(s[1].moved).toBe(true); expect(s[0].moved).toBe(false);
  });

  it('takes the amount the bank billed and evens it out on the last instalment', () => {
    const s = planSchedule(plan({ principal: 1000, months: 3, instalments: { '1': { amount: 333.35 } } }));
    expect(s.map((x) => x.principal)).toEqual([333.35, 333.33, 333.32]);
    expect(sum(s.map((x) => x.principal))).toBe(1000);
    // With interest the billed amount covers the interest first.
    const t = planSchedule(plan({ apr: 12, instalments: { '1': { amount: 106.6 } } }));
    expect(t[0].interest).toBe(12); expect(t[0].principal).toBe(94.6); expect(t[0].total).toBe(106.6);
    expect(sum(t.map((x) => x.principal))).toBe(1200);
  });

  it('ignores a billed amount on the last instalment (it always clears the balance)', () => {
    const s = planSchedule(plan({ principal: 300, months: 3, instalments: { '3': { amount: 50 } } }));
    expect(s[2].principal).toBe(100);
  });

  it('counts an instalment linked to a payment as paid, even before its date', () => {
    const p = plan({ principal: 300, months: 3, instalments: { '2': { paidBy: 'txn1' } } });
    const g = planProgress(p, '2026-01-20');
    expect(g.done).toBe(2); expect(g.paid).toBe(200); expect(g.next!.n).toBe(3);
    expect(planSchedule(p)[1].paidBy).toBe('txn1');
  });
});

describe('statements with payment plans (option B)', () => {
  const base = { id: 'p', description: 'Laptop', months: 12, setupFee: 0, apr: 0 };
  it('a plan the bank keeps in the balance: the unbilled part is left out of the statement', () => {
    const p = { ...base, principal: 1200, startDate: '2026-11-15', purchaseDate: '2026-10-01', purchaseTxnId: 'buy' };
    // Statement closed Oct 18 at $1,500 ($1,200 laptop + $300); $100 spent since.
    const s = cardStatement(1600, [{ id: 'buy', date: '2026-10-01', amount: -1200 }, { id: 'x', date: '2026-10-20', amount: -100 }], '2026-10-18', 30, null, [p]);
    expect([s.statementOwed, s.leftToPay, s.spentThisCycle]).toEqual([300, 300, 100]);
  });
  it('a plan the bank moves off the balance with a credit: the credit is not a payment', () => {
    const p = { ...base, principal: 1800, startDate: '2026-11-10', purchaseDate: '2026-09-25', purchaseTxnId: 'buy', creditTxnId: 'cr', creditDate: '2026-10-03' };
    const txns = [{ id: 'buy', date: '2026-09-25', amount: -1800 }, { id: 'o', date: '2026-09-28', amount: -302.06 }, { id: 'cr', date: '2026-10-03', amount: 1800 }];
    const s = cardStatement(852.09, txns, '2026-09-20', 30, null, [p]);
    expect([s.statementOwed, s.paidSince, s.leftToPay, s.spentThisCycle]).toEqual([550.03, 0, 550.03, 302.06]);
    // Before the credit arrives the balance still holds the purchase; the statement is the same.
    const before = cardStatement(2652.09, txns.slice(0, 2), '2026-09-20', 30, null, [{ ...p, creditTxnId: null, creditDate: null }]);
    expect(before.leftToPay).toBe(550.03);
    // What's owed in total keeps the plan in it once the bank has taken it off the balance.
    expect(plansOffBalance([p], '2026-10-06')).toBe(1800);
    expect(planHeld(p, '2026-10-01')).toBe(1800);
    expect(planHeld(p, '2026-10-04')).toBe(0);
  });
  it('a statement entered from the bank wins over the worked-back one, as new balance or amount due', () => {
    const p = { ...base, principal: 1800, startDate: '2026-11-10', purchaseDate: '2026-09-15', purchaseTxnId: 'buy', creditTxnId: 'cr', creditDate: '2026-10-03' };
    // On the statement: $2,350.03 with the $1,800 plan, $550.03 due. The feed is missing $23.92 of charges since, so working back gives $573.95.
    const txns = [{ id: 'buy', date: '2026-09-15', amount: -1800 }, { id: 'o', date: '2026-09-28', amount: -278.14 }, { id: 'cr', date: '2026-10-03', amount: 1800 }];
    expect(cardStatement(852.09, txns, '2026-09-20', 30, null, [p]).statementOwed).toBe(573.95);
    expect(cardStatement(852.09, txns, '2026-09-20', 30, null, [p], undefined, undefined, undefined, 550.03).statementOwed).toBe(550.03);
    expect(cardStatement(852.09, txns, '2026-09-20', 30, null, [p], undefined, undefined, undefined, 2350.03).statementOwed).toBe(550.03);
    expect(statedBalance([{ close: '2026-09-21', balance: 550.03 }], '2026-09-20')).toBe(550.03);
    expect(statedBalance([{ close: '2026-08-20', balance: 500 }], '2026-09-20')).toBe(null);
  });
  it('finds the bank’s plan credit', () => {
    const p = { ...base, principal: 1800, startDate: '2026-11-10', purchaseDate: '2026-09-25', purchaseTxnId: 'buy' };
    const txns = [{ id: 'pay', date: '2026-10-01', amount: 500, name: 'PAYMENT RECEIVED' }, { id: 'cr', date: '2026-10-03', amount: 1800, name: 'INSTALLMENT PLAN FOR $1,800.00' }];
    expect(findPlanCredit(p, txns)?.id).toBe('cr');
    expect(findPlanCredit(p, txns, new Set(['cr']))).toBeNull();
  });
});

describe('payment plan duplicates', () => {
  const p = { ...plan(), accountId: 'card', purchaseTxnId: 'buy' };
  const t = (id: string, date: string, amount: number, name = 'Payment', o: object = {}) => ({ id, accountId: 'card', date, amount, name, importId: null, ...o });
  it('finds hand-typed instalments and plan entries, leaving the plan’s own and other cards alone', () => {
    const found = findPlanDuplicates([p], [
      t('a', '2026-02-16', -99.5),                       // instalment 2, a day late, a few cents off
      t('b', '2026-03-01', -42, 'Laptop instalment'),     // named after the plan
      t('c', '2026-02-15', -100, 'x', { accountId: 'other' }),
      t('d', '2026-02-15', 0, 'Laptop', { importId: 'plan:p:2' }),
      t('buy', '2026-01-10', -1200, 'Laptop'),
      t('e', '2026-02-15', -55),                         // not an instalment amount
    ]);
    expect(found.map((f) => [f.txn.id, f.n])).toEqual([['a', 2], ['b', null]]);
  });
});
