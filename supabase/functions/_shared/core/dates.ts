// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Dates are plain 'YYYY-MM-DD' strings (calendar days, no time zone), which is
 * what Plaid returns and what Postgres `date` columns store. All arithmetic is
 * done in UTC so a device's time zone can never shift a day.
 */
export type IsoDate = string;

export function parseIso(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 864e5);
}

/** Monday of the week containing `iso` (weeks run Monday to Sunday). */
export function weekStart(iso: IsoDate): IsoDate {
  const dow = parseIso(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** Today's calendar date in a given IANA time zone, e.g. 'America/Toronto'. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Hour (0–23) right now in a given IANA time zone. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/** How often the scheduled bank sync runs: every N hours counted from 5 AM; 0 = only by hand. */
export const SYNC_CHOICES = [
  { every: 24, label: 'Once a day', about: 'at 5 AM' },
  { every: 12, label: 'Twice a day', about: '5 AM and 5 PM' },
  { every: 6, label: 'Every 6 hours', about: '5 AM, 11 AM, 5 PM, 11 PM' },
  { every: 3, label: 'Every 3 hours', about: '' },
  { every: 1, label: 'Every hour', about: '' },
  { every: 0, label: 'Only when I tap Sync now', about: '' },
] as const;
/** Whether the hourly scheduled run should do the work at this local hour. No setting means once a day. */
export function syncDue(hour: number, every: number | null | undefined): boolean {
  const n = every == null ? 24 : every;
  if (!SYNC_CHOICES.some((c) => c.every === n) || n === 0) return n !== 0 && hour === 5;
  return (((hour - 5) % n) + n) % n === 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso: IsoDate): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/**
 * 2026-09-01, 2026/09/01, 09/01/2026 (month first), 9/1/26, 20 Sep 2026, Sep 20, 2026
 * → 'YYYY-MM-DD'; '' if not a date.
 */
export function toIsoDate(v: unknown): IsoDate | '' {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const month = (name: string) => MONTHS.findIndex((x) => x.toLowerCase() === name.slice(0, 3).toLowerCase()) + 1;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -](\d{4})$/); // 20 Sep 2026 (Amex)
  if (m && month(m[2])) return `${m[3]}-${String(month(m[2])).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/); // Sep 20, 2026
  if (m && month(m[1])) return `${m[3]}-${String(month(m[1])).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}
