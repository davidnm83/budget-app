import { describe, expect, it } from 'vitest';
import { hideAmounts, isQuiet, noteBills, noteBudget, noteCheckin, noteGoals, noteLow, noteScore, pickNotes, toMessages, type Note, type WeekRow } from '../src/index.ts';

const row = (o: Partial<WeekRow>): WeekRow => ({ key: 'k', date: '2026-10-08', kind: 'planned', description: 'Rent', accountId: 'a', planned: -1450, actual: null, counted: -1450, overdue: false,
  item: { key: 'r:1|2026-10-08', transfer: false } as any, txn: null, balanceAfter: 0, ...o });

describe('notifications', () => {
  it('keeps quiet hours, also past midnight', () => {
    expect(isQuiet(23, {})).toBe(true);
    expect(isQuiet(7, {})).toBe(true);
    expect(isQuiet(8, {})).toBe(false);
    expect(isQuiet(13, { quietFrom: 12, quietTo: 14 })).toBe(true);
    expect(isQuiet(3, { quietFrom: 0, quietTo: 0 })).toBe(false);
  });
  it('sends each key once, morning notes from the morning hour, only kinds that are on', () => {
    const notes: Note[] = [
      { key: 'bank:x:2026-10-06', kind: 'bank', title: 'TD needs fixing', body: '', url: '/' },
      { key: 'bill:1', kind: 'bill', title: 'Rent due', body: '', url: '/' },
      { key: 'large:t', kind: 'large', title: '$640 at Best Buy', body: '', url: '/' },
    ];
    expect(pickNotes(notes, new Set(), 7, { quietFrom: 0, quietTo: 0 }).map((n) => n.key)).toEqual(['bank:x:2026-10-06']);
    expect(pickNotes(notes, new Set(['bank:x:2026-10-06']), 9, {}).map((n) => n.key)).toEqual(['bill:1']);
    expect(pickNotes(notes, new Set(), 9, { on: { large: true, bill: false } }).map((n) => n.key)).toEqual(['bank:x:2026-10-06', 'large:t']);
    expect(pickNotes(notes, new Set(), 23, {})).toEqual([]);
  });
  it('gathers a digest and hides amounts', () => {
    const notes: Note[] = [{ key: 'a', kind: 'bill', title: 'Rent $1,450 due Thursday', body: 'x', url: '/planner' }, { key: 'b', kind: 'low', title: 'Chequing dips to −$35.20 Fri', body: 'y', url: '/planner' }];
    expect(toMessages(notes, { digest: true, hideAmounts: true })).toEqual([{ title: '2 things today', body: '• Rent $••• due Thursday\n• Chequing dips to $••• Fri', url: '/', tag: 'digest' }]);
    expect(toMessages(notes.slice(0, 1), {})[0]).toMatchObject({ title: 'Rent $1,450 due Thursday', url: '/planner', tag: 'a' });
    expect(hideAmounts('$12.99 then -$3')).toBe('$••• then $•••');
  });
  it('words the notes', () => {
    expect(noteBills([row({}), row({ actual: -1450, key: 'paid' }), row({ date: '2026-10-20' })], '2026-10-07', 2).map((n) => n.title)).toEqual(['Rent $1,450 due tomorrow']);
    expect(noteLow([{ accountId: 'a', date: '2026-10-09', balance: 35, buffer: 100, cause: 'Rent' }], () => 'Chequing', '2026-10-07', 7)[0].title).toBe('Chequing dips to $35 Friday');
    expect(noteBudget([{ key: 'g', label: 'Groceries', actual: 552, available: 600 }, { key: 'f', label: 'Fun', actual: 20, available: 100 }], '2026-10', 9).map((n) => [n.key, n.title]))
      .toEqual([['budget:g:2026-10:90', 'Groceries at 92%']]);
    expect(noteGoals([{ id: 'e', name: 'Emergency fund', pct: 0.52, current: 2600, target: 5000, behind: 120 }], '2026-10-11').map((n) => n.key)).toEqual(['goal:e:50', 'goalpace:e:2026-10-11']);
    expect(noteScore('2026-02-28', 31).length).toBe(1);
    expect(noteCheckin('2026-10-07', { spentYesterday: 64.2, billsSoon: [{ name: 'Rent', amount: 1450, date: '2026-10-08' }], cash: 1240, lowest: { balance: 310, date: '2026-10-09' }, toReview: 3 })[0].body)
      .toBe('Yesterday $64.20 spent · 1 bill by tomorrow ($1,450) · cash $1,240, lowest $310 Friday · 3 to review');
  });
});
