import { describe, expect, it } from 'vitest';
import { radarBanks, radarBills, radarBuffer, radarCards, radarLimits, radarPace, radarRunway, radarUnusual, rankRadar, type BudgetLine, type WeekRow } from '../src/index.ts';

const line = (o: Partial<BudgetLine>): BudgetLine => ({ key: 'c:1', label: 'Groceries', categoryId: '1', groupName: null, kind: 'expense', budgeted: 400, carryIn: 0, available: 400, actual: 0, left: 400, rollover: false, ...o });
const row = (o: Partial<WeekRow> & { amount?: number; estimated?: boolean }): WeekRow => ({
  key: 'r:1:2026-10-05', date: '2026-10-05', kind: 'planned', description: 'Gym', accountId: 'a', planned: -50, actual: null, counted: -50, overdue: false, txn: null, balanceAfter: 0,
  item: { key: 'r:1:2026-10-05', date: '2026-10-05', description: 'Gym', amount: -50, accountId: 'a', categoryId: null, estimated: !!o.estimated, matchText: null, recurringId: '1', occurrenceDate: '2026-10-05', entryId: null, transfer: false, matchedTxnId: null },
  ...o,
});

describe('radar', () => {
  it('warns once per account, on the earliest date, and urgently when it is this week or below zero', () => {
    const cards = radarBuffer([
      { accountId: 'a', date: '2026-10-20', balance: 30, buffer: 50, cause: 'Rent' },
      { accountId: 'a', date: '2026-10-06', balance: 10, buffer: 50, cause: 'Car loan' },
      { accountId: 'b', date: '2026-10-25', balance: 120, buffer: 200, cause: 'Insurance' },
    ], (id) => (id === 'a' ? 'Chequing' : 'Savings'), '2026-10-02');
    expect(cards.map((c) => [c.id, c.severity])).toEqual([['buffer:a:2026-10-06', 'act'], ['buffer:b:2026-10-25', 'heads']]);
    expect(cards[0].title).toContain('Chequing drops to');
    expect(cards[0].stake).toBe(40);
  });

  it('flags a bill that is late, after two days of grace', () => {
    expect(radarBills([row({})], '2026-10-07')).toEqual([]);
    const late = radarBills([row({})], '2026-10-08');
    expect(late).toHaveLength(1);
    expect(late[0].id).toBe('late:r:1:2026-10-05');
  });

  it('flags a fixed bill that posted at a different amount, but not an estimated one or a small difference', () => {
    const txn = { id: 't', date: '2026-10-05', amount: -58, accountId: 'a', name: 'GYM', merchant: null };
    expect(radarBills([row({ txn, actual: -58 })], '2026-10-06')[0].title).toContain('not');
    expect(radarBills([row({ txn, actual: -58, estimated: true })], '2026-10-06')).toEqual([]);
    expect(radarBills([row({ txn: { ...txn, amount: -51 }, actual: -51 })], '2026-10-06')).toEqual([]);
  });

  it('separates over budget from running ahead, and stays quiet when on pace', () => {
    expect(radarPace([line({ actual: 450 })], 0.5, '2026-10-01')[0].id).toBe('over:c:1:2026-10-01');
    expect(radarPace([line({ actual: 320 })], 0.5, '2026-10-01')[0].id).toBe('ahead:c:1:2026-10-01');
    expect(radarPace([line({ actual: 210 })], 0.5, '2026-10-01')).toEqual([]);
    expect(radarPace([line({ actual: 390 })], 0.95, '2026-10-01')).toEqual([]);
    expect(radarPace([line({ actual: 160 })], 0.06, '2026-10-01')).toEqual([]);   // too early in the month to say
    expect(radarPace([line({ actual: 400 })], 0.3, '2026-10-01')).toEqual([]);    // used up exactly (rent): done, not ahead
  });

  it('calls spending unusual only against a real history', () => {
    const cats = [{ id: '1', name: 'Shopping', kind: 'expense' }, { id: '2', name: 'Pay', kind: 'income' }];
    const usual = [new Map([['1', 100]]), new Map([['1', 120]]), new Map([['1', 80]])];
    expect(radarUnusual(cats, new Map([['1', 260]]), usual, '2026-10-01', 12)[0].title).toContain('usually');
    expect(radarUnusual(cats, new Map([['1', 130]]), usual, '2026-10-01', 12)).toEqual([]);
    expect(radarUnusual(cats, new Map([['1', 260]]), [new Map([['1', 100]]), new Map(), new Map()], '2026-10-01', 12)).toEqual([]);
  });

  it('flags a card by share of its limit, and uses the widget\'s own threshold', () => {
    const cards = [{ id: 'v', name: 'Visa', owed: 800, limit: 1000 }, { id: 'm', name: 'MC', owed: 100, limit: 1000 }, { id: 'n', name: 'No limit', owed: 500, limit: null }];
    expect(radarCards(cards).map((c) => [c.id, c.severity])).toEqual([['card:v:8', 'heads']]);
    expect(radarCards(cards, radarLimits({ cardPct: 90 }))).toEqual([]);
    expect(radarCards([{ id: 'v', name: 'Visa', owed: 950, limit: 1000 }])[0].severity).toBe('act');
  });

  it('warns when cash covers few days, and never without a spending history', () => {
    expect(radarRunway(500, 100, '2026-10-01')[0].severity).toBe('act');
    expect(radarRunway(1000, 100, '2026-10-01')[0].severity).toBe('heads');
    expect(radarRunway(5000, 100, '2026-10-01')).toEqual([]);
    expect(radarRunway(10, 0, '2026-10-01')).toEqual([]);
    expect(radarRunway(1000, 100, '2026-10-01', radarLimits({ runwayDays: 7 }))).toEqual([]);
  });

  it('reports only bank links that are not ok', () => {
    const got = radarBanks([{ id: '1', name: 'Bank A', status: 'ok' }, { id: '2', name: 'Bank B', status: 'login_required' }, { id: '3', name: 'Bank C', status: 'error' }]);
    expect(got.map((c) => c.id)).toEqual(['bank:2:login_required', 'bank:3:error']);
  });

  it('applies the unusual-spending settings', () => {
    const cats = [{ id: '1', name: 'Shopping', kind: 'expense' }];
    const usual = [new Map([['1', 100]]), new Map([['1', 100]]), new Map([['1', 100]])];
    expect(radarUnusual(cats, new Map([['1', 160]]), usual, '2026-10-01', 5)).toHaveLength(1);
    expect(radarUnusual(cats, new Map([['1', 160]]), usual, '2026-10-01', 5, radarLimits({ unusualPct: 100 }))).toEqual([]);
    expect(radarUnusual(cats, new Map([['1', 160]]), usual, '2026-10-01', 5, radarLimits({ unusualMin: 80 }))).toEqual([]);
  });

  it('ranks by urgency then money, and drops dismissed cards', () => {
    const c = (id: string, severity: 'act' | 'heads' | 'info', stake: number) => ({ id, check: 'pace' as const, severity, title: '', text: '', stake, href: '/' });
    expect(rankRadar([c('a', 'info', 900), c('b', 'act', 5), c('c', 'heads', 50), c('d', 'heads', 70)], ['c']).map((x) => x.id)).toEqual(['b', 'd', 'a']);
  });
});
