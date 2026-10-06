/** Pairs both sides of recent transfers between your own accounts (TXN-8); see core pairTransfers. */
import type { Admin } from './supabase.ts';
import { addDays, pairTransfers } from './core/index.ts';

export async function pairRecentTransfers(admin: Admin, userId: string, today: string, days = 60): Promise<number> {
  const { data: rows } = await admin.from('transactions').select('id, account_id, date, amount, is_transfer, category_id, transfer_pair_id')
    .eq('user_id', userId).gte('date', addDays(today, -days)).is('transfer_pair_id', null);
  const { data: cats } = await admin.from('categories').select('id, kind').eq('user_id', userId);
  const transferCats = new Set((cats ?? []).filter((c: any) => c.kind === 'transfer').map((c: any) => c.id));
  const list = (rows ?? []) as any[];
  const pairs = pairTransfers(list
    // A row in a spending or income category isn't a transfer, whatever the bank hinted; it never pairs.
    .filter((r) => !r.category_id || transferCats.has(r.category_id))
    .map((r) => ({ id: r.id, accountId: r.account_id, date: r.date, amount: Number(r.amount), transfer: r.category_id ? true : r.is_transfer })));
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const [a, b] of pairs) {
    const ra = byId.get(a), rb = byId.get(b);
    // The side without a category takes the other side's transfer category (e.g. Credit card payment).
    const cat = ra.category_id && transferCats.has(ra.category_id) ? ra.category_id : rb.category_id && transferCats.has(rb.category_id) ? rb.category_id : null;
    await admin.from('transactions').update({ transfer_pair_id: b, is_transfer: true, ...(ra.category_id ? {} : cat ? { category_id: cat, category_source: 'rule' } : {}) }).eq('id', a);
    await admin.from('transactions').update({ transfer_pair_id: a, is_transfer: true, ...(rb.category_id ? {} : cat ? { category_id: cat, category_source: 'rule' } : {}) }).eq('id', b);
  }
  return pairs.length;
}
