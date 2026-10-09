import { describe, expect, it } from 'vitest';
import { receiptAddsUp, receiptPaid, rewardsSplit, type ReadReceipt } from '../src/index.ts';

const base: ReadReceipt = { merchant: 'Corner Grocer', date: '2026-10-01', total: 23.45, tax: 1.2, items: [{ name: 'Bread', amount: 4.25 }, { name: 'Coffee', amount: 18 }], redeemed: [], legible: true };

describe('receiptAddsUp', () => {
  it('trusts a reading whose items and tax come to the total', () => {
    expect(receiptAddsUp(base)).toBe(true);
    expect(receiptAddsUp({ ...base, items: [] })).toBe(true); // only the total was read
    expect(receiptAddsUp({ ...base, items: [...base.items, { name: 'Coupon', amount: -1 }], total: 22.45 })).toBe(true);
  });
  it('sends anything doubtful to the stronger model', () => {
    expect(receiptAddsUp({ ...base, total: 25 })).toBe(false);
    expect(receiptAddsUp({ ...base, total: null })).toBe(false);
    expect(receiptAddsUp({ ...base, merchant: ' ' })).toBe(false);
    expect(receiptAddsUp({ ...base, legible: false })).toBe(false);
  });
});

describe('points redeemed', () => {
  const pc = { ...base, redeemed: [{ name: 'PC Optimum', amount: 20 }] };
  it('the card is charged the total less the points', () => {
    expect(receiptAddsUp(pc)).toBe(true);
    expect(receiptPaid(pc)).toBe(3.45);
    expect(receiptPaid(base)).toBe(23.45);
  });
  it('more points than the total is a misreading', () => {
    expect(receiptAddsUp({ ...base, redeemed: [{ name: 'PC Optimum', amount: 30 }] })).toBe(false);
  });
  it('as rewards: full value spent, the points back, adding up to the charge', () => {
    const parts = rewardsSplit(-60, 20, 'groceries', 'rewards');
    expect(parts).toEqual([{ category_id: 'groceries', amount: -80 }, { category_id: 'rewards', amount: 20 }]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(-60);
  });
});
