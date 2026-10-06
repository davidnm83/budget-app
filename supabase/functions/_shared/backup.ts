// Nightly backup (PLT-8): the same JSON file Settings → Backup downloads, written into the private
// "backups" storage bucket under each user's own folder (<user id>/<YYYY-MM-DD>.json). Keeps the
// last 7 nights and the first backup of each of the last 12 months (core: backupsToDelete).
// Bank sign-in tokens are never in it: plaid_items only holds the id of the encrypted token.
import type { Admin } from './supabase.ts';
import { backupsToDelete } from './core/index.ts';

/** Same tables as the app's "Download everything" (apps/app/src/lib/exportAll.ts). Keep the two lists alike. */
const TABLES = ['accounts', 'categories', 'category_groups', 'category_rules', 'merchant_rules', 'merchant_sites', 'transactions',
  'transaction_splits', 'budgets', 'recurring', 'plan_entries', 'user_prefs', 'plaid_items', 'sync_runs'];
/** Newer tables, skipped where their migration hasn't run. */
const LATER_TABLES = ['payment_plans', 'goals', 'goal_entries', 'receipts', 'credit_scores', 'balance_transfers'];
/** Tables some installs have and others don't; skipped when missing. */
const EXTRA_TABLES: string[] = [];
const BUCKET = 'backups';

async function rows(admin: Admin, table: string, userId: string): Promise<unknown[] | null> {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').eq('user_id', userId).range(from, from + 999);
    if (error) return from === 0 ? null : out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export interface BackupResult { userId: string; date: string; rows: number; removed: number; error?: string }

/** Write tonight's backup for one user and tidy their older ones. */
export async function backupUser(admin: Admin, userId: string, date: string): Promise<BackupResult> {
  try {
    const tables: Record<string, unknown[]> = {};
    let total = 0;
    for (const name of [...TABLES, ...LATER_TABLES, ...EXTRA_TABLES]) {
      const list = await rows(admin, name, userId);
      if (list == null) { if (TABLES.includes(name)) throw new Error(`Couldn't read ${name}.`); continue; }
      tables[name] = list; total += list.length;
    }
    const body = JSON.stringify({ app: 'budget-app', format: 1, exported_at: new Date().toISOString(), automatic: true, tables });
    const up = await admin.storage.from(BUCKET).upload(`${userId}/${date}.json`, new TextEncoder().encode(body), { contentType: 'application/json', upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { data: files } = await admin.storage.from(BUCKET).list(userId, { limit: 1000 });
    const dates = (files ?? []).map((f: { name: string }) => f.name.replace(/\.json$/, '')).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const old = backupsToDelete(dates, date);
    if (old.length) await admin.storage.from(BUCKET).remove(old.map((d) => `${userId}/${d}.json`));
    return { userId, date, rows: total, removed: old.length };
  } catch (e) {
    return { userId, date, rows: 0, removed: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Everyone with anything to back up: the owners of accounts. */
export async function backupEveryone(admin: Admin, date: string): Promise<BackupResult[]> {
  const { data, error } = await admin.from('accounts').select('user_id');
  if (error) throw new Error(error.message);
  const users = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  const out: BackupResult[] = [];
  for (const u of users) out.push(await backupUser(admin, u, date));
  return out;
}
