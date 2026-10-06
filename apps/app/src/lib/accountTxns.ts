// Transactions for a set of accounts since a date (date and amount only), paged past 1000 rows.
import { supabase } from './supabase';

export type Row = { id: string; account_id: string; date: string; amount: number; name?: string };

export async function loadTxnsFor(ids: string[], from: string): Promise<Row[]> {
  const out: Row[] = [];
  if (!ids.length) return out;
  for (let p = 0; ; p += 1000) {
    const { data, error } = await supabase.from('transactions').select('id, account_id, date, amount, name').in('account_id', ids).gte('date', from).eq('pending', false).order('id').range(p, p + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((r: any) => ({ id: r.id, account_id: r.account_id, date: r.date, amount: Number(r.amount), name: r.name })));
    if (!data || data.length < 1000) break;
  }
  return out;
}

