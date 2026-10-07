// Money owed (IDEA-9). The part someone owes you is filed under the "Money owed" transfer category, so the
// budget and spending leave it out, with the person on that line: the transaction itself when all of it is
// owed, or one of its splits. What they owe is the line turned around: money you paid for them or lent them
// (money out) is owed to you; money they paid back (money in) counts against it.
import { round2 } from '@budget-app/core';
import { supabase } from './supabase';

export const OWED_CATEGORY = 'Money owed';

export interface Owed { person: string; balance: number; count: number; last: string; ids: string[] }

/** The "Money owed" category, made the first time it's needed. */
export async function owedCategory(): Promise<string> {
  const { data, error } = await supabase.from('categories').select('id').eq('name', OWED_CATEGORY).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.id;
  const made = await supabase.from('categories').insert({ name: OWED_CATEGORY, group_name: 'Transfers', kind: 'transfer', sort: 103 }).select('id').single();
  if (made.error) throw new Error(made.error.message);
  return made.data!.id;
}

/** Everyone with money owed, biggest first; settled people (balance 0) last. None before the migration. */
export async function loadOwed(): Promise<Owed[]> {
  const { data: cat } = await supabase.from('categories').select('id').eq('name', OWED_CATEGORY).maybeSingle();
  if (!cat) return [];
  const rows: { id: string; date: string; person: string; amount: number }[] = [];
  for (let p = 0; p < 10; p++) {
    const { data, error } = await supabase.from('transactions').select('id, date, iou_person, amount').eq('category_id', cat.id).not('iou_person', 'is', null).order('date').range(p * 1000, p * 1000 + 999);
    if (error) return [];
    rows.push(...((data ?? []) as any[]).map((r) => ({ id: r.id, date: r.date, person: r.iou_person, amount: Number(r.amount) })));
    if (!data || data.length < 1000) break;
  }
  for (let p = 0; p < 10; p++) {
    const { data, error } = await supabase.from('transaction_splits').select('transaction_id, iou_person, amount, transactions(date)').eq('category_id', cat.id).not('iou_person', 'is', null).order('id').range(p * 1000, p * 1000 + 999);
    if (error) return [];
    rows.push(...((data ?? []) as any[]).map((r) => ({ id: r.transaction_id, date: r.transactions?.date ?? '', person: r.iou_person, amount: Number(r.amount) })));
    if (!data || data.length < 1000) break;
  }
  const by = new Map<string, Owed>();
  for (const r of rows) {
    const o = by.get(r.person) ?? { person: r.person, balance: 0, count: 0, last: r.date, ids: [] };
    o.balance = round2(o.balance - r.amount); o.count++; o.last = r.date > o.last ? r.date : o.last; o.ids.push(r.id);
    by.set(r.person, o);
  }
  return [...by.values()].sort((a, b) => (Math.abs(b.balance) >= 0.01 ? 1 : 0) - (Math.abs(a.balance) >= 0.01 ? 1 : 0) || Math.abs(b.balance) - Math.abs(a.balance));
}
