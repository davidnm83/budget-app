// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Recurring bills and income: due dates from a schedule, matching a due date to the transaction
 * that paid it, and spotting likely recurring charges in your history.
 */
import { addDays, daysBetween, parseIso, toIso, type IsoDate } from './dates.ts';
import { normalizeDescription } from './merchants.ts';
import { round2 } from './money.ts';

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface Recurring {
  id: string;
  name: string;
  kind: 'bill' | 'income';
  amount: number;          // app sign: bills negative
  estimated: boolean;
  frequency: Frequency;
  start_date: IsoDate;
  end_date: IsoDate | null;
  account_id: string | null;
  category_id: string | null;
  match_text: string | null;
  active: boolean;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Due dates of a schedule between `from` and `to` (inclusive), never before its start or after its end. */
export function occurrences(r: Pick<Recurring, 'frequency' | 'start_date' | 'end_date'>, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const lo = from > r.start_date ? from : r.start_date;
  const hi = r.end_date && r.end_date < to ? r.end_date : to;
  if (lo > hi) return out;
  if (r.frequency === 'weekly' || r.frequency === 'biweekly') {
    const step = r.frequency === 'weekly' ? 7 : 14;
    const k = Math.max(0, Math.ceil(daysBetween(r.start_date, lo) / step));
    for (let d = addDays(r.start_date, k * step); d <= hi; d = addDays(d, step)) out.push(d);
    return out;
  }
  const start = parseIso(r.start_date);
  const day = start.getUTCDate();
  const months = r.frequency === 'monthly' ? 1 : 12;
  let y = parseIso(lo).getUTCFullYear();
  let m = r.frequency === 'monthly' ? parseIso(lo).getUTCMonth() : start.getUTCMonth();
  if (r.frequency === 'yearly' && toIso(new Date(Date.UTC(y, m, Math.min(day, lastDayOfMonth(y, m))))) < lo) y++;
  for (;;) {
    const d = toIso(new Date(Date.UTC(y, m, Math.min(day, lastDayOfMonth(y, m)))));
    if (d > hi) break;
    if (d >= lo) out.push(d);
    m += months;
    if (m > 11) { y += Math.floor(m / 12); m %= 12; }
  }
  return out;
}

export interface Due { key: string; date: IsoDate; amount: number; accountId: string | null; matchText: string | null; estimated: boolean }
export interface PostedTxn { id: string; date: IsoDate; amount: number; accountId: string; name: string; merchant: string | null }

/** Is `actual` close enough to the expected amount? Fixed: within $1 or 5%. Estimated: within 35%. */
export function amountMatches(expected: number, actual: number, estimated: boolean): boolean {
  if (Math.sign(expected) !== Math.sign(actual) && expected !== 0) return false;
  const diff = Math.abs(actual - expected);
  return estimated ? diff <= Math.abs(expected) * 0.35 + 1 : diff <= Math.max(1, Math.abs(expected) * 0.05);
}

/**
 * Pairs due dates with the transactions that paid them: same account (when the due has one),
 * the match text in the description or merchant (when set), amount close enough, date within
 * `toleranceDays`. Best candidate first (text match, then closest date, then closest amount);
 * each transaction pays one due date.
 */
export function matchDues(dues: Due[], txns: PostedTxn[], toleranceDays = 4): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const d of [...dues].sort((a, b) => a.date.localeCompare(b.date))) {
    const needle = d.matchText ? normalizeDescription(d.matchText) : '';
    let best: { t: PostedTxn; score: number } | null = null;
    for (const t of txns) {
      if (used.has(t.id)) continue;
      if (d.accountId && t.accountId !== d.accountId) continue;
      const days = Math.abs(daysBetween(d.date, t.date));
      if (days > toleranceDays || !amountMatches(d.amount, t.amount, d.estimated)) continue;
      const hay = normalizeDescription(`${t.merchant ?? ''} ${t.name}`);
      const text = needle ? hay.includes(needle) : false;
      if (needle && !text) continue;
      const score = days * 10 + Math.abs(t.amount - d.amount) / Math.max(1, Math.abs(d.amount));
      if (!best || score < best.score) best = { t, score };
    }
    if (best) { used.add(best.t.id); out.set(d.key, best.t.id); }
  }
  return out;
}

/**
 * BIL-7: for due dates nothing matched, looks for a payment that is clearly the same bill but
 * for a different amount (an insurance renewal, a price rise). Needs the bill's match text, so
 * it can't mistake an unrelated payment for it; same account and date window as matchDues.
 * Returns due key → transaction id.
 */
export function matchChanged(dues: Due[], txns: PostedTxn[], matched: Map<string, string>, toleranceDays = 4): Map<string, string> {
  const used = new Set(matched.values());
  const out = new Map<string, string>();
  for (const d of [...dues].sort((a, b) => a.date.localeCompare(b.date))) {
    if (matched.has(d.key) || !d.matchText) continue;
    const needle = normalizeDescription(d.matchText);
    if (!needle) continue;
    let best: { t: PostedTxn; days: number } | null = null;
    for (const t of txns) {
      if (used.has(t.id) || (d.accountId && t.accountId !== d.accountId)) continue;
      if (d.amount !== 0 && Math.sign(t.amount) !== Math.sign(d.amount)) continue;
      const days = Math.abs(daysBetween(d.date, t.date));
      if (days > toleranceDays || !normalizeDescription(`${t.merchant ?? ''} ${t.name}`).includes(needle)) continue;
      if (!best || days < best.days) best = { t, days };
    }
    if (best) { used.add(best.t.id); out.set(d.key, best.t.id); }
  }
  return out;
}

export interface RecurringSuggestion {
  name: string;
  kind: 'bill' | 'income';
  amount: number;
  estimated: boolean;
  frequency: Frequency;
  start_date: IsoDate;     // the last time it happened; the schedule continues from there
  account_id: string;
  category_id: string | null;
  match_text: string;
  seen: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/**
 * Likely recurring bills and income in the last `months` months: the same merchant on the same
 * account, at least 3 times (2 for yearly), at a steady interval, with steady amounts.
 */
export function detectRecurring(
  txns: { date: IsoDate; amount: number; merchant: string | null; name: string; account_id: string; category_id: string | null }[],
  today: IsoDate,
): RecurringSuggestion[] {
  const groups = new Map<string, typeof txns>();
  for (const t of txns) {
    const who = (t.merchant || normalizeDescription(t.name).split(' ').slice(0, 3).join(' ')).trim();
    if (!who) continue;
    const key = `${t.account_id}|${who.toLowerCase()}|${t.amount < 0 ? 'out' : 'in'}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: RecurringSuggestion[] = [];
  for (const list of groups.values()) {
    const rows = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) continue;
    const gaps = rows.slice(1).map((r, i) => daysBetween(rows[i].date, r.date)).filter((g) => g > 0);
    if (!gaps.length) continue;
    const g = median(gaps);
    const frequency: Frequency | null = g >= 6 && g <= 8 ? 'weekly' : g >= 12 && g <= 16 ? 'biweekly' : g >= 26 && g <= 35 ? 'monthly' : g >= 350 && g <= 380 ? 'yearly' : null;
    if (!frequency || rows.length < (frequency === 'yearly' ? 2 : 3)) continue;
    // Most gaps should agree with the median (allow a missed or doubled month here and there).
    const steady = gaps.filter((x) => Math.abs(x - g) <= Math.max(3, g * 0.2)).length / gaps.length;
    if (steady < 0.6) continue;
    const last = rows[rows.length - 1];
    if (daysBetween(last.date, today) > g * 2 + 5) continue; // stopped
    const amounts = rows.slice(-6).map((r) => Math.abs(r.amount));
    const lo = Math.min(...amounts), hi = Math.max(...amounts);
    if (hi > lo * 2.5) continue;
    const who = last.merchant || normalizeDescription(last.name).split(' ').slice(0, 3).join(' ');
    out.push({
      name: who,
      kind: last.amount < 0 ? 'bill' : 'income',
      amount: round2(Math.sign(last.amount) * median(amounts)),
      estimated: hi > lo * 1.05 + 1,
      frequency,
      start_date: last.date,
      account_id: last.account_id,
      category_id: last.category_id,
      match_text: normalizeDescription(last.merchant || last.name).split(' ').slice(0, 2).join(' '),
      seen: rows.length,
    });
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}
