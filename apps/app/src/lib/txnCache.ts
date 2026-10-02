import { currency } from '@budget-app/core';
// What the app already knows, kept in memory so a transaction opens at once: the row you tapped
// in a list (shown while the full record loads) and the category list (reused between openings).
import type { Category, Txn } from './types';

const seeds = new Map<string, Partial<Txn>>();
/** Remember a list row so the editor can paint it straight away. */
export function seedTxn(row: any) {
  if (!row?.id) return;
  seeds.set(row.id, {
    id: row.id, date: row.date, amount: Number(row.amount), currency: row.currency ?? currency(), name: row.name ?? row.display_name ?? '',
    merchant: row.merchant ?? null, category_id: row.category_id ?? null, notes: row.notes ?? null, tags: row.tags ?? [],
    accounts: row.account_name ? { name: row.account_name, mask: row.account_mask ?? null } : null,
  });
  if (seeds.size > 400) seeds.delete(seeds.keys().next().value as string);
}
export const peekTxn = (id: string) => seeds.get(id) ?? null;

let cats: Category[] = [];
export const peekCategories = () => cats;
export const storeCategories = (c: Category[]) => { cats = c; };
