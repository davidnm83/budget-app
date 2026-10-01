/** Helpers for the Transactions tab: date presets, safe search text, and grouping by day. */
import { addDays, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';
import { addMonths, monthEnd, monthOf } from './budget.ts';

export type DatePreset = 'all' | 'month' | 'lastMonth' | '30d' | '90d' | 'year' | 'lastYear';

/** Inclusive date range for a preset, relative to `today` (YYYY-MM-DD). `null` ends mean open. */
export function datePresetRange(p: DatePreset, today: IsoDate): { from: IsoDate | null; to: IsoDate | null } {
  const month = monthOf(today);
  const year = today.slice(0, 4);
  switch (p) {
    case 'month': return { from: month, to: today };
    case 'lastMonth': { const m = addMonths(month, -1); return { from: m, to: monthEnd(m) }; }
    case '30d': return { from: addDays(today, -29), to: today };
    case '90d': return { from: addDays(today, -89), to: today };
    case 'year': return { from: `${year}-01-01`, to: today };
    case 'lastYear': return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` };
    default: return { from: null, to: null };
  }
}

/**
 * Search text safe to put inside a PostgREST `or=(…ilike.*text*…)` filter: the characters that
 * would break its syntax (commas, parentheses, quotes, wildcards, backslashes) become spaces.
 */
export function searchPattern(text: string): string | null {
  const s = text.replace(/[,()"'*%\\:]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? `*${s}*` : null;
}

export interface DayGroup<T> { date: IsoDate; total: number; data: T[] }

/** Consecutive rows with the same date become one section, with that day's net total. */
export function groupByDay<T extends { date: IsoDate; amount: number }>(rows: T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) { last.data.push(r); last.total = round2(last.total + Number(r.amount)); }
    else out.push({ date: r.date, total: round2(Number(r.amount)), data: [r] });
  }
  return out;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Today", "Yesterday", "Monday, September 28", or with the year when it isn't this year. */
export function dayHeading(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const d = new Date(date + 'T00:00:00Z');
  const base = `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return date.slice(0, 4) === today.slice(0, 4) ? base : `${base}, ${date.slice(0, 4)}`;
}
