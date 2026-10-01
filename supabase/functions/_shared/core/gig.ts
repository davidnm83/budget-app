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

/** One app's share of a shift: what it paid and how much of the time it kept you busy. */
export interface ShiftPart {
  platform: string; earnings: number; tips?: number | null;
  /** Time on that app's orders. With several apps on at once these can overlap. */
  activeMinutes?: number | null;
  deliveries?: number | null;
}

/**
 * A shift ("dash"): one stretch of driving with one or more apps on. Time, km and gas belong to
 * the shift; earnings, active time and orders belong to each app (`parts`). Older single-app
 * shifts keep platform/earnings/activeMinutes/deliveries on the shift itself.
 */
export interface Shift {
  date: IsoDate; platform: string;
  /** "HH:MM", optional. */
  start?: string | null; end?: string | null;
  activeMinutes?: number | null;
  deliveries?: number | null; earnings: number; tips?: number | null; km?: number | null;
  /** What the gas for this shift cost, when known; otherwise km × cost per km. */
  fuelCost?: number | null;
  parts?: ShiftPart[] | null;
}

export function partsOf(s: Shift): ShiftPart[] {
  return s.parts?.length ? s.parts
    : [{ platform: s.platform, earnings: s.earnings, tips: s.tips ?? null, activeMinutes: s.activeMinutes ?? null, deliveries: s.deliveries ?? null }];
}

export interface ShiftStats {
  /** Dash time: start → end (or the active time when no times were logged). */
  minutes: number | null; hours: number | null;
  activeMinutes: number | null;
  /** Active ÷ dash time, at most 100% (overlapping apps can add up to more). */
  activeShare: number | null;
  earnings: number; deliveries: number | null;
  perHour: number | null; perActiveHour: number | null; perKm: number | null; perDelivery: number | null;
  carCost: number | null; net: number; netPerHour: number | null;
}

/** Minutes between two "HH:MM" times; a shift past midnight wraps to the next day. */
export function minutesBetween(start: string, end: string): number | null {
  const p = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = p(start), b = p(end);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 24 * 60 - a;
}

/** 1280 → "21h 20m"; 45 → "45m"; 180 → "3h". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !isFinite(minutes)) return '–';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

/** Gas for a drive: km × (L/100 km) ÷ 100 × $/L. */
export function fuelCostFor(km: number | null | undefined, litresPer100km: number | null | undefined, pricePerLitre: number | null | undefined): number | null {
  if (!km || !litresPer100km || !pricePerLitre) return null;
  return round2((km * litresPer100km / 100) * pricePerLitre);
}

export function shiftStats(s: Shift, costPerKm: number | null): ShiftStats {
  const parts = partsOf(s);
  const earnings = round2(parts.reduce((x, p) => x + (p.earnings || 0), 0));
  const timed = parts.filter((p) => p.activeMinutes != null && p.activeMinutes > 0);
  const activeMinutes = timed.length ? timed.reduce((x, p) => x + p.activeMinutes!, 0) : null;
  const deliveries = parts.some((p) => p.deliveries) ? parts.reduce((x, p) => x + (p.deliveries ?? 0), 0) : null;
  const span = s.start && s.end ? minutesBetween(s.start, s.end) : null;
  const minutes = span ?? activeMinutes;
  const hours = minutes ? minutes / 60 : null;
  const carCost = s.fuelCost != null ? round2(s.fuelCost) : s.km && costPerKm ? round2(s.km * costPerKm) : null;
  const net = round2(earnings - (carCost ?? 0));
  const activeEarn = timed.reduce((x, p) => x + p.earnings, 0);
  return {
    minutes, hours: hours != null ? round2(hours) : null, activeMinutes,
    activeShare: span && activeMinutes ? Math.min(1, activeMinutes / span) : null,
    earnings, deliveries,
    perHour: hours ? round2(earnings / hours) : null,
    perActiveHour: activeMinutes ? round2(activeEarn / (activeMinutes / 60)) : null,
    perKm: s.km ? round2(earnings / s.km) : null,
    perDelivery: deliveries ? round2(earnings / deliveries) : null,
    carCost, net, netPerHour: hours ? round2(net / hours) : null,
  };
}

/** Car cost per km from what was spent on gas over a period and the km driven in it. */
export function costPerKmFrom(gasSpend: number, km: number): number | null {
  return km > 0 && gasSpend > 0 ? Math.round((gasSpend / km) * 1000) / 1000 : null;
}

export interface ShiftTotals {
  shifts: number; minutes: number; hours: number; activeMinutes: number; earnings: number; deliveries: number; km: number; net: number;
  perHour: number | null; perActiveHour: number | null; activeShare: number | null; perKm: number | null;
}

export function totalShifts(list: Shift[], costPerKm: number | null): ShiftTotals {
  let minutes = 0, timedEarn = 0, active = 0, activeEarn = 0, spanForActive = 0, earnings = 0, km = 0, net = 0, deliveries = 0;
  for (const s of list) {
    const st = shiftStats(s, costPerKm);
    if (st.minutes) { minutes += st.minutes; timedEarn += st.earnings; }
    if (st.activeMinutes) {
      active += st.activeMinutes;
      activeEarn += partsOf(s).filter((p) => p.activeMinutes).reduce((x, p) => x + p.earnings, 0);
      if (s.start && s.end) spanForActive += Math.max(st.minutes ?? 0, 0);
    }
    earnings += st.earnings; km += s.km ?? 0; net += st.net; deliveries += st.deliveries ?? 0;
  }
  return {
    shifts: list.length, minutes, hours: round2(minutes / 60), activeMinutes: active, earnings: round2(earnings), deliveries,
    km: round2(km), net: round2(net),
    perHour: minutes ? round2(timedEarn / (minutes / 60)) : null,
    perActiveHour: active ? round2(activeEarn / (active / 60)) : null,
    activeShare: spanForActive ? Math.min(1, active / spanForActive) : null,
    perKm: km ? round2(earnings / km) : null,
  };
}

export interface PlatformTotals { platform: string; shifts: number; earnings: number; activeMinutes: number; deliveries: number; perActiveHour: number | null }

/** Per app across shifts, biggest earner first. */
export function totalsByPlatform(list: Shift[]): PlatformTotals[] {
  const m = new Map<string, PlatformTotals & { activeEarn: number }>();
  for (const s of list) {
    for (const p of partsOf(s)) {
      const x = m.get(p.platform) ?? { platform: p.platform, shifts: 0, earnings: 0, activeMinutes: 0, deliveries: 0, perActiveHour: null, activeEarn: 0 };
      x.shifts++; x.earnings += p.earnings; x.deliveries += p.deliveries ?? 0;
      if (p.activeMinutes) { x.activeMinutes += p.activeMinutes; x.activeEarn += p.earnings; }
      m.set(p.platform, x);
    }
  }
  return [...m.values()].map(({ activeEarn, ...x }) => ({
    ...x, earnings: round2(x.earnings), perActiveHour: x.activeMinutes ? round2(activeEarn / (x.activeMinutes / 60)) : null,
  })).sort((a, b) => b.earnings - a.earnings);
}

// ───────────────────────── payouts in the planner ─────────────────────────

export interface PayoutRule {
  platform: string;
  /** weekly: last week's earnings land on `weekday`; instant: each shift's pay lands that day, less the fee. */
  mode: 'weekly' | 'instant' | 'off';
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  instantFee: number;
  accountId: string | null;
  matchText: string | null;
}

export const DEFAULT_MATCH: Record<string, string> = { doordash: 'DOORDASH', uber: 'UBER', instacart: 'INSTACART', skip: 'SKIP', lyft: 'LYFT', 'naan-kabob': 'NAAN KABOB' };

/** The payout date for a week's work (Monday `week`): the first `weekday` after that week ends. */
export function weeklyPayoutDate(week: IsoDate, weekday: number): IsoDate {
  return addDays(week, 7 + ((weekday % 7) + 7) % 7);
}

/**
 * Planned gig income between `from` and `to`, as planner items. Weekly apps: logged earnings of
 * the week before, on the payout day. Instant: each shift's earnings less the fee, the same day.
 * With `averages` (per app, per week), weeks with less logged than usual use the average instead,
 * so the plan has an estimate before the shifts happen.
 */
export function gigPlanned(shifts: Shift[], rules: PayoutRule[], from: IsoDate, to: IsoDate,
  today: IsoDate, averages: Record<string, number> | null = null) {
  const out: { key: string; date: IsoDate; description: string; amount: number; accountId: string | null; categoryId: string | null;
    estimated: boolean; matchText: string | null; recurringId: null; occurrenceDate: null; entryId: null; transfer: false; matchedTxnId: null }[] = [];
  const thisWeek = weekStart(today);
  for (const r of rules.filter((x) => x.mode !== 'off' && x.accountId)) {
    const name = platformByKey(r.platform).name;
    const base = { accountId: r.accountId, categoryId: null, estimated: true, matchText: r.matchText ?? DEFAULT_MATCH[r.platform] ?? null,
      recurringId: null, occurrenceDate: null, entryId: null, transfer: false as const, matchedTxnId: null };
    if (r.mode === 'instant') {
      for (const s of shifts) {
        if (s.date < from || s.date > to) continue;
        const earned = partsOf(s).filter((p) => p.platform === r.platform).reduce((x, p) => x + p.earnings, 0);
        if (earned > 0) out.push({ ...base, key: `gig:${r.platform}:${s.date}:${s.start ?? ''}`, date: s.date, description: `${name} instant pay`, amount: round2(earned - r.instantFee) });
      }
      continue;
    }
    // Weekly: every work week whose payout day falls in the range.
    for (let w = weekStart(addDays(from, -14)); w <= to; w = addDays(w, 7)) {
      const date = weeklyPayoutDate(w, r.weekday);
      if (date < from || date > to) continue;
      const logged = round2(shifts.filter((s) => s.date >= w && s.date <= addDays(w, 6))
        .reduce((x, s) => x + partsOf(s).filter((p) => p.platform === r.platform).reduce((y, p) => y + p.earnings, 0), 0));
      const avg = averages?.[r.platform] ?? 0;
      const amount = w >= thisWeek && avg > logged ? round2(avg) : logged;
      if (amount > 0) out.push({ ...base, key: `gig:${r.platform}:${w}`, date, amount,
        description: `${name} pay${w >= thisWeek && avg > logged ? ' (est.)' : ''}` });
    }
  }
  return out;
}

/** Each app's average weekly earnings over the last `weeks` full weeks of logged shifts. */
export function weeklyAverages(shifts: Shift[], today: IsoDate, weeks = 8): Record<string, number> {
  const end = weekStart(today);
  const startW = addDays(end, -7 * weeks);
  const sums: Record<string, number> = {};
  for (const s of shifts) {
    if (s.date < startW || s.date >= end) continue;
    for (const p of partsOf(s)) sums[p.platform] = (sums[p.platform] ?? 0) + p.earnings;
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, round2(v / weeks)]));
}
