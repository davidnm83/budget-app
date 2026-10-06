import { describe, expect, it } from 'vitest';
import { amountMatches, balanceAt, balanceHistory, buildWeek, detectRecurring, expandPlan, matchDues, occurrences } from '../src/index.ts';

const r = (o: any) => ({ id: 'r1', name: 'Phone', kind: 'bill', amount: -80, estimated: false, frequency: 'monthly', start_date: '2026-01-31',
  end_date: null, account_id: 'chq', category_id: null, match_text: 'ROGERS', active: true, ...o });

describe('schedules', () => {
  it('monthly keeps the day, falling back to the month end', () => {
    expect(occurrences(r({}), '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('weekly, biweekly, yearly and end dates', () => {
    expect(occurrences(r({ frequency: 'biweekly', start_date: '2026-09-04' }), '2026-09-20', '2026-10-20')).toEqual(['2026-10-02', '2026-10-16']);
    expect(occurrences(r({ frequency: 'weekly', start_date: '2026-09-28', end_date: '2026-10-10' }), '2026-09-01', '2026-12-31')).toEqual(['2026-09-28', '2026-10-05']);
    expect(occurrences(r({ frequency: 'yearly', start_date: '2025-03-15' }), '2026-01-01', '2027-12-31')).toEqual(['2026-03-15', '2027-03-15']);
    expect(occurrences(r({ start_date: '2026-10-15' }), '2026-09-01', '2026-09-30')).toEqual([]);
  });
});

describe('matching due dates to transactions', () => {
  it('uses account, text, amount tolerance and date window', () => {
    expect([amountMatches(-80, -80.5, false), amountMatches(-80, -90, false), amountMatches(-80, -100, true), amountMatches(-80, 80, true)])
      .toEqual([true, false, true, false]);
    const m = matchDues(
      [{ key: 'a', date: '2026-09-15', amount: -80, accountId: 'chq', matchText: 'ROGERS', estimated: false }],
      [
        { id: 'x', date: '2026-09-15', amount: -80, accountId: 'chq', name: 'BELL', merchant: null },        // wrong payee
        { id: 'y', date: '2026-09-17', amount: -80.2, accountId: 'chq', name: 'ROGERS WIRELESS', merchant: null },
      ]);
    expect([...m]).toEqual([['a', 'y']]);
  });
});

describe('detecting recurring charges', () => {
  it('finds monthly bills and biweekly pay, ignores one-offs', () => {
    const tx = (date: string, amount: number, merchant: string) => ({ date, amount, merchant, name: merchant.toUpperCase(), account_id: 'chq', category_id: null });
    const s = detectRecurring([
      tx('2026-06-15', -80, 'Rogers'), tx('2026-07-15', -80, 'Rogers'), tx('2026-08-14', -80, 'Rogers'), tx('2026-09-15', -80, 'Rogers'),
      tx('2026-08-07', 610, 'DoorDash'), tx('2026-08-21', 540, 'DoorDash'), tx('2026-09-04', 700, 'DoorDash'), tx('2026-09-18', 655, 'DoorDash'),
      tx('2026-09-01', -300, 'Ikea'),
    ], '2026-09-30');
    expect(s.map((x) => [x.name, x.frequency, x.amount, x.estimated, x.start_date])).toEqual([
      ['DoorDash', 'biweekly', 632.5, true, '2026-09-18'],
      ['Rogers', 'monthly', -80, false, '2026-09-15'],
    ]);
  });
});

describe('weekly planner', () => {
  const planned = expandPlan(
    [r({ start_date: '2026-09-15', frequency: 'monthly', name: 'Rogers', amount: -80 }),
     r({ id: 'pay', name: 'Paycheque', kind: 'income', amount: 600, estimated: true, frequency: 'biweekly', start_date: '2026-09-04', match_text: 'DOORDASH' })],
    [{ id: 'e1', date: '2026-09-16', description: 'Move to savings', amount: -100, account_id: 'chq', to_account_id: 'sav', category_id: null,
       recurring_id: null, occurrence_date: null, skipped: false, matched_transaction_id: null }],
    '2026-09-14', '2026-09-20');
  it('expands schedules and one-offs, transfers on both accounts', () => {
    expect(planned.map((p) => [p.date, p.description, p.amount, p.accountId])).toEqual([
      ['2026-09-15', 'Rogers', -80, 'chq'], ['2026-09-16', 'Move to savings', -100, 'chq'],
      ['2026-09-16', 'Move to savings', 100, 'sav'], ['2026-09-18', 'Paycheque', 600, 'chq'],
    ]);
  });
  it('plans a bill some days before its due date when asked', () => {
    const early = expandPlan([r({ start_date: '2026-09-15', frequency: 'monthly', name: 'Visa', amount: -200, lead_days: 3 })], [], '2026-09-01', '2026-10-31');
    expect(early.map((p) => [p.date, p.occurrenceDate])).toEqual([['2026-09-12', '2026-09-15'], ['2026-10-12', '2026-10-15']]);
  });
  it('builds the week: actual replaces planned, unplanned counts, warning names the cause', () => {
    const w = buildWeek({
      weekStart: '2026-09-14', today: '2026-09-17',
      accounts: [{ id: 'chq', name: 'Chequing', startBalance: 150, buffer: 50 }],
      planned,
      actuals: [
        { id: 't1', date: '2026-09-15', amount: -80, accountId: 'chq', name: 'ROGERS', merchant: 'Rogers' },
        { id: 't2', date: '2026-09-15', amount: -25, accountId: 'chq', name: 'COFFEE', merchant: null },
      ],
    });
    const flat = w.days.flatMap((d) => d.rows.map((x) => [x.date, x.description, x.kind, x.counted, x.overdue, x.balanceAfter]));
    expect(flat).toEqual([
      ['2026-09-15', 'COFFEE', 'actual', -25, false, 125],
      ['2026-09-15', 'Rogers', 'planned', -80, false, 45],
      ['2026-09-16', 'Move to savings', 'planned', -100, true, -55],
      ['2026-09-18', 'Paycheque', 'planned', 600, false, 545],
    ]);
    expect(w.warnings).toEqual([]); // the dips on the 15th and 16th are already in the past on the 17th
    // From today on only: run the same week as if it were still the 15th.
    const early = buildWeek({ weekStart: '2026-09-14', today: '2026-09-15', accounts: [{ id: 'chq', name: 'Chequing', startBalance: 150, buffer: 50 }], planned,
      actuals: [{ id: 't1', date: '2026-09-15', amount: -80, accountId: 'chq', name: 'ROGERS', merchant: 'Rogers' }, { id: 't2', date: '2026-09-15', amount: -25, accountId: 'chq', name: 'COFFEE', merchant: null }] });
    expect(early.warnings).toEqual([{ accountId: 'chq', date: '2026-09-15', balance: 45, buffer: 50, cause: 'Rogers' }]);
    expect(w.summary).toMatchObject({ plannedIn: 600, plannedOut: 180, actualOut: 105, unplannedOut: 25, overdue: 1 });
  });
  it('works out past balances', () => {
    const tx = [{ date: '2026-09-28', amount: -20 }, { date: '2026-09-30', amount: 100 }];
    expect(balanceAt(500, tx, '2026-09-29')).toBe(400);
    expect(balanceHistory(500, tx, '2026-09-30', 3, 1)).toEqual([
      { date: '2026-09-28', balance: 400 }, { date: '2026-09-29', balance: 400 }, { date: '2026-09-30', balance: 500 },
    ]);
  });
});
