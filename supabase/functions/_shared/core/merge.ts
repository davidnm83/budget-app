// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Lining up a manually tracked account's transactions (CSV or Fina imports) with the same
 * account's bank transactions, used when the bank gets connected later and when you merge two
 * accounts yourself.
 *
 *   1. One to one: same amount, dates no more than `toleranceDays` apart, closest date wins,
 *      each bank transaction used once.
 *   2. Splits: imported rows that share a date and description (how Fina exports a split) and
 *      together add up to one remaining bank transaction become that transaction's split parts.
 *
 * Anything left on the manual side has no bank twin (older than the bank's history, or cash);
 * anything left on the bank side is new.
 */
import { daysBetween, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';

export interface MergeRow { id: string; date: IsoDate; amount: number; name: string }

export interface MergePlan {
  pairs: Map<string, string>;                    // manual id → bank id
  groups: { bankId: string; manualIds: string[] }[];
  manualOnly: string[];
  bankOnly: string[];
}

export function planMerge(manual: MergeRow[], bank: MergeRow[], toleranceDays = 3): MergePlan {
  const used = new Set<string>();
  const closest = (date: IsoDate, amount: number) => {
    let best: MergeRow | null = null;
    for (const b of bank) {
      if (used.has(b.id) || Math.abs(b.amount - amount) > 0.005) continue;
      const d = Math.abs(daysBetween(b.date, date));
      if (d <= toleranceDays && (!best || d < Math.abs(daysBetween(best.date, date)))) best = b;
    }
    return best;
  };

  const pairs = new Map<string, string>();
  for (const m of [...manual].sort((a, b) => a.date.localeCompare(b.date))) {
    const b = closest(m.date, m.amount);
    if (b) { used.add(b.id); pairs.set(m.id, b.id); }
  }

  const groups: MergePlan['groups'] = [];
  const byKey = new Map<string, MergeRow[]>();
  for (const m of manual) {
    if (pairs.has(m.id)) continue;
    const k = `${m.date}|${m.name.trim().toUpperCase()}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(m);
  }
  for (const g of byKey.values()) {
    if (g.length < 2) continue;
    const b = closest(g[0].date, round2(g.reduce((s, m) => s + m.amount, 0)));
    if (b) { used.add(b.id); groups.push({ bankId: b.id, manualIds: g.map((m) => m.id) }); }
  }

  const grouped = new Set(groups.flatMap((g) => g.manualIds));
  return {
    pairs,
    groups,
    manualOnly: manual.filter((m) => !pairs.has(m.id) && !grouped.has(m.id)).map((m) => m.id),
    bankOnly: bank.filter((b) => !used.has(b.id)).map((b) => b.id),
  };
}

/** Last 4 digits of two masks match ("32009" and "2009" do), and the account types are the same. */
export function sameAccount(a: { mask: string | null; type: string | null }, b: { mask: string | null; type: string | null }): boolean {
  const last4 = (m: string | null) => (m ?? '').replace(/\D/g, '').slice(-4);
  return !!last4(a.mask) && last4(a.mask).length === 4 && last4(a.mask) === last4(b.mask) && (a.type ?? '') === (b.type ?? '');
}
