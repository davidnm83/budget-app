// Points redeemed in store (PC Optimum, Scene+…), read from a receipt. The receipt's amount is what the card was
// charged; with "Record points as rewards" on (user_prefs.track_rewards), attaching the receipt also splits the
// transaction: the purchase at its full value, and the points back under the "Rewards" income category.
import { rewardsSplit } from '@budget-app/core';
import type { Receipt } from './receipts';
import { supabase } from './supabase';

export const REWARDS_CATEGORY = 'Rewards';

/** Points lines a receipt was read with, and their total. */
export function redeemedOf(items: Receipt['items']): { lines: { name: string; amount: number }[]; total: number } {
  const lines = (items ?? []).filter((i) => i.redeemed).map((i) => ({ name: i.name, amount: i.amount }));
  return { lines, total: Math.round(lines.reduce((s, i) => s + i.amount, 0) * 100) / 100 };
}

export async function trackRewardsOn(): Promise<boolean> {
  const { data } = await supabase.from('user_prefs').select('track_rewards').maybeSingle();
  return !!(data as any)?.track_rewards;
}

export async function setTrackRewards(on: boolean) {
  const { error } = await supabase.from('user_prefs').upsert({ track_rewards: on, updated_at: new Date().toISOString() });
  if (error) throw new Error(/track_rewards/.test(error.message) ? 'This needs the newest database update (supabase db push).' : error.message);
}

async function rewardsCategory(): Promise<string> {
  const { data, error } = await supabase.from('categories').select('id').eq('name', REWARDS_CATEGORY).eq('kind', 'income').maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.id;
  const made = await supabase.from('categories').insert({ name: REWARDS_CATEGORY, group_name: 'Income', kind: 'income', sort: 14 }).select('id').single();
  if (made.error) throw new Error(made.error.message);
  return made.data!.id;
}

/**
 * After a receipt is attached: when it has points and the setting is on, split the transaction (once). A
 * transaction already split is left as it is. Returns what happened, for the message.
 */
export async function recordRewards(txnId: string, items: Receipt['items']): Promise<'recorded' | 'split already' | null> {
  const { total } = redeemedOf(items);
  if (!(total > 0) || !(await trackRewardsOn())) return null;
  const { data: txn, error } = await supabase.from('transactions').select('amount, category_id, transaction_splits(id)').eq('id', txnId).single();
  if (error) throw new Error(error.message);
  if (((txn as any).transaction_splits ?? []).length) return 'split already';
  const rows = rewardsSplit(Number(txn.amount), total, txn.category_id, await rewardsCategory());
  const ins = await supabase.from('transaction_splits').insert(rows.map((r) => ({ transaction_id: txnId, ...r, notes: r.amount > 0 ? 'Points redeemed' : null })));
  if (ins.error) throw new Error(ins.error.message);
  const up = await supabase.from('transactions').update({ category_id: null, category_source: 'manual', is_transfer: false }).eq('id', txnId);
  if (up.error) throw new Error(up.error.message);
  return 'recorded';
}
