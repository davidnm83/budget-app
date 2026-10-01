import { describe, expect, it } from 'vitest';
import { planMerge, sameAccount } from '../src/index.ts';

describe('merging a manual account into a bank-connected one', () => {
  it('pairs one to one, rebuilds splits, and leaves the rest', () => {
    const manual = [
      { id: 'm1', date: '2026-09-02', amount: -40, name: 'SHOP' },
      { id: 'm2', date: '2026-09-05', amount: -29.37, name: 'AMAZON' },   // split of one -47.44 order
      { id: 'm3', date: '2026-09-05', amount: -18.07, name: 'amazon' },
      { id: 'm4', date: '2025-01-10', amount: -9.99, name: 'OLD' },       // older than the bank's history
    ];
    const bank = [
      { id: 'b1', date: '2026-09-03', amount: -40, name: 'SHOP' },
      { id: 'b2', date: '2026-09-06', amount: -47.44, name: 'AMAZON' },
      { id: 'b3', date: '2026-09-07', amount: -5, name: 'NEW' },
    ];
    const p = planMerge(manual, bank);
    expect([...p.pairs]).toEqual([['m1', 'b1']]);
    expect(p.groups).toEqual([{ bankId: 'b2', manualIds: ['m2', 'm3'] }]);
    expect(p.manualOnly).toEqual(['m4']);
    expect(p.bankOnly).toEqual(['b3']);
  });
  it('recognises the same card across a manual and a bank account', () => {
    expect(sameAccount({ mask: '2009', type: 'credit' }, { mask: '32009', type: 'credit' })).toBe(true);
    expect(sameAccount({ mask: '2009', type: 'credit' }, { mask: '2009', type: 'depository' })).toBe(false);
    expect(sameAccount({ mask: null, type: 'credit' }, { mask: null, type: 'credit' })).toBe(false);
  });
});

import { pairTransfers } from '../src/index.ts';
describe('pairing transfers', () => {
  it('pairs a card payment from chequing with the payment received on the card', () => {
    const p = pairTransfers([
      { id: 'out', accountId: 'chq', date: '2026-09-10', amount: -500, transfer: true },
      { id: 'in', accountId: 'card', date: '2026-09-12', amount: 500, transfer: false },
      { id: 'noise', accountId: 'chq', date: '2026-09-11', amount: 500, transfer: false },   // same account: no
      { id: 'late', accountId: 'sav', date: '2026-09-20', amount: 500, transfer: false },    // too far
      { id: 'in2', accountId: 'sav', date: '2026-09-15', amount: 75, transfer: true },
      { id: 'out2', accountId: 'chq', date: '2026-09-15', amount: -75, transfer: false },
    ]);
    expect(p).toEqual([['out', 'in'], ['out2', 'in2']]);
  });
});
