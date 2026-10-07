import { describe, expect, it } from 'vitest';
import { receiptAddsUp, type ReadReceipt } from '../src/index.ts';

const base: ReadReceipt = { merchant: 'Corner Grocer', date: '2026-10-01', total: 23.45, tax: 1.2, items: [{ name: 'Bread', amount: 4.25 }, { name: 'Coffee', amount: 18 }], legible: true };

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
