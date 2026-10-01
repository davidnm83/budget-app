// Pairs both sides of transfers across all history (TXN-8). The daily sync does the last 60 days;
// this runs after an import, when older history arrives.
import { pairTransfers } from '@budget-app/core';
import { supabase } from './supabase';

export async function pairAllTransfers(): Promise<number> {
  const rows: any[] = [];
  for (let p = 0; ; p += 1000) {
    const { data, error } = await supabase.from('transactions').select('id, account_id, date, amount, is_transfer, category_id')
      .is('transfer_pair_id', null).order('id').range(p, p + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: cats } = await supabase.from('categories').select('id, kind');
  const transferCats = new Set((cats ?? []).filter((c) => c.kind === 'transfer').map((c) => c.id));
  const pairs = pairTransfers(rows.map((r) => ({ id: r.id, accountId: r.account_id, date: r.date, amount: Number(r.amount), transfer: r.is_transfer || transferCats.has(r.category_id) })));
  for (const [a, b] of pairs) {
    await supabase.from('transactions').update({ transfer_pair_id: b, is_transfer: true }).eq('id', a);
    await supabase.from('transactions').update({ transfer_pair_id: a, is_transfer: true }).eq('id', b);
  }
  return pairs.length;
}
