// Balance transfers between cards: loading and saving them, and linking their transactions (the
// credit on the old card, the charge and fee on the new one) once the banks list them. The two sides
// become a transfer pair under "Balance transfer", so they count as neither spending nor income;
// the fee stays a charge.
import { addDays, findTransferTxns, type BalanceTransfer } from '@budget-app/core';
import { isOffline } from './offline';
import { supabase } from './supabase';

export interface CardTransfer extends BalanceTransfer { closedOn: string | null }
export type TransferInput = Omit<CardTransfer, 'id'>;
const CATEGORY = 'Balance transfer';

const fromRow = (r: any): CardTransfer => ({
  id: r.id, fromAccountId: r.from_account_id, toAccountId: r.to_account_id, amount: Number(r.amount), fee: Number(r.fee ?? 0), date: r.date,
  promoApr: r.promo_apr == null ? null : Number(r.promo_apr), promoEnd: r.promo_end, outTxnId: r.out_transaction_id, inTxnId: r.in_transaction_id,
  feeTxnId: r.fee_transaction_id, closedOn: r.closed_on,
});
const toRow = (t: Partial<TransferInput>) => ({
  ...(t.fromAccountId !== undefined ? { from_account_id: t.fromAccountId } : {}), ...(t.toAccountId !== undefined ? { to_account_id: t.toAccountId } : {}),
  ...(t.amount !== undefined ? { amount: t.amount } : {}), ...(t.fee !== undefined ? { fee: t.fee } : {}), ...(t.date !== undefined ? { date: t.date } : {}),
  ...(t.promoApr !== undefined ? { promo_apr: t.promoApr } : {}), ...(t.promoEnd !== undefined ? { promo_end: t.promoEnd } : {}),
  ...(t.outTxnId !== undefined ? { out_transaction_id: t.outTxnId } : {}), ...(t.inTxnId !== undefined ? { in_transaction_id: t.inTxnId } : {}),
  ...(t.feeTxnId !== undefined ? { fee_transaction_id: t.feeTxnId } : {}), ...(t.closedOn !== undefined ? { closed_on: t.closedOn } : {}),
});
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

/** All transfers; none (quietly) before the migration has run. */
export async function loadTransfers(): Promise<CardTransfer[]> {
  const { data, error } = await supabase.from('balance_transfers').select('*').order('date', { ascending: false });
  if (error) return [];
  return (data ?? []).map(fromRow);
}

export async function saveTransfer(id: string | null, t: Partial<TransferInput>): Promise<string> {
  const res = id
    ? await supabase.from('balance_transfers').update(toRow(t)).eq('id', id).select('id').single()
    : await supabase.from('balance_transfers').insert(toRow(t)).select('id').single();
  fail(res.error);
  return res.data!.id;
}

export async function deleteTransfer(t: CardTransfer): Promise<void> {
  // Its two sides stop being a pair; they keep the category until you change it.
  for (const id of [t.outTxnId, t.inTxnId].filter(Boolean) as string[]) await supabase.from('transactions').update({ transfer_pair_id: null }).eq('id', id);
  fail((await supabase.from('balance_transfers').delete().eq('id', t.id)).error);
}

/** The transfer category its two sides go under. Made the first time it's needed. */
async function transferCategory(): Promise<string> {
  const { data } = await supabase.from('categories').select('id').eq('name', CATEGORY).maybeSingle();
  if (data) return data.id;
  const ins = await supabase.from('categories').insert({ name: CATEGORY, group_name: 'Transfers', kind: 'transfer', sort: 103 }).select('id').single();
  fail(ins.error);
  return ins.data!.id;
}

/** Files the two sides as a transfer pair under "Balance transfer". */
export async function fileTransferPair(outId: string | null | undefined, inId: string | null | undefined): Promise<void> {
  const cat = await transferCategory();
  for (const [a, b] of [[outId, inId], [inId, outId]] as const) {
    if (!a) continue;
    fail((await supabase.from('transactions').update({ category_id: cat, category_source: 'manual', is_transfer: true, transfer_pair_id: b ?? null }).eq('id', a)).error);
  }
}

/** Links the transactions of transfers that don't have them yet, as the banks list them. Safe to call often. */
export async function linkTransfers(list: CardTransfer[]): Promise<boolean> {
  if (isOffline()) return false;
  const open = list.filter((t) => !t.closedOn && (!t.outTxnId || !t.inTxnId || (t.fee > 0 && !t.feeTxnId)));
  if (!open.length) return false;
  const taken = new Set(list.flatMap((t) => [t.outTxnId, t.inTxnId, t.feeTxnId]).filter(Boolean) as string[]);
  const from = open.reduce((m, t) => (t.date < m ? t.date : m), '9999-12-31');
  const { data } = await supabase.from('transactions').select('id, account_id, date, amount')
    .in('account_id', [...new Set(open.flatMap((t) => [t.fromAccountId, t.toAccountId]))]).gte('date', addDays(from, -6)).eq('pending', false).limit(3000);
  const rows = ((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  let changed = false;
  for (const t of open) {
    const f = findTransferTxns(t, rows, taken);
    const next = { outTxnId: t.outTxnId ?? f.out?.id ?? null, inTxnId: t.inTxnId ?? f.into?.id ?? null, feeTxnId: t.feeTxnId ?? f.fee?.id ?? null };
    if (next.outTxnId === (t.outTxnId ?? null) && next.inTxnId === (t.inTxnId ?? null) && next.feeTxnId === (t.feeTxnId ?? null)) continue;
    await saveTransfer(t.id, next);
    if (next.outTxnId !== t.outTxnId || next.inTxnId !== t.inTxnId) await fileTransferPair(next.outTxnId, next.inTxnId);
    for (const id of Object.values(next)) if (id) taken.add(id);
    Object.assign(t, next);
    changed = true;
  }
  return changed;
}
