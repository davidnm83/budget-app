import { describe, expect, it } from 'vitest';
import { costPerKmFrom, minutesBetween, platformOf, shiftStats, summarizePayouts, totalShifts } from '../src/gig';

describe('gig work', () => {
  it('recognises platforms from payout names', () => {
    expect(platformOf('DoorDash Inc').key).toBe('doordash');
    expect(platformOf('UBER CANADA/UBERTRIP').key).toBe('uber');
    expect(platformOf('Instacart Pay').key).toBe('instacart');
    expect(platformOf('Naan kabob Catering').key).toBe('naan-kabob');
    expect(platformOf('Payroll').key).toBe('other');
  });

  it('sums payouts by week, month and platform', () => {
    // Thursday Oct 1, 2026; the week starts Monday Sep 28.
    const s = summarizePayouts([
      { date: '2026-09-28', amount: 120, text: 'DoorDash Inc' },
      { date: '2026-09-30', amount: 80, text: 'Instacart Pay' },
      { date: '2026-09-22', amount: 200, text: 'DoorDash Inc' },
      { date: '2026-08-15', amount: 50, text: 'Uber Canada' },
      { date: '2025-12-20', amount: 999, text: 'DoorDash Inc' },
    ], '2026-10-01', 4, 3);
    expect(s.thisWeek).toBe(200);
    expect(s.lastWeek).toBe(200);
    expect(s.thisMonth).toBe(0);
    expect(s.lastMonth).toBe(400);
    expect(s.ytd).toBe(450);
    expect(s.weeks.map((w) => w.week)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(s.weeks[3].byPlatform).toEqual({ doordash: 120, instacart: 80 });
    expect(s.months.map((m) => [m.month, m.total])).toEqual([['2026-08', 50], ['2026-09', 400], ['2026-10', 0]]);
    expect(s.platforms[0]).toMatchObject({ key: 'doordash', total: 320 });
    expect(s.avgWeek).toBe(round(250 / 8));
  });

  it('works out a shift: hours, $/hour, $/km and earnings after gas', () => {
    expect(minutesBetween('17:30', '21:00')).toBe(210);
    expect(minutesBetween('22:00', '01:30')).toBe(210);
    const st = shiftStats({ date: '2026-09-30', platform: 'doordash', start: '17:30', end: '21:00', earnings: 70, km: 50, deliveries: 7 }, 0.12);
    expect(st).toEqual({ hours: 3.5, perHour: 20, perKm: 1.4, perDelivery: 10, carCost: 6, net: 64, netPerHour: 18.29 });
    // No times: active minutes are used instead.
    expect(shiftStats({ date: '2026-09-30', platform: 'uber', activeMinutes: 90, earnings: 30 }, null).perHour).toBe(20);
  });

  it('totals shifts and estimates car cost per km', () => {
    const t = totalShifts([
      { date: '2026-09-29', platform: 'doordash', start: '17:00', end: '19:00', earnings: 40, km: 30 },
      { date: '2026-09-30', platform: 'doordash', earnings: 20, km: 10 },
    ], 0.1);
    expect(t).toEqual({ shifts: 2, hours: 2, earnings: 60, km: 40, net: 56, perHour: 20, perKm: 1.5 });
    expect(costPerKmFrom(150, 1200)).toBe(0.125);
    expect(costPerKmFrom(0, 100)).toBeNull();
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
