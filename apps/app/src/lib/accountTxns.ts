// Transactions for a set of accounts since a date (date and amount only), paged past 1000 rows.
import { supabase } from './supabase';

export type Row = { id: string; account_id: string; date: string; amount: number; name?: string; importId?: string | null };

export async function loadTxnsFor(ids: string[], from: string): Promise<Row[]> {
  const out: Row[] = [];
  if (!ids.length) return out;
  for (let p = 0; ; p += 1000) {
    const { data, error } = await supabase.from('transactions').select('id, account_id, date, amount, name, import_id').in('account_id', ids).gte('date', from).eq('pending', false).order('id').range(p, p + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((r: any) => ({ id: r.id, account_id: r.account_id, date: r.date, amount: Number(r.amount), name: r.name, importId: r.import_id })));
    if (!data || data.length < 1000) break;
  }
  return out;
}


/**
 * What a card's own balance has in it besides its posted transactions, for working a statement back from that
 * balance: pending charges, and what the bank counted but hasn't listed yet (accounts.balance_gap, as one entry
 * dated today). When a bank leaves pending charges out of its balance, the gap cancels them, so either way
 * nothing recent is put on the last statement.
 */
export async function notPosted(accounts: { id: string; balance_gap?: number | string | null }[], today: string): Promise<Row[]> {
  if (!accounts.length) return [];
  const { data } = await supabase.from('transactions').select('id, account_id, date, amount, name').in('account_id', accounts.map((a) => a.id)).eq('pending', true);
  const pending = ((data ?? []) as any[]).map((r) => ({ id: r.id, account_id: r.account_id, date: r.date, amount: Number(r.amount), name: r.name }));
  const gaps = accounts.filter((a) => Math.abs(Number(a.balance_gap ?? 0)) >= 0.01)
    .map((a) => ({ id: `unlisted:${a.id}`, account_id: a.id, date: today, amount: Number(a.balance_gap), name: 'Counted by the bank, not listed yet' }));
  return [...pending, ...gaps];
}
