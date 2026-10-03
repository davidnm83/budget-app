// Data for the Budget and Reports tabs. Totals come from the report_* database functions,
// which add up transactions (and split parts) per category, month or merchant.
import { addMonths, type BudgetCategory, type BudgetRow, type CategoryKind, type Month, type MonthTotals } from '@budget-app/core';
import { supabase } from './supabase';

export interface Category extends BudgetCategory { hidden: boolean; sort: number; icon: string | null }
export interface Budget extends BudgetRow { id: string; month: Month }
export interface CategoryMonth { month: Month; category_id: string | null; kind: CategoryKind; total: number; txns: number }

export async function loadCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, name, group_name, kind, is_hidden, sort, icon').order('sort').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, group: c.group_name, kind: c.kind, hidden: c.is_hidden, sort: c.sort, icon: c.icon ?? null }));
}

export async function loadBudgets(): Promise<Budget[]> {
  const { data, error } = await supabase.from('budgets').select('id, month, category_id, group_name, amount, rollover').order('month');
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({ id: b.id, month: b.month, categoryId: b.category_id, groupName: b.group_name, amount: Number(b.amount), rollover: b.rollover }));
}

/** Per-category totals for every month from `from` to `to` (inclusive), fetched 6 months at a time. */
export async function loadCategoryMonths(from: Month, to: Month): Promise<CategoryMonth[]> {
  const chunks: [Month, Month][] = [];
  for (let m = from; m <= to; m = addMonths(m, 6)) {
    const end = addMonths(m, 6) <= addMonths(to, 1) ? addMonths(m, 6) : addMonths(to, 1);
    chunks.push([m, end]);
  }
  const parts = await Promise.all(chunks.map(async ([a, b]) => {
    const { data, error } = await supabase.rpc('report_category_months', { p_from: a, p_to: dayBefore(b) });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  }));
  return parts.flat().map((r) => ({ month: r.month, category_id: r.category_id, kind: r.kind, total: Number(r.total), txns: Number(r.txns) }));
}

function dayBefore(month: Month): string {
  const d = new Date(month + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function totalsFor(rows: CategoryMonth[], months: Month | Month[]): MonthTotals {
  const set = new Set(Array.isArray(months) ? months : [months]);
  const out: MonthTotals = new Map();
  for (const r of rows) if (set.has(r.month) && r.kind !== 'transfer') out.set(r.category_id, (out.get(r.category_id) ?? 0) + r.total);
  return out;
}

export interface MonthSummary { month: Month; income: number; spending: number; txns: number }
export async function loadMonthSummaries(from = '1900-01-01', to = '2999-12-31'): Promise<MonthSummary[]> {
  const { data, error } = await supabase.rpc('report_months', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ month: r.month, income: Number(r.income), spending: Number(r.spending), txns: Number(r.txns) }));
}

export interface MerchantTotal { merchant: string; total: number; txns: number }
export async function loadMerchants(from: string, to: string, kind: 'expense' | 'income' = 'expense', categoryId: string | null = null): Promise<MerchantTotal[]> {
  const { data, error } = await supabase.rpc('report_merchants', { p_from: from, p_to: to, p_category: categoryId, p_kind: kind });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ merchant: r.merchant, total: Number(r.total), txns: Number(r.txns) }));
}

export const thisMonth = (): Month => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` as Month; };
