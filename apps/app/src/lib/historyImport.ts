/**
 * Moves your history over from another budgeting app. Safe to run again: rows already imported
 * are skipped.
 *
 *   1. Categories: the export's categories are added (or matched by name) with a starting group.
 *   2. Accounts: each account in the export goes into an app account you pick, or a new manual one.
 *   3. Transactions: rows that match a transaction already in the app (same account and amount,
 *      within 3 days) give it the export's category, merchant and note; the rest are added.
 *      Everything imported arrives already reviewed.
 */
import {
  addDays, cleanAccountName, learnMerchantRules, matchHistory, normalizeDescription,
  type HistoryAccount, type HistoryExport, type HistoryRow,
} from '@budget-app/core';
import { supabase } from './supabase';
import { pairAllTransfers } from './transfers';

export type AccountChoice = { kind: 'existing'; accountId: string } | { kind: 'new' } | { kind: 'skip' };

export interface ImportOptions {
  accounts: Map<string, AccountChoice>; // imported account name → choice
  hideUnusedStarterCategories: boolean;
  learnMerchants: boolean;
}

export interface ImportResult {
  added: number;
  matched: number;       // existing transactions that took its category
  matchedReviewed: number; // existing transactions you'd already reviewed in the app (left as they were)
  split: number;         // existing transactions that became splits
  alreadyImported: number;
  skipped: number;       // rows in accounts you chose to skip
  categoriesAdded: number;
  categoriesHidden: number;
  accountsCreated: number;
  merchantRules: number;
  transfersPaired?: number;
}

const STARTER = new Set(['paycheck', 'refunds', 'other income', 'groceries', 'restaurants', 'gas', 'car insurance',
  'car payment', 'parking & transit', 'rent', 'utilities', 'phone & internet', 'subscriptions', 'interest & fees', 'shopping', 'personal care',
  'health', 'education', 'entertainment', 'travel', 'gifts', 'home', 'other', 'transfer', 'credit card payment']);

/** Reads every row of a query, 1000 at a time (the API's page limit). */
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function inBatches<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Runs async jobs a few at a time. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const check = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message); };

export async function runHistoryImport(history: HistoryExport, opts: ImportOptions, progress: (msg: string) => void): Promise<ImportResult> {
  const result: ImportResult = { added: 0, matched: 0, matchedReviewed: 0, split: 0, alreadyImported: 0, skipped: 0, categoriesAdded: 0, categoriesHidden: 0, accountsCreated: 0, merchantRules: 0 };
  const now = new Date().toISOString();

  // ── 1. categories ──
  progress('Setting up categories…');
  const { data: cats, error: catErr } = await supabase.from('categories').select('id, name, group_name, kind, is_hidden, sort');
  if (catErr) throw new Error(catErr.message);
  const byName = new Map((cats ?? []).map((c) => [c.name.toLowerCase(), c]));
  const categoryId = new Map<string, string>(); // lowercased imported name → id
  for (const c of history.categories) {
    const sort = c.sort;
    const found = byName.get(c.name.toLowerCase());
    if (found) {
      check(await supabase.from('categories').update({ name: c.name, group_name: c.group, kind: c.kind, is_hidden: false, sort }).eq('id', found.id));
      categoryId.set(c.name.toLowerCase(), found.id);
    } else {
      const { data, error } = await supabase.from('categories').insert({ name: c.name, group_name: c.group, kind: c.kind, sort }).select('id').single();
      if (error) throw new Error(error.message);
      categoryId.set(c.name.toLowerCase(), data.id);
      result.categoriesAdded++;
    }
  }

  // Everything imported before, in any account (rows may have moved since, e.g. in a merge).
  progress('Checking what was imported before…');
  const before = await fetchAll<{ import_id: string }>((from, to) => supabase.from('transactions').select('import_id')
    .not('import_id', 'is', null).order('id').range(from, to));
  const done = new Set(before.flatMap((e) => e.import_id.split('\n')));

  // ── 2. accounts ──
  progress('Setting up accounts…');
  const accountId = new Map<string, string | null>(); // imported account → app account id (null = skip)
  for (const a of history.accounts) {
    const choice = opts.accounts.get(a.name) ?? { kind: 'new' };
    if (choice.kind === 'skip') accountId.set(a.name, null);
    else if (choice.kind === 'existing') accountId.set(a.name, choice.accountId);
    else if (history.rows.every((r) => r.account !== a.name || done.has(r.importId))) accountId.set(a.name, null); // nothing new for it
    else {
      const { data, error } = await supabase.from('accounts')
        .insert({ name: cleanAccountName(a.name), mask: a.mask, kind: 'manual', type: a.type, subtype: a.subtype })
        .select('id').single();
      if (error) throw new Error(error.message);
      accountId.set(a.name, data.id);
      result.accountsCreated++;
    }
  }

  // ── 3. what's already in the app for those accounts ──
  progress('Checking what the app already has…');
  const ids = [...new Set([...accountId.values()].filter((x): x is string => !!x))];
  const first = addDays(history.rows.reduce((m, r) => (r.date < m ? r.date : m), '9999-12-31'), -3);
  const last = addDays(history.rows.reduce((m, r) => (r.date > m ? r.date : m), '0000-01-01'), 3);
  type Ex = { id: string; account_id: string; date: string; amount: number; reviewed: boolean; import_id: string | null };
  const existing = ids.length
    ? await fetchAll<Ex>((from, to) => supabase.from('transactions').select('id, account_id, date, amount, reviewed, import_id')
        .in('account_id', ids).gte('date', first).lte('date', last).order('id').range(from, to))
    : [];

  const todo: (HistoryRow & { accountId: string })[] = [];
  for (const r of history.rows) {
    if (done.has(r.importId)) { result.alreadyImported++; continue; }
    const acc = accountId.get(r.account);
    if (!acc) { result.skipped++; continue; }
    todo.push({ ...r, accountId: acc });
  }
  const pool_ = existing.filter((e) => !e.import_id).map((e) => ({ id: e.id, accountId: e.account_id, date: e.date, amount: Number(e.amount) }));
  const match = matchHistory(todo, pool_);
  const byIndex = new Map(todo.map((r) => [r.index, r]));
  const exById = new Map(existing.map((e) => [e.id, e]));
  const cat = (r: HistoryRow) => categoryId.get(r.category.toLowerCase()) ?? null;

  // ── 4. existing transactions that match one imported row ──
  progress(`Updating ${match.single.size + match.splits.length} transactions already in the app…`);
  await pool([...match.single.entries()], 6, async ([index, id]) => {
    const r = byIndex.get(index)!;
    if (exById.get(id)!.reviewed) {
      result.matchedReviewed++;
      check(await supabase.from('transactions').update({ import_id: r.importId }).eq('id', id));
      return;
    }
    check(await supabase.from('transactions').update({
      merchant: r.merchant || undefined,
      category_id: cat(r),
      category_source: 'manual',
      notes: r.notes || null,
      tags: r.tags,
      is_transfer: r.kind === 'transfer',
      reviewed: true,
      reviewed_at: now,
      import_id: r.importId,
    }).eq('id', id));
    result.matched++;
  });

  // ── 5. existing transactions that several imported rows split ──
  await pool(match.splits, 4, async (s) => {
    const rows = s.rows.map((i) => byIndex.get(i)!);
    const importId = rows.map((r) => r.importId).join('\n');
    if (exById.get(s.existingId)!.reviewed) {
      result.matchedReviewed++;
      check(await supabase.from('transactions').update({ import_id: importId }).eq('id', s.existingId));
      return;
    }
    check(await supabase.from('transaction_splits').delete().eq('transaction_id', s.existingId));
    check(await supabase.from('transaction_splits').insert(rows.map((r) => ({
      transaction_id: s.existingId, category_id: cat(r), amount: r.amount, notes: r.notes || null,
    }))));
    check(await supabase.from('transactions').update({
      merchant: rows.find((r) => r.merchant)?.merchant || undefined,
      category_id: null,
      category_source: 'manual',
      is_transfer: rows.every((r) => r.kind === 'transfer'),
      reviewed: true,
      reviewed_at: now,
      import_id: importId,
    }).eq('id', s.existingId));
    result.split++;
  });

  // ── 6. everything else is new ──
  const inserts = match.unmatched.map((i) => byIndex.get(i)!).map((r) => ({
    account_id: r.accountId,
    source: 'import',
    date: r.date,
    amount: r.amount,
    name: r.name,
    merchant: r.merchant || null,
    category_id: cat(r),
    category_source: 'manual',
    notes: r.notes || null,
    tags: r.tags,
    is_transfer: r.kind === 'transfer',
    reviewed: true,
    reviewed_at: now,
    import_id: r.importId,
  }));
  await inBatches(inserts, 500, async (batch) => {
    progress(`Adding transactions… ${result.added} of ${inserts.length}`);
    check(await supabase.from('transactions').insert(batch));
    result.added += batch.length;
  });

  // ── 7. merchant names learned from your history ──
  if (opts.learnMerchants) {
    progress('Learning merchant names…');
    const { data: have } = await supabase.from('merchant_rules').select('match');
    const known = new Set((have ?? []).map((r) => normalizeDescription(r.match)));
    const rules = learnMerchantRules(history.rows.filter((r) => r.merchant && r.kind !== 'transfer').map((r) => ({ name: r.name, merchant: r.merchant })))
      .filter((r) => r.match.length >= 4 && !known.has(r.match));
    await inBatches(rules, 500, async (batch) => { check(await supabase.from('merchant_rules').insert(batch)); });
    result.merchantRules = rules.length;
  }

  // ── 8. tidy the category list ──
  if (opts.hideUnusedStarterCategories) {
    progress('Tidying categories…');
    const { data: used } = await supabase.rpc('report_category_months', { p_from: '1900-01-01', p_to: '2999-12-31' });
    const { data: ruled } = await supabase.from('category_rules').select('category_id');
    const keep = new Set([...(used ?? []).map((u: any) => u.category_id), ...(ruled ?? []).map((r) => r.category_id), ...categoryId.values()]);
    const hide = (cats ?? []).filter((c) => STARTER.has(c.name.toLowerCase()) && !c.is_hidden && !keep.has(c.id)).map((c) => c.id);
    if (hide.length) check(await supabase.from('categories').update({ is_hidden: true }).in('id', hide));
    result.categoriesHidden = hide.length;
  }
  // ── 9. pair both sides of transfers between your accounts ──
  progress('Pairing transfers between your accounts…');
  try { result.transfersPaired = await pairAllTransfers(); } catch { /* best-effort */ }
  return result;
}

/** Suggests where each imported account should go: an app account with the same last 4 digits or name, else a new one. */
export function suggestAccountChoices(from: HistoryAccount[], app: { id: string; name: string; mask: string | null }[]): Map<string, AccountChoice> {
  const out = new Map<string, AccountChoice>();
  const taken = new Set<string>();
  for (const a of from) {
    const name = cleanAccountName(a.name).toLowerCase();
    const hit = app.find((x) => !taken.has(x.id) && ((a.mask && x.mask && x.mask.slice(-4) === a.mask) || x.name.toLowerCase() === name));
    if (hit) { taken.add(hit.id); out.set(a.name, { kind: 'existing', accountId: hit.id }); }
    else out.set(a.name, { kind: 'new' });
  }
  return out;
}
