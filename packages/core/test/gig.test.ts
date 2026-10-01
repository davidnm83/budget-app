import { describe, expect, it } from 'vitest';
import {
  costPerKmFrom, formatDuration, fuelCostFor, gigPlanned, minutesBetween, platformOf, shiftStats, summarizePayouts, totalShifts, totalsByPlatform,
  gigFuelByMonth, weeklyAverages, weeklyPayoutDate,
} from '../src/gig';

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
    expect(st).toMatchObject({ minutes: 210, hours: 3.5, perHour: 20, perKm: 1.4, perDelivery: 10, carCost: 6, net: 64, netPerHour: 18.29 });
    // No times: active minutes are used instead.
    expect(shiftStats({ date: '2026-09-30', platform: 'uber', activeMinutes: 90, earnings: 30 }, null).perHour).toBe(20);
    // A recorded gas cost wins over km × cost per km.
    expect(shiftStats({ date: '2026-09-30', platform: 'doordash', earnings: 50, km: 20, fuelCost: 3.6 }, 0.17).net).toBe(46.4);
  });

  it('totals shifts and estimates car cost per km', () => {
    const t = totalShifts([
      { date: '2026-09-29', platform: 'doordash', start: '17:00', end: '19:00', earnings: 40, km: 30 },
      { date: '2026-09-30', platform: 'doordash', earnings: 20, km: 10 },
    ], 0.1);
    expect(t).toMatchObject({ shifts: 2, hours: 2, earnings: 60, km: 40, net: 56, perHour: 20, perKm: 1.5 });
    expect(costPerKmFrom(150, 1200)).toBe(0.125);
    expect(costPerKmFrom(0, 100)).toBeNull();
  });
});

describe('multi-app shifts and payouts', () => {
  const shift = {
    date: '2026-09-29', platform: 'multi', start: '17:00', end: '21:00', km: 60, earnings: 0,
    parts: [
      { platform: 'doordash', earnings: 60, activeMinutes: 150, deliveries: 6 },
      { platform: 'uber', earnings: 30, activeMinutes: 60, deliveries: 2 },
    ],
  };

  it('shares dash time and km, splits earnings, active time and orders by app', () => {
    const st = shiftStats(shift, null);
    expect(st).toMatchObject({ minutes: 240, earnings: 90, activeMinutes: 210, deliveries: 8, perHour: 22.5, perKm: 1.5 });
    expect(st.activeShare).toBeCloseTo(0.875);
    expect(st.perActiveHour).toBeCloseTo(25.71, 2);
    // Overlapping apps can add up to more than the dash; the share stops at 100%.
    expect(shiftStats({ ...shift, end: '19:00' }, null).activeShare).toBe(1);
    expect(totalsByPlatform([shift]).map((p) => [p.platform, p.earnings, p.perActiveHour])).toEqual([['doordash', 60, 24], ['uber', 30, 30]]);
    expect(totalShifts([shift], null)).toMatchObject({ minutes: 240, activeMinutes: 210, perActiveHour: 25.71 });
  });

  it('formats durations and works out gas from L/100 km and $/L', () => {
    expect(formatDuration(1280)).toBe('21h 20m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(180)).toBe('3h');
    expect(fuelCostFor(16.5, 11.9, 1.84)).toBe(3.61);
  });

  it('plans weekly payouts on the payout day and instant pay less the fee', () => {
    expect(weeklyPayoutDate('2026-09-28', 0)).toBe('2026-10-05'); // Monday after the week
    expect(weeklyPayoutDate('2026-09-28', 2)).toBe('2026-10-07'); // Wednesday
    const rules = [
      { platform: 'doordash', mode: 'weekly' as const, weekday: 1, instantFee: 0, accountId: 'chq', matchText: null },
      { platform: 'uber', mode: 'instant' as const, weekday: 0, instantFee: 0.85, accountId: 'chq', matchText: null },
    ];
    const items = gigPlanned([shift], rules, '2026-09-28', '2026-10-11', '2026-10-01');
    expect(items.map((i) => [i.date, i.description, i.amount, i.matchText])).toEqual([
      ['2026-10-06', 'DoorDash pay', 60, 'DOORDASH'],
      ['2026-09-29', 'Uber instant pay', 29.15, 'UBER'],
    ]);
    // With averages, this week's payout uses the usual amount until more is logged.
    const est = gigPlanned([shift], rules.slice(0, 1), '2026-09-28', '2026-10-11', '2026-10-01', { doordash: 250 });
    expect(est[0]).toMatchObject({ amount: 250, description: 'DoorDash pay (est.)' });
    // A shift cashed out early on a weekly app: instant that day less its fee, and not in the weekly payout.
    const early = { ...shift, date: '2026-09-30', parts: [{ platform: 'doordash', earnings: 40, cashedOut: true, cashoutFee: 1.99 }] };
    expect(gigPlanned([shift, early], rules.slice(0, 1), '2026-09-28', '2026-10-11', '2026-10-01').map((i) => [i.date, i.amount]))
      .toEqual([['2026-09-30', 38.01], ['2026-10-06', 60]]);
    expect(weeklyAverages([shift], '2026-10-08', 2)).toEqual({ doordash: 30, uber: 15 });
    expect(gigFuelByMonth([shift, { ...shift, date: '2026-10-02', fuelCost: 5 }], 0.1)).toEqual({ '2026-09-01': 6, '2026-10-01': 5 });
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
