/**
 * Receipts (TXN-13): a photo kept with the amount and date you typed (if any), waiting for the
 * transaction it belongs to. When transactions sync, likely matches are suggested; you confirm.
 */
import { daysBetween, type IsoDate } from './dates.ts';
import { normalizeDescription } from './merchants.ts';

export interface ReceiptFacts { id: string; amount: number | null; date: IsoDate | null; merchant: string | null }
export interface TxnFacts { id: string; date: IsoDate; amount: number; name: string; merchant: string | null }
export interface ReceiptMatch { txnId: string; sure: boolean; why: string }

/** Days a card purchase can take to post after the receipt's date (and one before, for time zones). */
export const POST_DAYS = 5;

const words = (s: string | null | undefined) => new Set(normalizeDescription(s ?? '').split(' ').filter((w) => w.length >= 3));
function sameStore(r: ReceiptFacts, t: TxnFacts): boolean {
  const a = words(r.merchant);
  if (!a.size) return false;
  for (const w of words(`${t.merchant ?? ''} ${t.name}`)) if (a.has(w)) return true;
  return false;
}

/**
 * Transactions a receipt probably belongs to, best first (at most `limit`).
 * - Same amount (to the cent), dated from a day before to POST_DAYS after: a sure match.
 * - Same store and up to 25% more (a tip added afterwards), same window: a likely one.
 * - No amount typed: same store in the window.
 * Transactions in `taken` (already have a receipt) are skipped. Spending only (negative amounts).
 */
export function receiptMatches(r: ReceiptFacts, txns: TxnFacts[], taken: Set<string> = new Set(), limit = 3): ReceiptMatch[] {
  const out: (ReceiptMatch & { score: number })[] = [];
  for (const t of txns) {
    if (taken.has(t.id) || t.amount >= 0) continue;
    if (r.date) {
      const d = daysBetween(r.date, t.date);
      if (d < -1 || d > POST_DAYS) continue;
    }
    const spent = -t.amount;
    const store = sameStore(r, t);
    const near = r.date ? Math.abs(daysBetween(r.date, t.date)) : 0;
    if (r.amount != null && r.amount > 0) {
      if (Math.abs(spent - r.amount) < 0.015) out.push({ txnId: t.id, sure: true, why: store ? 'Same store and amount' : 'Same amount', score: 100 - near + (store ? 10 : 0) });
      else if (store && spent > r.amount && spent <= r.amount * 1.25 + 0.01) out.push({ txnId: t.id, sure: false, why: `Same store, ${Math.round((spent / r.amount - 1) * 100)}% more (a tip?)`, score: 60 - near });
    } else if (store && r.date) out.push({ txnId: t.id, sure: false, why: 'Same store, close date', score: 40 - near });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _s, ...m }) => m);
}

/** What reading a receipt photo gives back (see supabase/functions/_shared/ai.ts). Amounts are positive; discounts are negative items. */
export interface ReadReceipt {
  merchant: string | null; date: IsoDate | null;
  /** What the items and tax come to, before any points were redeemed. */
  total: number | null; tax: number | null;
  items: { name: string; amount: number }[];
  /** Points or loyalty rewards used to pay part of it (PC Optimum, Scene+…), positive: not charged to the card. */
  redeemed: { name: string; amount: number }[];
  /** The model could read the receipt clearly. */
  legible: boolean;
}

/**
 * Whether a reading can be trusted as it is: there's a total and a store, and when line items were read
 * they (with the tax) come to the total, within a few cents for rounding. A reading that fails this is
 * read again by the stronger model.
 */
export function receiptAddsUp(r: ReadReceipt): boolean {
  if (r.redeemed.some((x) => !(x.amount > 0)) || (r.total != null && r.redeemed.reduce((s, x) => s + x.amount, 0) > r.total + 0.005)) return false;
  if (!r.legible || r.total == null || !(r.total > 0) || !r.merchant?.trim()) return false;
  if (!r.items.length) return true;
  const sum = r.items.reduce((s, i) => s + i.amount, 0) + (r.tax ?? 0);
  return Math.abs(sum - r.total) <= 0.05;
}

/** What was charged: the total less the points redeemed. */
export function receiptPaid(r: Pick<ReadReceipt, 'total' | 'redeemed'>): number | null {
  return r.total == null ? null : Math.round((r.total - r.redeemed.reduce((s, x) => s + x.amount, 0)) * 100) / 100;
}

/**
 * Points redeemed recorded as rewards: the purchase's category gets its full value and a rewards line gives the
 * redeemed amount back, so the parts still add up to what the bank charged (`amount`, negative for spending).
 */
export function rewardsSplit(amount: number, redeemed: number, categoryId: string | null, rewardsId: string): { category_id: string | null; amount: number }[] {
  return [{ category_id: categoryId, amount: Math.round((amount - redeemed) * 100) / 100 }, { category_id: rewardsId, amount: Math.round(redeemed * 100) / 100 }];
}
