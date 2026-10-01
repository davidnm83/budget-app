/**
 * Merges a manually tracked account (CSV / Fina history) into a bank-connected one, for when
 * the bank couldn't be matched automatically (no shared last 4 digits).
 *
 *   • a manual transaction with a bank twin (same amount, within 3 days) gives the bank row its
 *     category, merchant, notes, tags and reviewed state (unless you'd already reviewed the bank
 *     row), then goes away
 *   • imported split parts that add up to one bank transaction become its splits
 *   • everything else (older history) moves over as is
 *   • rules tied to the manual account move too; then the manual account is deleted
 */
import { addDays, planMerge } from '@budget-app/core';
import { supabase } from './supabase';

export interface MergeResult { linked: number; split: number; moved: number }

type Txn = {
  id: string; date: string; amount: number; name: string; merchant: string | null; category_id: string | null;
  category_source: string | null; notes: string | null; tags: string[]; reviewed: boolean; reviewed_at: string | null;
  is_transfer: boolean; import_id: string | null;
};

async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
const check = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message); };
const COLS = 'id, date, amount, name, merchant, category_id, category_source, notes, tags, reviewed, reviewed_at, is_transfer, import_id';

export async function mergeAccounts(manualId: string, bankId: string): Promise<MergeResult> {
  const manual = (await fetchAll<Txn>((a, b) => supabase.from('transactions').select(COLS).eq('account_id', manualId).order('id').range(a, b)))
    .map((t) => ({ ...t, amount: Number(t.amount) }));
  const result: MergeResult = { linked: 0, split: 0, moved: 0 };
  if (manual.length) {
    const dates = manual.map((t) => t.date).sort();
    const bank = (await fetchAll<Txn>((a, b) => supabase.from('transactions').select(COLS).eq('account_id', bankId)
      .gte('date', addDays(dates[0], -3)).lte('date', addDays(dates[dates.length - 1], 3)).order('id').range(a, b)))
      .map((t) => ({ ...t, amount: Number(t.amount) }));
    const plan = planMerge(manual, bank);
    const m = new Map(manual.map((t) => [t.id, t]));
    const b = new Map(bank.map((t) => [t.id, t]));
    // Which paired manual rows are themselves split (their parts move to the bank row).
    const splitOwners = new Set<string>();
    const paired = [...plan.pairs.keys()];
    for (let i = 0; i < paired.length; i += 150) {
      const { data } = await supabase.from('transaction_splits').select('transaction_id').in('transaction_id', paired.slice(i, i + 150));
      for (const s of data ?? []) splitOwners.add(s.transaction_id);
    }

    for (const [mid, bid] of plan.pairs) {
      const mine = m.get(mid)!, theirs = b.get(bid)!;
      const takeOver = !theirs.reviewed;
      if (takeOver && splitOwners.has(mid)) {
        check(await supabase.from('transaction_splits').delete().eq('transaction_id', bid));
        check(await supabase.from('transaction_splits').update({ transaction_id: bid }).eq('transaction_id', mid));
      }
      // Delete the manual row first: its import_id moves to the bank row and must stay unique.
      check(await supabase.from('transactions').delete().eq('id', mid));
      if (takeOver) {
        check(await supabase.from('transactions').update({
          merchant: mine.merchant ?? theirs.merchant, category_id: splitOwners.has(mid) ? null : mine.category_id,
          category_source: mine.category_source, notes: mine.notes, tags: mine.tags, is_transfer: mine.is_transfer,
          reviewed: mine.reviewed, reviewed_at: mine.reviewed_at, import_id: theirs.import_id ?? mine.import_id,
        }).eq('id', bid));
      } else if (!theirs.import_id && mine.import_id) {
        check(await supabase.from('transactions').update({ import_id: mine.import_id }).eq('id', bid));
      }
      result.linked++;
    }

    for (const g of plan.groups) {
      const parts = g.manualIds.map((id) => m.get(id)!);
      const theirs = b.get(g.bankId)!;
      check(await supabase.from('transactions').delete().in('id', g.manualIds)); // first, so import_ids stay unique
      if (!theirs.reviewed) {
        check(await supabase.from('transaction_splits').delete().eq('transaction_id', g.bankId));
        check(await supabase.from('transaction_splits').insert(parts.map((p) => ({ transaction_id: g.bankId, category_id: p.category_id, amount: p.amount, notes: p.notes }))));
        check(await supabase.from('transactions').update({
          merchant: parts.find((p) => p.merchant)?.merchant ?? theirs.merchant, category_id: null, category_source: 'manual',
          is_transfer: parts.every((p) => p.is_transfer), reviewed: parts.every((p) => p.reviewed), reviewed_at: parts[0].reviewed_at,
          import_id: parts.map((p) => p.import_id).filter(Boolean).join('\n') || theirs.import_id,
        }).eq('id', g.bankId));
      }
      result.split++;
    }

    for (let i = 0; i < plan.manualOnly.length; i += 200) {
      check(await supabase.from('transactions').update({ account_id: bankId }).in('id', plan.manualOnly.slice(i, i + 200)));
    }
    result.moved = plan.manualOnly.length;
  }
  check(await supabase.from('category_rules').update({ account_id: bankId }).eq('account_id', manualId));
  check(await supabase.from('accounts').delete().eq('id', manualId));
  return result;
}
