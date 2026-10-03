// At each scheduled sync time, a reminder to bring in a bank CSV for the accounts the sync can't reach:
// manual accounts, and linked accounts whose connection had an error. Each account can be left out
// (accounts.csv_reminder; automatic = cash accounts and credit cards). The reminder is answered once per
// sync time (user_prefs.csv_prompted_at), and an account that has had a CSV imported since isn't listed.
import { csvReminderOn, lastSyncTime } from '@budget-app/core';
import { supabase } from './supabase';
import type { Account, PlaidItem } from './types';

export interface ReminderItem { account: Account; reason: string }
export interface Reminder { at: Date; items: ReminderItem[] }

const PROBLEM: Record<string, string> = { login_required: 'the bank needs you to sign in again', error: 'the last sync failed' };

/** The reminder that's due now, or null. Quietly null before the database has the new columns. */
export async function loadReminder(now = new Date()): Promise<Reminder | null> {
  const prefs = await supabase.from('user_prefs').select('sync_every, csv_prompted_at').maybeSingle();
  if (prefs.error) return null;
  const at = lastSyncTime(now, (prefs.data as any)?.sync_every ?? null);
  const answered = (prefs.data as any)?.csv_prompted_at as string | null | undefined;
  if (!at || (answered && new Date(answered) >= at)) return null;

  const [accs, items] = await Promise.all([
    supabase.from('accounts').select('*').eq('is_hidden', false).order('name'),
    supabase.from('plaid_items').select('id, item_id, institution_name, status, error_code, last_synced_at'),
  ]);
  if (accs.error || items.error) return null;
  const byItem = new Map(((items.data ?? []) as PlaidItem[]).map((i) => [i.id, i]));
  const list: ReminderItem[] = [];
  for (const a of (accs.data ?? []) as Account[]) {
    if (!csvReminderOn(a.type, a.csv_reminder)) continue;
    if (a.kind === 'manual') { list.push({ account: a, reason: 'Not linked to the bank' }); continue; }
    const item = a.plaid_item_id ? byItem.get(a.plaid_item_id) : null;
    if (item && item.status !== 'ok') list.push({ account: a, reason: `Didn't sync: ${PROBLEM[item.status] ?? item.status}` });
  }
  if (!list.length) return null;
  // Already brought in since the sync time: nothing to remind about.
  const { data: recent } = await supabase.from('transactions').select('account_id')
    .eq('source', 'csv').gte('created_at', at.toISOString()).in('account_id', list.map((x) => x.account.id));
  const done = new Set((recent ?? []).map((r: any) => r.account_id as string));
  const left = list.filter((x) => !done.has(x.account.id));
  return left.length ? { at, items: left } : null;
}

/** The reminder was seen and answered (imported, put off, or closed): it comes back at the next sync time. */
export async function answerReminder() {
  await supabase.from('user_prefs').upsert({ csv_prompted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
}

export async function setAccountReminder(id: string, on: boolean | null) {
  const { error } = await supabase.from('accounts').update({ csv_reminder: on }).eq('id', id);
  if (error) throw new Error(error.message);
}
