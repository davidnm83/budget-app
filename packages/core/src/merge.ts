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

/**
 * Pairs the two sides of transfers between your own accounts (TXN-8): money out of one account
 * and the same amount into another within `toleranceDays`. At least one side must already look
 * like a transfer (flagged, or in a transfer category); the closest date wins.
 */
export function pairTransfers(
  rows: { id: string; accountId: string; date: IsoDate; amount: number; transfer: boolean }[],
  toleranceDays = 3,
): [string, string][] {
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sorted.filter((x) => x.transfer && x.amount < 0)) {
    if (used.has(r.id)) continue;
    let best: (typeof rows)[number] | null = null;
    for (const o of sorted) {
      if (used.has(o.id) || o.id === r.id || o.accountId === r.accountId) continue;
      if (Math.abs(o.amount + r.amount) > 0.005) continue;
      const d = Math.abs(daysBetween(r.date, o.date));
      if (d > toleranceDays) continue;
      if (!best || d < Math.abs(daysBetween(r.date, best.date)) || (d === Math.abs(daysBetween(r.date, best.date)) && o.transfer && !best.transfer)) best = o;
    }
    if (best) { used.add(r.id); used.add(best.id); pairs.push([r.id, best.id]); }
  }
  // Money in flagged as a transfer whose other side wasn't flagged.
  for (const r of sorted.filter((x) => x.transfer && x.amount > 0 && !used.has(x.id))) {
    const o = sorted.find((x) => !used.has(x.id) && x.accountId !== r.accountId && Math.abs(x.amount + r.amount) <= 0.005 && Math.abs(daysBetween(r.date, x.date)) <= toleranceDays);
    if (o) { used.add(r.id); used.add(o.id); pairs.push([o.id, r.id]); }
  }
  return pairs;
}
