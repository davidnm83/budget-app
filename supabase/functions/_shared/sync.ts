/**
 * Syncs one Plaid Item (one bank login) into the database:
 *   • pages through /transactions/sync from the saved cursor
 *   • writes POSTED transactions only (pending ones arrive later as posted)
 *   • new rows get a cleaned merchant and a suggested category, unreviewed
 *   • changed rows only get the bank's fields updated; your edits are kept (if you changed the
 *     date or amount, the bank's new value goes to original_date / original_amount instead)
 *   • a bank transaction that's already in the app from a CSV or Fina import (same account and
 *     amount, within 3 days) is linked to that row instead of being added twice
 *   • refreshes account balances, then saves the cursor
 */
import type { Admin } from './supabase.ts';
import { plaid, PlaidError, RELINK_CODES } from './plaid.ts';
import {
  addDays, fromPlaidAmount, isTransferCategory, merchantFor, plaidCategoryNames, planMerge, sameAccount, suggestCategory,
  type CategoryRule, type MerchantRule,
} from './core/index.ts';

export interface PlaidItemRow {
  id: string;
  user_id: string;
  item_id: string;
  institution_name: string;
  access_token_secret_id: string;
  cursor: string | null;
}

export interface SyncResult {
  itemId: string;
  institution: string;
  added: number;
  updated: number;
  removed: number;
  status: 'ok' | 'login_required' | 'error';
  error?: string;
}

export async function accessToken(admin: Admin, secretId: string): Promise<string> {
  const { data, error } = await admin.rpc('read_plaid_token', { p_secret_id: secretId });
  if (error || !data) throw new Error('Could not read the bank connection token: ' + (error?.message ?? 'missing'));
  return data as string;
}

/** Inserts or refreshes the accounts of an Item; returns plaid_account_id → account row id. */
export async function upsertAccounts(admin: Admin, item: PlaidItemRow, token: string): Promise<Map<string, string>> {
  const res = await plaid<{ accounts: any[] }>('/accounts/get', { access_token: token });
  const now = new Date().toISOString();
  const { data: known } = await admin.from('accounts').select('id, plaid_account_id')
    .in('plaid_account_id', res.accounts.map((a) => a.account_id));
  const map = new Map<string, string>((known ?? []).map((r: any) => [r.plaid_account_id, r.id]));

  // Existing accounts: refresh balances only, so names you changed in the app stay.
  // A card's limit comes along when the bank reports one.
  for (const a of res.accounts.filter((x) => map.has(x.account_id))) {
    await admin.from('accounts').update({
      plaid_item_id: item.id,
      current_balance: a.balances?.current,
      available_balance: a.balances?.available,
      balance_updated_at: now,
      ...(a.balances?.limit ? { credit_limit: a.balances.limit } : {}),
    }).eq('id', map.get(a.account_id)!);
  }
  // A card or account you were already tracking by hand (CSV or Fina import) with the same last
  // 4 digits and type becomes this bank account, so its history and balance carry on in one place.
  const unseen = res.accounts.filter((x) => !map.has(x.account_id));
  if (unseen.length) {
    const { data: manual } = await admin.from('accounts').select('id, name, mask, type')
      .eq('user_id', item.user_id).eq('kind', 'manual').is('plaid_account_id', null);
    const taken = new Set<string>();
    for (const a of unseen) {
      const m = (manual ?? []).find((x: any) => !taken.has(x.id) && sameAccount(x, { mask: a.mask, type: a.type }));
      if (!m) continue;
      taken.add(m.id);
      await admin.from('accounts').update({
        kind: 'plaid', plaid_item_id: item.id, plaid_account_id: a.account_id, official_name: a.official_name,
        mask: a.mask, subtype: a.subtype, start_balance: null,
        current_balance: a.balances?.current, available_balance: a.balances?.available, balance_updated_at: now,
      }).eq('id', m.id);
      map.set(a.account_id, m.id);
    }
  }
  const fresh = res.accounts.filter((x) => !map.has(x.account_id)).map((a) => ({
    user_id: item.user_id,
    plaid_item_id: item.id,
    plaid_account_id: a.account_id,
    kind: 'plaid',
    name: a.official_name || a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currency: a.balances?.iso_currency_code ?? (Deno.env.get('DEFAULT_CURRENCY') ?? 'USD'),
    current_balance: a.balances?.current,
    available_balance: a.balances?.available,
    balance_updated_at: now,
    credit_limit: a.balances?.limit ?? null,
  }));
  if (fresh.length) {
    const { data, error } = await admin.from('accounts').insert(fresh).select('id, plaid_account_id');
    if (error) throw new Error('Saving accounts failed: ' + error.message);
    for (const r of data ?? []) map.set(r.plaid_account_id, r.id);
  }
  return map;
}

async function pullChanges(token: string, startCursor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let cursor = startCursor ?? '';
      const byId = new Map<string, any>();
      const removed: string[] = [];
      let hasMore = true;
      while (hasMore) {
        const body: Record<string, unknown> = { access_token: token, count: 500, options: { include_original_description: true } };
        if (cursor) body.cursor = cursor;
        const res = await plaid<any>('/transactions/sync', body);
        for (const t of [...res.added, ...res.modified]) byId.set(t.transaction_id, t);
        for (const r of res.removed) { byId.delete(r.transaction_id); removed.push(r.transaction_id); }
        cursor = res.next_cursor;
        hasMore = res.has_more;
      }
      return { posted: [...byId.values()].filter((t) => !t.pending), removed, cursor };
    } catch (e) {
      if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') continue;
      throw e;
    }
  }
  throw new Error('Bank data kept changing during sync; it will retry next time.');
}

async function loadUserRules(admin: Admin, userId: string) {
  const [m, c, cats] = await Promise.all([
    admin.from('merchant_rules').select('match, merchant').eq('user_id', userId),
    admin.from('category_rules').select('match_text, category_id, account_id, min_amount, max_amount').eq('user_id', userId),
    admin.from('categories').select('id, name, kind, is_hidden').eq('user_id', userId),
  ]);
  const merchantRules: MerchantRule[] = (m.data ?? []) as MerchantRule[];
  const categoryRules: CategoryRule[] = (c.data ?? []).map((r: any) => ({
    matchText: r.match_text, categoryId: r.category_id, accountId: r.account_id, minAmount: r.min_amount, maxAmount: r.max_amount,
  }));
  // Plaid's category only maps onto categories you still use (not hidden ones).
  const byName = new Map<string, { id: string; kind: string }>((cats.data ?? []).filter((r: any) => !r.is_hidden).map((r: any) => [String(r.name).toLowerCase(), { id: r.id, kind: r.kind }]));
  const kindById = new Map<string, string>((cats.data ?? []).map((r: any) => [r.id, r.kind]));
  return { merchantRules, categoryRules, byName, kindById };
}

/** merchant (lowercase) → category you used most recently for it, from reviewed rows. */
async function learnedCategories(admin: Admin, userId: string, merchants: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(merchants.filter(Boolean))];
  if (!unique.length) return out;
  const { data } = await admin.from('transactions')
    .select('merchant, category_id, date')
    .eq('user_id', userId).eq('reviewed', true).not('category_id', 'is', null)
    .in('merchant', unique)
    .order('date', { ascending: false })
    .limit(2000);
  for (const r of data ?? []) {
    const k = String(r.merchant).toLowerCase();
    if (!out[k]) out[k] = r.category_id;
  }
  return out;
}

/** How many transaction ids go into one "do we have these?" lookup. */
const LOOKUP_BATCH = 80;

export async function syncItem(admin: Admin, item: PlaidItemRow): Promise<SyncResult> {
  const result: SyncResult = { itemId: item.item_id, institution: item.institution_name, added: 0, updated: 0, removed: 0, status: 'ok' };
  try {
    const token = await accessToken(admin, item.access_token_secret_id);
    const accounts = await upsertAccounts(admin, item, token); // also refreshes balances
    const { posted, removed, cursor } = await pullChanges(token, item.cursor);

    // Which of these do we already have? (and did you edit their date or amount?)
    const ids = posted.map((t) => t.transaction_id);
    const existing = new Map<string, { original_date: string | null; original_amount: number | null }>();
    // In small batches: the ids travel in the request's address, and a few hundred of them make it too
    // long for the server to accept. That lookup used to fail without a word, every transaction then
    // looked new, and saving them hit "duplicate key" and stopped the whole sync.
    for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
      const { data, error } = await admin.from('transactions').select('plaid_transaction_id, original_date, original_amount').in('plaid_transaction_id', ids.slice(i, i + LOOKUP_BATCH));
      if (error) throw new Error('Checking which transactions are already here failed: ' + error.message);
      for (const r of data ?? []) existing.set(r.plaid_transaction_id, r);
    }

    const rules = await loadUserRules(admin, item.user_id);
    let fresh = posted.filter((t) => !existing.has(t.transaction_id) && accounts.has(t.account_id));

    // Already in the app from a CSV or Fina import? Link it instead of adding a second copy.
    // Imported split parts (same date and description) that add up to one bank transaction
    // become that transaction's splits.
    if (fresh.length) {
      const dates = fresh.map((t) => t.date).sort();
      const { data: unlinked } = await admin.from('transactions').select('id, account_id, date, amount, name, category_id, notes, import_id')
        .eq('user_id', item.user_id).is('plaid_transaction_id', null)
        .in('account_id', [...new Set(fresh.map((t) => accounts.get(t.account_id)!))])
        .gte('date', addDays(dates[0], -3)).lte('date', addDays(dates[dates.length - 1], 3));
      const claimed = new Set<string>();
      for (const accountId of new Set((unlinked ?? []).map((u: any) => u.account_id as string))) {
        const mine = (unlinked ?? []).filter((u: any) => u.account_id === accountId);
        const theirs = fresh.filter((t) => accounts.get(t.account_id) === accountId);
        const plan = planMerge(
          mine.map((u: any) => ({ id: u.id, date: u.date, amount: Number(u.amount), name: u.name ?? '' })),
          theirs.map((t) => ({ id: t.transaction_id, date: t.date, amount: fromPlaidAmount(t.amount), name: t.original_description || t.name || '' })),
        );
        const byId = new Map(theirs.map((t) => [t.transaction_id, t]));
        for (const [rowId, txnId] of plan.pairs) {
          const t = byId.get(txnId)!;
          await admin.from('transactions').update({
            plaid_transaction_id: t.transaction_id, authorized_date: t.authorized_date, plaid_category: t.personal_finance_category?.detailed ?? null,
          }).eq('id', rowId);
          claimed.add(txnId);
          result.updated++;
        }
        for (const g of plan.groups) {
          const t = byId.get(g.bankId)!;
          const parts = mine.filter((u: any) => g.manualIds.includes(u.id));
          const [keep, ...rest] = parts;
          await admin.from('transaction_splits').insert(parts.map((u: any) => ({
            user_id: item.user_id, transaction_id: keep.id, category_id: u.category_id, amount: u.amount, notes: u.notes,
          })));
          // Remove the other parts first; their import ids move to the kept row (they must stay unique).
          await admin.from('transactions').delete().in('id', rest.map((u: any) => u.id));
          await admin.from('transactions').update({
            plaid_transaction_id: t.transaction_id, authorized_date: t.authorized_date, amount: fromPlaidAmount(t.amount),
            category_id: null, notes: null, plaid_category: t.personal_finance_category?.detailed ?? null,
            import_id: parts.map((u: any) => u.import_id).filter(Boolean).join('\n') || null,
          }).eq('id', keep.id);
          claimed.add(g.bankId);
          result.updated++;
        }
      }
      fresh = fresh.filter((t) => !claimed.has(t.transaction_id));
    }

    const withMerchant = fresh.map((t) => {
      const name = t.original_description || t.name || '';
      const merchant = merchantFor(rules.merchantRules, name) || t.merchant_name || t.counterparties?.[0]?.name || '';
      return { t, name, merchant };
    });
    const learned = await learnedCategories(admin, item.user_id, withMerchant.map((x) => x.merchant));

    const inserts = withMerchant.map(({ t, name, merchant }) => {
      const pfc = t.personal_finance_category ?? {};
      const amount = fromPlaidAmount(t.amount);
      const accountId = accounts.get(t.account_id)!;
      // First of Plaid's candidate names that you have (starter names or your own, any case).
      const plaidName = plaidCategoryNames(pfc.detailed, pfc.primary).map((n) => n.toLowerCase()).find((n) => rules.byName.has(n));
      const plaidMap: Record<string, string> = {};
      if (pfc.detailed && plaidName) plaidMap[pfc.detailed] = rules.byName.get(plaidName)!.id;
      const s = suggestCategory(
        { name, merchant, amount, accountId, plaidCategory: pfc.detailed ?? null },
        rules.categoryRules, learned, plaidMap,
      );
      return {
        user_id: item.user_id,
        account_id: accountId,
        plaid_transaction_id: t.transaction_id,
        logo_url: t.logo_url ?? t.counterparties?.[0]?.logo_url ?? null,
        website: t.website ?? t.counterparties?.[0]?.website ?? null,
        source: 'plaid',
        date: t.date,
        authorized_date: t.authorized_date,
        amount,
        currency: t.iso_currency_code ?? t.unofficial_currency_code ?? (Deno.env.get('DEFAULT_CURRENCY') ?? 'USD'),
        name,
        merchant: merchant || null,
        category_id: s.categoryId,
        category_source: s.source,
        plaid_category: pfc.detailed ?? null,
        // With a category, that category decides; the bank's own transfer hint only counts without one.
        is_transfer: s.categoryId ? rules.kindById.get(s.categoryId) === 'transfer' : isTransferCategory(pfc.primary, pfc.detailed),
        reviewed: false,
      };
    });
    // A transaction that is somehow already here is skipped rather than stopping the sync: one stray
    // duplicate must not keep every later transaction out.
    let added = 0;
    for (let i = 0; i < inserts.length; i += 500) {
      const { data, error } = await admin.from('transactions').upsert(inserts.slice(i, i + 500), { onConflict: 'plaid_transaction_id', ignoreDuplicates: true }).select('id');
      if (error) throw new Error('Saving transactions failed: ' + error.message);
      added += (data ?? []).length;
    }
    result.added = added;

    // Bank corrected something we already have: update its bank fields only. If you changed the
    // date or amount yourself, yours stays and the bank's value is kept beside it.
    for (const t of posted.filter((x) => existing.has(x.transaction_id))) {
      const mine = existing.get(t.transaction_id)!;
      await admin.from('transactions').update({
        authorized_date: t.authorized_date,
        ...(mine.original_date ? { original_date: t.date } : { date: t.date }),
        ...(mine.original_amount != null ? { original_amount: fromPlaidAmount(t.amount) } : { amount: fromPlaidAmount(t.amount) }),
      }).eq('plaid_transaction_id', t.transaction_id);
      result.updated++;
    }
    for (let i = 0; i < removed.length; i += LOOKUP_BATCH) {
      const { error } = await admin.from('transactions').delete().in('plaid_transaction_id', removed.slice(i, i + LOOKUP_BATCH));
      if (error) throw new Error('Removing transactions the bank withdrew failed: ' + error.message);
    }
    result.removed = removed.length;

    await admin.from('plaid_items').update({
      cursor, status: 'ok', error_code: null, last_synced_at: new Date().toISOString(),
    }).eq('id', item.id);
  } catch (e) {
    const code = e instanceof PlaidError ? e.code : null;
    result.status = code && RELINK_CODES.has(code) ? 'login_required' : 'error';
    result.error = e instanceof Error ? e.message : String(e);
    await admin.from('plaid_items').update({ status: result.status, error_code: code ?? 'ERROR' }).eq('id', item.id);
  }
  await admin.from('sync_runs').insert({
    user_id: item.user_id, finished_at: new Date().toISOString(), added: result.added,
    message: `${item.institution_name}: ${result.status}${result.error ? ' – ' + result.error : ''}`,
  });
  return result;
}
