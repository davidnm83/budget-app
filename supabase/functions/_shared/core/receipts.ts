// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
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
