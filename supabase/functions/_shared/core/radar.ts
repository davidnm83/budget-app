// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Radar: small checks over data the app already has, each producing at most a few cards for Home.
 * A card says what needs attention, with the number that matters, and where to go.
 *
 * Every card has an `id` built from what it is about (an account and a date, a bill's due date, a
 * category and a month). Dismissing a card hides that id; when the facts change (a new date, a
 * new month, spending moving up a step) the id changes and the card can come back.
 */
import { addDays, shortDate, type IsoDate } from './dates.ts';
import { formatMoney } from './money.ts';
import type { BudgetLine } from './budget.ts';
import type { WeekRow, WeekWarning } from './planner.ts';

export type RadarSeverity = 'act' | 'heads' | 'info';
export type RadarCheck = 'buffer' | 'bill' | 'pace' | 'unusual';
export interface RadarCard { id: string; check: RadarCheck; severity: RadarSeverity; title: string; text: string; stake: number; href: string }

/** When a check speaks up. Kept in one place so they can become settings later. */
export const RADAR_LIMITS = {
  lateDays: 2,          // a planned bill is "late" this many days after its date with nothing matching
  changedPct: 0.05,     // a bill "changed" when the posted amount is this far from the plan…
  changedMin: 2,        // …and by at least this much
  aheadPct: 0.2,        // "running ahead": this share of the budget beyond an even pace…
  aheadMin: 25,         // …and at least this much
  aheadFrom: 0.15,      // …once this share of the month has gone
  unusualRatio: 1.5,    // "unusual": this many times the 3-month average…
  unusualMin: 40,       // …and at least this much above it
};

const money = (n: number) => formatMoney(Math.round(Math.abs(n))).replace(/\.00$/, '');
const signed = (n: number) => (n < 0 ? '−' : '') + money(n);

/** A planned debit would take an account below its buffer (from the planner's 4-week look-ahead). */
export function radarBuffer(warnings: WeekWarning[], accountName: (id: string) => string, today: IsoDate): RadarCard[] {
  const first = new Map<string, WeekWarning>();
  for (const w of [...warnings].sort((a, b) => a.date.localeCompare(b.date))) if (!first.has(w.accountId)) first.set(w.accountId, w);
  return [...first.values()].map((w) => ({
    id: `buffer:${w.accountId}:${w.date}`, check: 'buffer' as const,
    severity: w.balance < 0 || w.date <= addDays(today, 7) ? 'act' as const : 'heads' as const,
    title: `${accountName(w.accountId)} drops to ${signed(w.balance)} on ${shortDate(w.date)}`,
    text: `After “${w.cause}”. ${w.buffer > 0 ? `You keep ${money(w.buffer)} there as a buffer.` : 'That is below zero.'}`,
    stake: w.buffer - w.balance, href: '/planner',
  }));
}

/** Bills and income from the plan that didn't arrive, or arrived at a different amount. */
export function radarBills(rows: WeekRow[], today: IsoDate): RadarCard[] {
  const out: RadarCard[] = [];
  const L = RADAR_LIMITS;
  for (const r of rows) {
    if (r.kind !== 'planned' || !r.item || r.item.transfer || r.planned == null) continue;
    const what = r.planned > 0 ? 'income' : 'bill';
    if (!r.txn && r.date < addDays(today, -L.lateDays)) {
      out.push({ id: `late:${r.item.key}`, check: 'bill', severity: 'heads', stake: Math.abs(r.planned), href: '/planner',
        title: `${r.description} hasn’t ${r.planned > 0 ? 'arrived' : 'posted'}`,
        text: `Planned for ${shortDate(r.date)}, ${money(r.planned)}. If it was paid another way, match it or skip this one in the planner.` });
    } else if (r.txn && !r.item.estimated && r.actual != null) {
      const diff = Math.abs(r.actual) - Math.abs(r.planned);
      if (Math.abs(diff) >= Math.max(L.changedMin, Math.abs(r.planned) * L.changedPct)) {
        out.push({ id: `changed:${r.item.key}:${Math.round(Math.abs(r.actual))}`, check: 'bill', severity: diff > 0 && what === 'bill' ? 'heads' : 'info', stake: Math.abs(diff), href: '/planner',
          title: `${r.description} was ${money(r.actual)}, not ${money(r.planned)}`,
          text: `${money(diff)} ${diff > 0 ? 'more' : 'less'} than planned on ${shortDate(r.txn.date)}. If that’s the new amount, update the ${what}.` });
      }
    }
  }
  return out;
}

/** Budget lines that are over, or well ahead of an even pace through the month. `pace` is 0–1. */
export function radarPace(lines: BudgetLine[], pace: number, month: string): RadarCard[] {
  const out: RadarCard[] = [];
  const L = RADAR_LIMITS;
  for (const l of lines) {
    if (l.kind !== 'expense' || l.available <= 0) continue;
    if (l.actual > l.available + 0.5) {
      out.push({ id: `over:${l.key}:${month}`, check: 'pace', severity: 'heads', stake: l.actual - l.available, href: '/budget',
        title: `${l.label} is over budget by ${money(l.actual - l.available)}`,
        text: `${money(l.actual)} spent of ${money(l.available)} this month.` });
    } else {
      const gap = l.actual - l.available * pace;
      // Not in the first days of a month (everything looks ahead then), and not for a line that is simply
      // used up exactly, like rent paid on the 1st: that is done, not running ahead.
      if (pace >= L.aheadFrom && pace < 0.9 && l.actual < l.available * 0.98 && gap >= Math.max(L.aheadMin, l.available * L.aheadPct)) {
        out.push({ id: `ahead:${l.key}:${month}`, check: 'pace', severity: 'info', stake: gap, href: '/budget',
          title: `${l.label} is running ahead of its budget`,
          text: `${Math.round((l.actual / l.available) * 100)}% spent with ${Math.round(pace * 100)}% of the month gone; ${money(l.available - l.actual)} left.` });
      }
    }
  }
  return out;
}

/** Categories where this month already beats the usual month by a wide margin. */
export function radarUnusual(
  cats: { id: string; name: string; kind: string }[], thisMonth: Map<string, number>, earlier: Map<string, number>[], month: string, daysLeft: number,
): RadarCard[] {
  // With less than two earlier months that have any spending, there is no "usual" yet.
  if (earlier.filter((m) => [...m.values()].some((v) => v > 0)).length < 2) return [];
  const out: RadarCard[] = [];
  const L = RADAR_LIMITS;
  for (const c of cats) {
    if (c.kind !== 'expense') continue;
    const cur = thisMonth.get(c.id) ?? 0;
    const avg = earlier.reduce((s, m) => s + Math.max(0, m.get(c.id) ?? 0), 0) / earlier.length;
    if (avg <= 0 || cur < avg * L.unusualRatio || cur - avg < L.unusualMin) continue;
    out.push({ id: `unusual:${c.id}:${month}:${Math.floor((cur / avg) * 2)}`, check: 'unusual', severity: 'info', stake: cur - avg, href: '/budget',
      title: `${c.name} is ${money(cur)} this month, usually ${money(avg)}`,
      text: `${Math.round((cur / avg - 1) * 100)}% above your ${earlier.length}-month average${daysLeft > 0 ? `, with ${daysLeft} day${daysLeft === 1 ? '' : 's'} to go` : ''}.` });
  }
  return out;
}

const RANK: Record<RadarSeverity, number> = { act: 0, heads: 1, info: 2 };
/** Most urgent first, then the most money at stake; dismissed ids removed. */
export function rankRadar(cards: RadarCard[], dismissed: Iterable<string> = []): RadarCard[] {
  const gone = new Set(dismissed);
  const seen = new Set<string>();
  return cards.filter((c) => !gone.has(c.id) && !seen.has(c.id) && seen.add(c.id)).sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.stake - a.stake);
}
