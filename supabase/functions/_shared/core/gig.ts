// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Gig work (GIG-1, 2, 3, 6, 8): payouts by platform, week and month, and per-shift numbers
 * ($/hour, $/km, earnings after car costs). Pure functions; the app loads the rows.
 */
import { addDays, weekStart, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';

export interface GigPlatform { key: string; name: string; icon: string; match: RegExp }

/** Matched against a payout's merchant and description. Order matters: first match wins. */
export const GIG_PLATFORMS: GigPlatform[] = [
  { key: 'doordash', name: 'DoorDash', icon: '🥡', match: /door\s*dash/i },
  { key: 'uber', name: 'Uber', icon: '🚗', match: /\buber\b/i },
  { key: 'instacart', name: 'Instacart', icon: '🥕', match: /instacart/i },
  { key: 'skip', name: 'SkipTheDishes', icon: '🛵', match: /skip\s*the\s*dishes/i },
  { key: 'lyft', name: 'Lyft', icon: '🚙', match: /\blyft\b/i },
  { key: 'naan-kabob', name: 'Naan Kabob', icon: '🍢', match: /naan\s*kabob/i },
];
export const OTHER_PLATFORM: GigPlatform = { key: 'other', name: 'Other', icon: '💼', match: /$^/ };

export function platformOf(text: string): GigPlatform {
  return GIG_PLATFORMS.find((p) => p.match.test(text)) ?? OTHER_PLATFORM;
}
export function platformByKey(key: string): GigPlatform {
  return GIG_PLATFORMS.find((p) => p.key === key) ?? OTHER_PLATFORM;
}

export interface Payout { date: IsoDate; amount: number; text: string }

export interface PayoutSummary {
  thisWeek: number; lastWeek: number; thisMonth: number; lastMonth: number; ytd: number;
  /** Average of the last 8 complete weeks. */
  avgWeek: number;
  /** Oldest first: the last `weeks` weeks (Monday start), this week included. */
  weeks: { week: IsoDate; total: number; byPlatform: Record<string, number> }[];
  /** Oldest first: the last `months` months, this month included. */
  months: { month: string; total: number; byPlatform: Record<string, number> }[];
  /** Year to date per platform, biggest first. */
  platforms: { key: string; total: number; share: number }[];
}

const monthOf = (d: IsoDate) => d.slice(0, 7);
function addMonthsKey(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export function summarizePayouts(payouts: Payout[], today: IsoDate, weeks = 12, months = 12): PayoutSummary {
  const wk = weekStart(today);
  const lastWk = addDays(wk, -7);
  const mo = monthOf(today);
  const lastMo = addMonthsKey(mo, -1);
  const year = today.slice(0, 4);
  const sum = (f: (p: Payout) => boolean) => round2(payouts.filter(f).reduce((s, p) => s + p.amount, 0));

  const weekList = Array.from({ length: weeks }, (_, i) => addDays(wk, -7 * (weeks - 1 - i)));
  const monthList = Array.from({ length: months }, (_, i) => addMonthsKey(mo, -(months - 1 - i)));
  const byWeek = new Map(weekList.map((w) => [w, { week: w, total: 0, byPlatform: {} as Record<string, number> }]));
  const byMonth = new Map(monthList.map((m) => [m, { month: m, total: 0, byPlatform: {} as Record<string, number> }]));
  const ytd: Record<string, number> = {};
  for (const p of payouts) {
    const key = platformOf(p.text).key;
    const w = byWeek.get(weekStart(p.date));
    if (w) { w.total += p.amount; w.byPlatform[key] = (w.byPlatform[key] ?? 0) + p.amount; }
    const m = byMonth.get(monthOf(p.date));
    if (m) { m.total += p.amount; m.byPlatform[key] = (m.byPlatform[key] ?? 0) + p.amount; }
    if (p.date.slice(0, 4) === year && p.date <= today) ytd[key] = (ytd[key] ?? 0) + p.amount;
  }
  const ytdTotal = Object.values(ytd).reduce((s, v) => s + v, 0);
  const complete = Array.from({ length: 8 }, (_, i) => addDays(wk, -7 * (i + 1)));
  const avgWeek = round2(complete.reduce((s, w) => s + sum((p) => weekStart(p.date) === w), 0) / 8);
  const r = <T extends { total: number; byPlatform: Record<string, number> }>(x: T) =>
    ({ ...x, total: round2(x.total), byPlatform: Object.fromEntries(Object.entries(x.byPlatform).map(([k, v]) => [k, round2(v)])) });

  return {
    thisWeek: sum((p) => p.date >= wk && p.date <= today),
    lastWeek: sum((p) => p.date >= lastWk && p.date < wk),
    thisMonth: sum((p) => monthOf(p.date) === mo && p.date <= today),
    lastMonth: sum((p) => monthOf(p.date) === lastMo),
    ytd: round2(ytdTotal),
    avgWeek,
    weeks: [...byWeek.values()].map(r),
    months: [...byMonth.values()].map(r),
    platforms: Object.entries(ytd).map(([key, total]) => ({ key, total: round2(total), share: ytdTotal ? total / ytdTotal : 0 }))
      .sort((a, b) => b.total - a.total),
  };
}

export interface Shift {
  date: IsoDate; platform: string;
  /** "HH:MM", optional. */
  start?: string | null; end?: string | null;
  /** Time spent on deliveries, if the app reports it; otherwise start→end is used. */
  activeMinutes?: number | null;
  deliveries?: number | null; earnings: number; tips?: number | null; km?: number | null;
  /** What the gas for this shift cost, when known; otherwise km × cost per km. */
  fuelCost?: number | null;
}

export interface ShiftStats {
  hours: number | null; perHour: number | null; perKm: number | null; perDelivery: number | null;
  carCost: number | null; net: number; netPerHour: number | null;
}

/** Minutes between two "HH:MM" times; a shift past midnight wraps to the next day. */
export function minutesBetween(start: string, end: string): number | null {
  const p = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = p(start), b = p(end);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 24 * 60 - a;
}

export function shiftStats(s: Shift, costPerKm: number | null): ShiftStats {
  const span = s.start && s.end ? minutesBetween(s.start, s.end) : null;
  const minutes = span ?? (s.activeMinutes || null);
  const hours = minutes ? minutes / 60 : null;
  const carCost = s.fuelCost != null ? round2(s.fuelCost) : s.km && costPerKm ? round2(s.km * costPerKm) : null;
  const net = round2(s.earnings - (carCost ?? 0));
  return {
    hours: hours != null ? round2(hours) : null,
    perHour: hours ? round2(s.earnings / hours) : null,
    perKm: s.km ? round2(s.earnings / s.km) : null,
    perDelivery: s.deliveries ? round2(s.earnings / s.deliveries) : null,
    carCost,
    net,
    netPerHour: hours ? round2(net / hours) : null,
  };
}

/** Car cost per km from what was spent on gas over a period and the km driven in it. */
export function costPerKmFrom(gasSpend: number, km: number): number | null {
  return km > 0 && gasSpend > 0 ? Math.round((gasSpend / km) * 1000) / 1000 : null;
}

export interface ShiftTotals { shifts: number; hours: number; earnings: number; km: number; net: number; perHour: number | null; perKm: number | null }

export function totalShifts(list: Shift[], costPerKm: number | null): ShiftTotals {
  let hours = 0, earnings = 0, km = 0, net = 0, timedEarnings = 0;
  for (const s of list) {
    const st = shiftStats(s, costPerKm);
    if (st.hours) { hours += st.hours; timedEarnings += s.earnings; }
    earnings += s.earnings; km += s.km ?? 0; net += st.net;
  }
  return {
    shifts: list.length, hours: round2(hours), earnings: round2(earnings), km: round2(km), net: round2(net),
    perHour: hours ? round2(timedEarnings / hours) : null, perKm: km ? round2(earnings / km) : null,
  };
}
