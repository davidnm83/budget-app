import { describe, expect, it } from 'vitest';
import { addMonths, payoffPlan, type Debt } from '../src/index.ts';

const fixed = (amount: number) => ({ base: 'fixed' as const, amount, plusCharges: false, floor: 0, round: 'cent' as const });
const cards: Debt[] = [
  { id: 'a', name: 'Store card', balance: 500, apr: 29.99, rule: fixed(10) },
  { id: 'b', name: 'Big card', balance: 3000, apr: 19.99, rule: fixed(10) },
];

describe('payoffPlan', () => {
  it('avalanche clears the dearest card first and costs less interest than snowball or minimums', () => {
    const av = payoffPlan(cards, 300, 'avalanche', '2026-10-08');
    const sn = payoffPlan(cards, 300, 'snowball', '2026-10-08');
    const min = payoffPlan(cards, 300, 'minimums', '2026-10-08');
    expect(av.cards[0].id).toBe('a');
    expect(av.months).toBeGreaterThan(10);
    expect(av.debtFree).toBe(addMonths('2026-10-01', av.months!));
    expect(av.interest).toBeLessThanOrEqual(sn.interest);
    expect(min.interest).toBeGreaterThan(av.interest * 3);
    expect(av.minimums).toBe(20);
  });
  it('snowball clears the smallest balance first', () => {
    const order = payoffPlan([{ ...cards[0], apr: 9.99 }, cards[1]], 300, 'snowball', '2026-10-08').cards.map((c) => c.id);
    expect(order).toEqual(['a', 'b']);
  });
  it('a promo balance costs nothing until its rate ends, and says what would be left then', () => {
    const r = payoffPlan([{ id: 't', name: 'Transfer card', balance: 2000, apr: 22.99, rule: fixed(10), promo: { balance: 2000, apr: 0, until: '2027-03-01' } }], 200, 'avalanche', '2026-10-08');
    expect(r.months).toBe(11); // the $1,000 left starts costing interest in April
    expect(r.promoLeft).toEqual([{ id: 't', name: 'Transfer card', until: '2027-03-01', left: 1000 }]);
    const slow = payoffPlan([{ id: 't', name: 'Transfer card', balance: 2000, apr: 0, rule: fixed(10), promo: { balance: 2000, apr: 0, until: '2027-12-01' } }], 200, 'avalanche', '2026-10-08');
    expect([slow.months, slow.interest, slow.promoLeft]).toEqual([10, 0, []]);
  });
  it('never finishes when the money only covers interest', () => {
    expect(payoffPlan([{ id: 'x', name: 'X', balance: 10000, apr: 24, rule: fixed(10) }], 150, 'avalanche', '2026-10-08').months).toBeNull();
  });
});
