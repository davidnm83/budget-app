// Category management (TXN-7): merge one category into another, rename a group.
import { supabase } from './supabase';

const check = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message); };

/**
 * Moves everything from `fromId` to `toId`, then deletes `fromId`: transactions, split parts,
 * rules, bills, planned entries, and budgets (amounts are added together when both categories
 * had a budget in the same month).
 */
export async function mergeCategories(fromId: string, toId: string) {
  if (fromId === toId) return;
  check(await supabase.from('transactions').update({ category_id: toId }).eq('category_id', fromId));
  check(await supabase.from('transaction_splits').update({ category_id: toId }).eq('category_id', fromId));
  check(await supabase.from('category_rules').update({ category_id: toId }).eq('category_id', fromId));
  check(await supabase.from('recurring').update({ category_id: toId }).eq('category_id', fromId));
  check(await supabase.from('plan_entries').update({ category_id: toId }).eq('category_id', fromId));
  const { data: budgets } = await supabase.from('budgets').select('id, month, amount, category_id').in('category_id', [fromId, toId]);
  for (const b of (budgets ?? []).filter((x) => x.category_id === fromId)) {
    const target = (budgets ?? []).find((x) => x.category_id === toId && x.month === b.month);
    if (target) {
      check(await supabase.from('budgets').update({ amount: Number(target.amount) + Number(b.amount) }).eq('id', target.id));
      check(await supabase.from('budgets').delete().eq('id', b.id));
    } else {
      check(await supabase.from('budgets').update({ category_id: toId }).eq('id', b.id));
    }
  }
  check(await supabase.from('categories').delete().eq('id', fromId));
}

/** Renames a group everywhere it's used (its categories and any group budgets). */
export async function renameGroup(from: string, to: string) {
  if (!to.trim() || from === to) return;
  check(await supabase.from('categories').update({ group_name: to.trim() }).eq('group_name', from));
  check(await supabase.from('budgets').update({ group_name: to.trim() }).eq('group_name', from));
}

/** A small palette to pick from; any emoji can also be typed. */
export const EMOJI = [
  '🛒', '🍔', '🍽️', '☕', '🍫', '🍦', '🍿', '🍺', '🛵', '🏠', '🛋️', '💡', '🧽', '🧺', '🧴', '💈', '👕', '👟', '🛍️', '📦',
  '🚙', '⛽', '🔧', '🚇', '🚕', '🅿️', '🛡️', '🫧', '✈️', '🏨', '📱', '💻', '🖥️', '⌨️', '🎮', '🎧', '📺', '📰', '🎬', '🎲',
  '🏋️', '🏸', '🩺', '💊', '🦷', '👓', '🎓', '📚', '🏫', '🎁', '🐷', '📈', '🧾', '🏦', '💳', '💼', '💵', '🪙', '👪', '🔁',
  '🔄', '🧰', '🚚', '🐶', '👶', '❤️', '⭐', '🔸',
];
