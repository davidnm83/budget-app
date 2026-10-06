// Money owed (IDEA-9): transactions marked with a person add up to what each one owes you (or you owe them).
import { round2 } from '@budget-app/core';
import { supabase } from './supabase';

export interface Owed { person: string; balance: number; count: number; last: string; ids: string[] }

/** Everyone with money owed, biggest first; settled people (balance 0) last. None before the migration. */
export async function loadOwed(): Promise<Owed[]> {
  const rows: { id: string; date: string; iou_person: string; iou_amount: number }[] = [];
  for (let p = 0; p < 10; p++) {
    const { data, error } = await supabase.from('transactions').select('id, date, iou_person, iou_amount').not('iou_person', 'is', null).order('date').range(p * 1000, p * 1000 + 999);
    if (error) return [];
    rows.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) break;
  }
  const by = new Map<string, Owed>();
  for (const r of rows) {
    const o = by.get(r.iou_person) ?? { person: r.iou_person, balance: 0, count: 0, last: r.date, ids: [] };
    o.balance = round2(o.balance + Number(r.iou_amount ?? 0)); o.count++; o.last = r.date > o.last ? r.date : o.last; o.ids.push(r.id);
    by.set(r.iou_person, o);
  }
  return [...by.values()].sort((a, b) => (Math.abs(b.balance) >= 0.01 ? 1 : 0) - (Math.abs(a.balance) >= 0.01 ? 1 : 0) || Math.abs(b.balance) - Math.abs(a.balance));
}
