// Restore (IDEA-11): load a file made by "Download everything" back into this account, replacing
// what is there. Works on the same host (to go back to an earlier state) or a new one (to move).
//
// What it does not bring back: bank links (their tokens never leave the server, so they aren't in
// the file) and the sync history. On the same host, accounts stay attached to their existing bank
// link. On a new host they come back unlinked: link the bank again, then merge the new account
// into the restored one.
//
// This runs from the app, one table at a time, so it is not all-or-nothing. If it stops part-way,
// run it again with the same file: every run starts by clearing the account.
import { extraTables } from './exportAll';
import { supabase } from './supabase';

export interface Backup { app: string; format: number; exported_at: string; tables: Record<string, any[]> }

// Parents before children.
const ORDER = ['categories', 'category_groups', 'accounts', 'transactions', 'transaction_splits', 'category_rules', 'merchant_rules',
  'merchant_sites', 'recurring', 'plan_entries', 'budgets', 'payment_plans'];
const NEVER = ['plaid_items', 'sync_runs'];
const CHUNK = 400;

export function readBackup(text: string): Backup {
  let b: any;
  try { b = JSON.parse(text); } catch { throw new Error("That file isn't a backup from this app (it isn't JSON)."); }
  if (b?.app !== 'budget-app' || !b.tables || typeof b.tables !== 'object') throw new Error("That file isn't a backup from this app.");
  if (b.format !== 1) throw new Error(`This backup is format ${b.format}; this version of the app reads format 1. Update the app first.`);
  for (const [k, v] of Object.entries(b.tables)) if (!Array.isArray(v)) throw new Error(`The backup's “${k}” section is damaged.`);
  return b as Backup;
}

/** What the file holds, for the confirmation screen. */
export function describeBackup(b: Backup): { when: string; rows: number; lines: string[] } {
  const n = (t: string) => b.tables[t]?.length ?? 0;
  const lines = [`${n('accounts').toLocaleString()} accounts`, `${n('transactions').toLocaleString()} transactions`, `${n('categories').toLocaleString()} categories`,
    `${(n('category_rules') + n('merchant_rules')).toLocaleString()} rules`, `${n('budgets').toLocaleString()} budget lines`, `${n('recurring').toLocaleString()} bills and income`];
  const rows = Object.entries(b.tables).filter(([k]) => !NEVER.includes(k)).reduce((s, [, v]) => s + v.length, 0);
  return { when: new Date(b.exported_at).toLocaleString(), rows, lines };
}

/** True when there is nothing of yours to lose: no accounts and no transactions. */
export async function accountIsEmpty(): Promise<boolean> {
  const [a, t] = await Promise.all([supabase.from('accounts').select('id', { count: 'exact', head: true }), supabase.from('transactions').select('id', { count: 'exact', head: true })]);
  if (a.error || t.error) throw new Error((a.error ?? t.error)!.message);
  return !a.count && !t.count;
}

const missingTable = (e: any) => e?.code === 'PGRST205' || e?.code === '42P01';
// A column the file has and this install doesn't (a backup from a different version): leave it out.
const unknownColumn = (e: any): string | null => (e?.code === 'PGRST204' ? /'([^']+)' column/.exec(e.message ?? '')?.[1] ?? null : null);

async function insertAll(table: string, rows: any[], notes: string[], upsertOn?: string): Promise<number> {
  let list = rows;
  for (let i = 0; i < list.length; i += CHUNK) {
    for (let tries = 0; ; tries++) {
      const part = list.slice(i, i + CHUNK);
      const { error } = upsertOn ? await supabase.from(table).upsert(part, { onConflict: upsertOn }) : await supabase.from(table).insert(part);
      if (!error) break;
      const col = unknownColumn(error);
      if (col && tries < 25) { list = list.map(({ [col]: _drop, ...rest }) => rest); notes.push(`${table}: “${col}” isn't used by this version and was left out`); continue; }
      throw new Error(`${table.replace(/_/g, ' ')}: ${error.message}`);
    }
  }
  return list.length;
}

async function clear(table: string, uid: string) {
  const { error } = await supabase.from(table).delete().eq('user_id', uid);
  if (error && !missingTable(error)) throw new Error(`Clearing ${table.replace(/_/g, ' ')}: ${error.message}`);
}

export async function restoreBackup(b: Backup, progress: (msg: string) => void): Promise<{ rows: number; notes: string[] }> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Sign in again, then retry.');
  const notes: string[] = [];
  const mine = (rows: any[]) => rows.map((r) => ({ ...r, user_id: uid }));
  const extras = extraTables().filter((t) => Array.isArray(b.tables[t]));
  const unknown = Object.keys(b.tables).filter((t) => ![...ORDER, ...NEVER, ...extraTables(), 'user_prefs'].includes(t));
  if (unknown.length) notes.push(`Not restored (this version doesn't have them): ${unknown.join(', ')}`);

  // Bank links that still exist here; accounts in the file keep theirs only if it's one of these.
  const { data: items, error: itemErr } = await supabase.from('plaid_items').select('id');
  if (itemErr) throw new Error(itemErr.message);
  const links = new Set((items ?? []).map((x: any) => x.id));

  progress('Clearing what is here now…');
  for (const t of [...extraTables()].reverse()) await clear(t, uid);
  for (const t of ['payment_plans', 'transaction_splits', 'plan_entries', 'budgets', 'category_rules', 'recurring', 'transactions', 'merchant_rules', 'merchant_sites', 'category_groups', 'accounts', 'categories']) await clear(t, uid);

  let rows = 0;
  for (const t of ORDER) {
    const src = b.tables[t] ?? [];
    if (!src.length) continue;
    progress(`Restoring ${src.length.toLocaleString()} ${t.replace(/_/g, ' ')}…`);
    if (t === 'accounts') {
      // Two passes: a loan can point at the account that pays it, which may not be in yet.
      const unlinked = src.filter((a) => a.plaid_item_id && !links.has(a.plaid_item_id)).length;
      if (unlinked) notes.push(`${unlinked} bank-linked account${unlinked === 1 ? '' : 's'} came back without the bank link. Link the bank again in Settings, then merge the new account into the restored one.`);
      rows += await insertAll(t, mine(src).map((a) => ({ ...a, loan_paying_account_id: null, plaid_item_id: a.plaid_item_id && links.has(a.plaid_item_id) ? a.plaid_item_id : null })), notes);
      const loans = mine(src).filter((a) => a.loan_paying_account_id).map((a) => ({ ...a, plaid_item_id: a.plaid_item_id && links.has(a.plaid_item_id) ? a.plaid_item_id : null }));
      if (loans.length) await insertAll(t, loans, notes, 'id');
    } else if (t === 'transactions') {
      // Two passes: the two halves of a transfer point at each other.
      rows += await insertAll(t, mine(src).map((x) => ({ ...x, transfer_pair_id: null })), notes);
      const pairs = mine(src).filter((x) => x.transfer_pair_id);
      if (pairs.length) { progress(`Pairing ${pairs.length.toLocaleString()} transfers…`); await insertAll(t, pairs, notes, 'id'); }
    } else {
      try { rows += await insertAll(t, mine(src), notes); }
      catch (e) { if (t !== 'payment_plans') throw e; notes.push('Card payment plans were not restored: this database is missing that table (run the newest migrations, then restore again).'); }
    }
  }

  // Tables only some installs have. Their order isn't known here, so anything that fails waits for the others.
  let waiting = extras;
  for (let pass = 0; pass < 3 && waiting.length; pass++) {
    const failed: string[] = [];
    for (const t of waiting) {
      if (!b.tables[t].length) continue;
      progress(`Restoring ${b.tables[t].length.toLocaleString()} ${t.replace(/_/g, ' ')}…`);
      try { rows += await insertAll(t, mine(b.tables[t]), notes); }
      catch (e) { if (pass === 2) throw e; await clear(t, uid); failed.push(t); }
    }
    waiting = failed;
  }

  const prefs = b.tables.user_prefs?.[0];
  if (prefs) { progress('Restoring settings…'); rows += await insertAll('user_prefs', mine([prefs]), notes, 'user_id'); }
  return { rows, notes: [...new Set(notes)] };
}
