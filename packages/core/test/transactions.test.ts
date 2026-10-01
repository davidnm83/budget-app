import { describe, expect, it } from 'vitest';
import { datePresetRange, dayHeading, groupByDay, searchPattern } from '../src/index.ts';

describe('transactions tab helpers', () => {
  it('turns presets into date ranges', () => {
    expect(datePresetRange('month', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(datePresetRange('lastMonth', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(datePresetRange('30d', '2026-10-01')).toEqual({ from: '2026-09-02', to: '2026-10-01' });
    expect(datePresetRange('lastYear', '2026-10-01')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(datePresetRange('all', '2026-10-01')).toEqual({ from: null, to: null });
  });
  it('makes search text safe for the API', () => {
    expect(searchPattern('  Tim Hortons ')).toBe('*Tim Hortons*');
    expect(searchPattern('a,b(c)*%')).toBe('*a b c*');
    expect(searchPattern(' , ')).toBeNull();
  });
  it('groups rows by day with a net total', () => {
    const g = groupByDay([
      { date: '2026-09-30', amount: -10 }, { date: '2026-09-30', amount: 25.5 }, { date: '2026-09-29', amount: -4.2 },
    ]);
    expect(g.map((x) => [x.date, x.total, x.data.length])).toEqual([['2026-09-30', 15.5, 2], ['2026-09-29', -4.2, 1]]);
  });
  it('labels days', () => {
    expect(dayHeading('2026-10-01', '2026-10-01')).toBe('Today');
    expect(dayHeading('2026-09-30', '2026-10-01')).toBe('Yesterday');
    expect(dayHeading('2026-09-28', '2026-10-01')).toBe('Monday, September 28');
    expect(dayHeading('2025-12-31', '2026-10-01')).toBe('Wednesday, December 31, 2025');
  });
});
