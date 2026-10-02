import { describe, expect, it } from 'vitest';
import { cardStatus, instalmentsBetween, monthsAfter, planProgress, planSchedule, plansDeferred, type PaymentPlan } from '../src/index.ts';

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
});
