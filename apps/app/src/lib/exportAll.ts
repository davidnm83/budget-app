// Full export (PLT-8, IDEA-11): every table you own as one JSON file. Bank tokens are not part
// of it (they never leave the server). Web only for now.
import { Platform } from 'react-native';
import { supabase } from './supabase';

const TABLES = ['accounts', 'categories', 'category_groups', 'category_rules', 'merchant_rules', 'merchant_sites', 'transactions',
  'transaction_splits', 'budgets', 'recurring', 'plan_entries', 'user_prefs', 'plaid_items', 'sync_runs'];
/** Tables some installs have and others don't; skipped when missing. */
const EXTRA_TABLES: string[] = [];

async function all(table: string): Promise<unknown[] | null> {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) return from === 0 ? null : out;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export const canExport = Platform.OS === 'web';

export async function exportEverything(progress: (msg: string) => void): Promise<{ tables: number; rows: number }> {
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  for (const name of [...TABLES, ...EXTRA_TABLES]) {
    progress(`Reading ${name.replace(/_/g, ' ')}…`);
    const list = await all(name);
    if (list == null) { if (TABLES.includes(name)) throw new Error(`Couldn't read ${name}.`); continue; }
    tables[name] = list; rows += list.length;
  }
  const stamp = new Date().toISOString();
  const text = JSON.stringify({ app: 'budget-app', format: 1, exported_at: stamp, tables }, null, 1);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `budget-export-${stamp.slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { tables: Object.keys(tables).length, rows };
}

/** For restore: the optional tables this install knows about. */
export const extraTables = (): string[] => EXTRA_TABLES;
