/**
 * CSV import for accounts Plaid can't reach. Parsing and duplicate detection live in
 * @budget-app/core; this file loads what they need from the database and writes the rows
 * with the same merchant/category suggestions the bank sync uses.
 */
import {
  addDays, dedupeAgainstExisting, guessMerchant, merchantFor, suggestCategory,
  type CategoryRule, type CsvRow, type MerchantRule,
} from '@budget-app/core';
import { supabase } from './supabase';

const CARD_PAYMENT = /PAYMENT (RECEIVED|THANK YOU)|THANK YOU FOR YOUR PAYMENT|^PAYMENT\b|PAIEMENT/i;

/** Splits rows into new ones and ones the account already has (same amount within 3 days). */
export async function findDuplicates(accountId: string, rows: CsvRow[]) {
  if (!rows.length) return { add: [], duplicates: [] };
  const dates = rows.map((r) => r.date).sort();
  const { data, error } = await supabase.from('transactions').select('date, amount')
    .eq('account_id', accountId)
    .gte('date', addDays(dates[0], -3))
    .lte('date', addDays(dates[dates.length - 1], 3))
    .limit(10000);
  if (error) throw new Error(error.message);
  return dedupeAgainstExisting(rows, (data ?? []).map((r) => ({ date: r.date, amount: Number(r.amount) })));
}

export async function importRows(account: { id: string; type: string | null }, rows: CsvRow[]): Promise<number> {
  if (!rows.length) return 0;
  const [m, c, cats] = await Promise.all([
    supabase.from('merchant_rules').select('match, merchant'),
    supabase.from('category_rules').select('match_text, category_id, account_id, min_amount, max_amount'),
    supabase.from('categories').select('id, name, kind'),
  ]);
  const err = m.error ?? c.error ?? cats.error;
  if (err) throw new Error(err.message);
  const merchantRules = (m.data ?? []) as MerchantRule[];
  const categoryRules: CategoryRule[] = (c.data ?? []).map((r: any) => ({
    matchText: r.match_text, categoryId: r.category_id, accountId: r.account_id, minAmount: r.min_amount, maxAmount: r.max_amount,
  }));
  const kindById = new Map((cats.data ?? []).map((r: any) => [r.id as string, r.kind as string]));
  const cardPaymentId = (cats.data ?? []).find((r: any) => r.kind === 'transfer' && /^credit card payment$/i.test(r.name))?.id ?? null;

  const withMerchant = rows.map((r) => ({ r, merchant: r.merchant || merchantFor(merchantRules, r.name) || guessMerchant(r.name) }));
  // A budgeting app's export says what you filed each one under: a category with the same name here is used
  // as it is (and the row counts as reviewed); the rest get the usual suggestions.
  const byName = categoryNames(cats.data ?? []);

  // The category you used most recently for each merchant (from reviewed transactions).
  const learned: Record<string, string> = {};
  const merchants = [...new Set(withMerchant.map((x) => x.merchant).filter(Boolean))];
  for (let i = 0; i < merchants.length; i += 100) {
    const { data } = await supabase.from('transactions').select('merchant, category_id')
      .eq('reviewed', true).not('category_id', 'is', null)
      .in('merchant', merchants.slice(i, i + 100))
      .order('date', { ascending: false }).limit(2000);
    for (const r of data ?? []) learned[String(r.merchant).toLowerCase()] ??= r.category_id;
  }

  const inserts = withMerchant.map(({ r, merchant }) => {
    const own = r.category ? byName.get(r.category.trim().toLowerCase()) ?? null : null;
    let s: { categoryId: string | null; source: string | null } = own ? { categoryId: own, source: 'manual' }
      : suggestCategory({ name: r.name, merchant, amount: r.amount, accountId: account.id }, categoryRules, learned);
    const isCardPayment = account.type === 'credit' && r.amount > 0 && CARD_PAYMENT.test(r.name);
    if (!s.categoryId && isCardPayment && cardPaymentId) s = { categoryId: cardPaymentId, source: 'rule' };
    // Marked a transfer in the file but with no category of yours to say so: kept a transfer, and a
    // suggested spending category isn't used.
    if (!own && r.transfer && s.categoryId && kindById.get(s.categoryId) !== 'transfer') s = { categoryId: null, source: null };
    return {
      account_id: account.id,
      source: 'csv',
      date: r.date,
      amount: r.amount,
      name: r.name,
      merchant: merchant || null,
      category_id: s.categoryId,
      category_source: s.source,
      is_transfer: s.categoryId ? kindById.get(s.categoryId) === 'transfer' : isCardPayment || !!r.transfer,
      ...(r.notes ? { notes: r.notes } : {}),
      ...(r.tags?.length ? { tags: r.tags } : {}),
      reviewed: !!own,
      ...(own ? { reviewed_at: new Date().toISOString() } : {}),
    };
  });
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from('transactions').insert(inserts.slice(i, i + 500));
    if (error) throw new Error('Saving transactions failed: ' + error.message);
  }
  return inserts.length;
}

/** Your categories by lower-case name. */
function categoryNames(cats: { id: string; name: string }[]): Map<string, string> {
  return new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id]));
}

/** The categories a file names, split into those you have (by name) and those you don't, most used first. */
export async function fileCategories(rows: CsvRow[]): Promise<{ matched: number; missing: { name: string; count: number }[] } | null> {
  const named = rows.filter((r) => r.category);
  if (!named.length) return null;
  const { data, error } = await supabase.from('categories').select('id, name');
  if (error) throw new Error(error.message);
  const have = categoryNames((data ?? []) as any[]);
  const missing = new Map<string, number>();
  let matched = 0;
  for (const r of named) {
    if (have.has(r.category!.trim().toLowerCase())) matched++;
    else missing.set(r.category!.trim(), (missing.get(r.category!.trim()) ?? 0) + 1);
  }
  return { matched, missing: [...missing.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
}
