// Run: deno test supabase/functions/_shared/sync.test.ts
// Exercises syncItem() against a fake Plaid API and an in-memory stand-in for the database.
import { syncItem, trackBalanceGaps } from './sync.ts';
import { processLoans } from './loans.ts';
import { pairRecentTransfers } from './transfers.ts';

function assertEquals(a: unknown, b: unknown, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
}

// ── tiny fake of the supabase-js query builder (only what sync.ts uses) ──
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>) {
  let idSeq = 0;
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let tooMany = false;
    let single = false;
    let returning = false;
    let conflict: string | null = null;
    const run = () => {
      const t = tables[name];
      // Like the real server: a lookup with too many ids in it is refused.
      if (op === 'select' && tooMany) return { data: null, error: { message: 'URI too long' } };
      if (op === 'insert') {
        const fresh = (Array.isArray(payload) ? payload : [payload]).filter((r: Row) => !conflict || !t.some((x) => x[conflict!] === r[conflict!]));
        const rows = fresh.map((r: Row) => ({ id: `${name}-${++idSeq}`, ...r }));
        t.push(...rows);
        return { data: returning ? (single ? rows[0] : rows) : null, error: null };
      }
      let rows = t.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { rows.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { tables[name] = t.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      if (order) rows = [...rows].sort((a, b) => (a[order!.col] < b[order!.col] ? 1 : -1) * (order!.asc ? -1 : 1));
      rows = rows.slice(0, limit);
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const q: any = {
      select: () => { if (op !== 'select') returning = true; return q; },
      insert: (p: any) => { op = 'insert'; payload = p; return q; },
      upsert: (p: any, o: { onConflict: string }) => { op = 'insert'; payload = p; conflict = o.onConflict; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] >= v); return q; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] > v); return q; },
      lt: (c: string, v: any) => { filters.push((r) => r[c] < v); return q; },
      lte: (c: string, v: any) => { filters.push((r) => r[c] <= v); return q; },
      in: (c: string, v: any[]) => { if (v.length > 100) tooMany = true; filters.push((r) => v.includes(r[c])); return q; },
      not: (c: string, _o: string, _v: any) => { filters.push((r) => r[c] != null); return q; },
      order: (col: string, o: { ascending: boolean }) => { order = { col, asc: o.ascending }; return q; },
      limit: (n: number) => { limit = n; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from, rpc: async (_fn: string, _args: any) => ({ data: 'access-token', error: null }) } as any;
}

// ── fake Plaid ──
function fakePlaid(pages: any[], accounts: any[]) {
  globalThis.fetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    const path = new URL(url).pathname;
    let out: any;
    if (path === '/accounts/get') out = { accounts };
    else if (path === '/transactions/sync') out = pages.find((p) => p.from === (body.cursor ?? '')).res;
    else out = { error_code: 'NOT_FOUND' };
    return new Response(JSON.stringify(out), { status: out.error_code ? 400 : 200 });
  }) as typeof fetch;
}

const tx = (id: string, acct: string, date: string, amount: number, name: string, extra: Row = {}) => ({
  transaction_id: id, account_id: acct, date, authorized_date: date, amount, pending: false, name, original_description: name,
  merchant_name: null, iso_currency_code: 'CAD', personal_finance_category: null, ...extra,
});

Deno.test('syncItem writes posted transactions with merchant + category, keeps edits on re-sync', async () => {
  Deno.env.set('PLAID_ENV', 'sandbox');
  const user = 'u1';
  const tables: Record<string, Row[]> = {
    accounts: [],
    transactions: [
      // a reviewed past purchase teaches "Superstore → groceries"
      { id: 'old', user_id: user, account_id: 'x', merchant: 'Superstore', category_id: 'cat-groceries', reviewed: true, date: '2026-08-01' },
    ],
    merchant_rules: [{ user_id: user, match: 'RCSS', merchant: 'Superstore' }],
    category_rules: [{ user_id: user, match_text: 'GOODLIFE', category_id: 'cat-gym', account_id: null, min_amount: null, max_amount: null }],
    categories: [
      { id: 'cat-groceries', user_id: user, name: 'Groceries', kind: 'expense' },
      { id: 'cat-gym', user_id: user, name: 'Gym', kind: 'expense' },
      { id: 'cat-gas', user_id: user, name: 'Gas', kind: 'expense' },
      { id: 'cat-cc', user_id: user, name: 'Credit Card Payment', kind: 'transfer' },
    ],
    plaid_items: [{ id: 'item-row', user_id: user, item_id: 'item-1', institution_name: 'Test Bank', access_token_secret_id: 's', cursor: null }],
    sync_runs: [],
  };
  const db = fakeDb(tables);
  const accounts = [{ account_id: 'pa1', name: 'Chequing', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 500, available: 480, iso_currency_code: 'CAD' } }];
  fakePlaid([
    { from: '', res: { added: [
      tx('t1', 'pa1', '2026-09-28', 25.95, 'RETAIL PURCHASE 001001001514 RCSS 1077'),            // learned
      tx('t2', 'pa1', '2026-09-16', 48.58, 'PREAUTHORIZED DEBIT GOODLIFE FITNESS'),             // rule
      tx('t3', 'pa1', '2026-09-15', 83.33, 'ESSO CIRCLE K', { personal_finance_category: { primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_GAS' } }),
      tx('t4', 'pa1', '2026-09-14', -415, 'INTERNET BILL PAY MASTERCARD', { personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' } }),
      tx('t5', 'pa1', '2026-09-29', 9.99, 'PENDING THING', { pending: true }),
    ], modified: [], removed: [], next_cursor: 'c1', has_more: false } },
    { from: 'c1', res: { added: [], modified: [tx('t1', 'pa1', '2026-09-28', 26.95, 'RETAIL PURCHASE 001001001514 RCSS 1077')], removed: [{ transaction_id: 't3' }], next_cursor: 'c2', has_more: false } },
  ], accounts);

  const r1 = await syncItem(db, tables.plaid_items[0] as any);
  assertEquals(r1.status, 'ok', r1.error);
  assertEquals(r1.added, 5, 'pending kept');
  assertEquals([tables.transactions.find((t) => t.plaid_transaction_id === 't5')!.pending, tables.transactions.find((t) => t.plaid_transaction_id === 't5')!.reviewed], [true, true]);
  const byId = (id: string) => tables.transactions.find((t) => t.plaid_transaction_id === id)!;
  assertEquals([byId('t1').merchant, byId('t1').category_id, byId('t1').category_source, byId('t1').amount], ['Superstore', 'cat-groceries', 'learned', -25.95]);
  assertEquals([byId('t2').category_id, byId('t2').category_source], ['cat-gym', 'rule']);
  assertEquals([byId('t3').category_id, byId('t3').category_source], ['cat-gas', 'plaid']);
  assertEquals([byId('t4').is_transfer, byId('t4').amount], [true, 415]);
  assertEquals(tables.accounts.length, 1);
  assertEquals(tables.accounts[0].current_balance, 500);
  assertEquals(tables.plaid_items[0].cursor, 'c1');

  // user edits t1, then the bank corrects its amount and removes t3
  byId('t1').category_id = 'cat-gym'; byId('t1').reviewed = true; byId('t1').merchant = 'My Name';
  tables.accounts[0].name = 'Renamed by me';
  accounts[0].balances.current = 474.05;
  const r2 = await syncItem(db, tables.plaid_items[0] as any);
  assertEquals([r2.added, r2.updated, r2.removed], [0, 1, 1]);
  assertEquals([byId('t1').amount, byId('t1').category_id, byId('t1').merchant, byId('t1').reviewed], [-26.95, 'cat-gym', 'My Name', true]);
  assertEquals(tables.transactions.some((t) => t.plaid_transaction_id === 't3'), false);
  assertEquals([tables.accounts[0].name, tables.accounts[0].current_balance], ['Renamed by me', 474.05]);
});

Deno.test('a large batch the bank sends again is recognised, not saved twice', async () => {
  // What happened to a real connection: after signing in again the bank re-sent months of history.
  // Asking "which of these do we have?" for hundreds of ids at once was refused by the server, the
  // refusal was ignored, every row looked new, and saving them failed on the duplicate key.
  Deno.env.set('PLAID_ENV', 'sandbox');
  const user = 'u1';
  const ids = Array.from({ length: 250 }, (_, i) => `big-${i}`);
  const tables: Record<string, Row[]> = {
    accounts: [{ id: 'acct', user_id: user, plaid_account_id: 'pa1', plaid_item_id: 'item-row', kind: 'plaid', name: 'Chequing', type: 'depository' }],
    transactions: ids.map((id) => ({ id: 'row-' + id, user_id: user, account_id: 'acct', plaid_transaction_id: id, date: '2026-09-10', amount: -5, name: 'CORNER SHOP', merchant: 'Corner Shop' })),
    merchant_rules: [], category_rules: [], categories: [],
    plaid_items: [{ id: 'item-row', user_id: user, item_id: 'item-1', institution_name: 'Test Bank', access_token_secret_id: 's', cursor: 'old' }],
    sync_runs: [],
  };
  const db = fakeDb(tables);
  fakePlaid([{ from: 'old', res: { added: [...ids.map((id) => tx(id, 'pa1', '2026-09-10', 5, 'CORNER SHOP')), tx('new-1', 'pa1', '2026-10-01', 7, 'CORNER SHOP')], modified: [], removed: [], next_cursor: 'c9', has_more: false } }],
    [{ account_id: 'pa1', name: 'Chequing', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 500, available: 480, iso_currency_code: 'CAD' } }]);
  const r = await syncItem(db, tables.plaid_items[0] as any);
  assertEquals(r.status, 'ok', r.error);
  assertEquals(r.added, 1, 'only the one new transaction');
  assertEquals(tables.transactions.length, 251);
  assertEquals(new Set(tables.transactions.map((t) => t.plaid_transaction_id)).size, 251, 'no id twice');
  assertEquals(tables.plaid_items[0].cursor, 'c9');
});

Deno.test('syncItem links bank rows to imported ones and keeps your edited date/amount', async () => {
  Deno.env.set('PLAID_ENV', 'sandbox');
  const user = 'u1';
  const tables: Record<string, Row[]> = {
    accounts: [{ id: 'acc', user_id: user, plaid_account_id: 'pa1', name: 'Card' }],
    transactions: [
      // from a Fina import: reviewed and categorised, no Plaid id
      { id: 'imp', user_id: user, account_id: 'acc', plaid_transaction_id: null, date: '2026-09-02', amount: -40, category_id: 'cat-x', reviewed: true, source: 'import' },
    ],
    merchant_rules: [], category_rules: [], categories: [],
    plaid_items: [{ id: 'item-row', user_id: user, item_id: 'item-1', institution_name: 'Bank', access_token_secret_id: 's', cursor: null }],
    sync_runs: [],
  };
  fakePlaid([
    { from: '', res: { added: [tx('b1', 'pa1', '2026-09-03', 40, 'SHOP'), tx('b2', 'pa1', '2026-09-05', 12, 'OTHER')], modified: [], removed: [], next_cursor: 'c1', has_more: false } },
    { from: 'c1', res: { added: [], modified: [tx('b2', 'pa1', '2026-09-06', 13, 'OTHER')], removed: [], next_cursor: 'c2', has_more: false } },
  ], [{ account_id: 'pa1', name: 'Card', balances: { current: 1 } }]);
  const db = fakeDb(tables);
  const r1 = await syncItem(db, tables.plaid_items[0] as any);
  assertEquals([r1.added, r1.updated], [1, 1]);
  const imp = tables.transactions.find((t) => t.id === 'imp')!;
  assertEquals([imp.plaid_transaction_id, imp.category_id, imp.reviewed, imp.date], ['b1', 'cat-x', true, '2026-09-02']);
  // you change b2's amount; then the bank corrects it
  const b2 = tables.transactions.find((t) => t.plaid_transaction_id === 'b2')!;
  Object.assign(b2, { amount: -12.5, original_amount: -12 });
  await syncItem(db, tables.plaid_items[0] as any);
  assertEquals([b2.amount, b2.original_amount, b2.date], [-12.5, -13, '2026-09-06']);
});

Deno.test('linking a bank takes over the matching manual account and its imported history', async () => {
  Deno.env.set('PLAID_ENV', 'sandbox');
  const user = 'u1';
  const tables: Record<string, Row[]> = {
    accounts: [{ id: 'man', user_id: user, kind: 'manual', mask: '2009', type: 'credit', plaid_account_id: null, name: 'American Express Cobalt', start_balance: -100 }],
    transactions: [
      { id: 'i1', user_id: user, account_id: 'man', plaid_transaction_id: null, date: '2026-09-02', amount: -40, name: 'SHOP', category_id: 'c1', reviewed: true },
      { id: 'i2', user_id: user, account_id: 'man', plaid_transaction_id: null, date: '2026-09-05', amount: -29.37, name: 'AMAZON', category_id: 'c2', notes: 'desk', reviewed: true },
      { id: 'i3', user_id: user, account_id: 'man', plaid_transaction_id: null, date: '2026-09-05', amount: -18.07, name: 'AMAZON', category_id: 'c3', reviewed: true },
    ],
    transaction_splits: [], merchant_rules: [], category_rules: [], categories: [],
    plaid_items: [{ id: 'item-row', user_id: user, item_id: 'item-3', institution_name: 'American Express', access_token_secret_id: 's', cursor: null }],
    sync_runs: [],
  };
  fakePlaid([{ from: '', res: { added: [
    tx('b1', 'amex', '2026-09-03', 40, 'SHOP'), tx('b2', 'amex', '2026-09-06', 47.44, 'AMAZON'), tx('b3', 'amex', '2026-09-07', 5, 'NEW'),
  ], modified: [], removed: [], next_cursor: 'c1', has_more: false } }],
  [{ account_id: 'amex', name: 'Cobalt', mask: '32009', type: 'credit', subtype: 'credit card', balances: { current: 2500.77 } }]);
  const r = await syncItem(fakeDb(tables), tables.plaid_items[0] as any);
  assertEquals([r.status, r.added, r.updated], ['ok', 1, 2], r.error);
  assertEquals(tables.accounts.length, 1);
  assertEquals([tables.accounts[0].kind, tables.accounts[0].plaid_account_id, tables.accounts[0].name, tables.accounts[0].start_balance], ['plaid', 'amex', 'American Express Cobalt', null]);
  const byId = (id: string) => tables.transactions.find((t) => t.id === id);
  assertEquals([byId('i1')!.plaid_transaction_id, byId('i1')!.category_id], ['b1', 'c1']);
  assertEquals([byId('i2')!.plaid_transaction_id, byId('i2')!.amount, byId('i2')!.category_id], ['b2', -47.44, null]);
  assertEquals(byId('i3'), undefined);
  assertEquals(tables.transaction_splits.map((x) => [x.transaction_id, x.category_id, x.amount, x.notes ?? null]), [['i2', 'c2', -29.37, 'desk'], ['i2', 'c3', -18.07, null]]);
  assertEquals(tables.transactions.filter((t) => t.plaid_transaction_id === 'b3').length, 1);
});

Deno.test('syncItem marks connections that need a new sign-in', async () => {
  const tables: Record<string, Row[]> = { accounts: [], transactions: [], merchant_rules: [], category_rules: [], categories: [],
    plaid_items: [{ id: 'i', user_id: 'u', item_id: 'item-2', institution_name: 'Bank', access_token_secret_id: 's', cursor: null }], sync_runs: [] };
  globalThis.fetch = (async () => new Response(JSON.stringify({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' }), { status: 400 })) as typeof fetch;
  const r = await syncItem(fakeDb(tables), tables.plaid_items[0] as any);
  assertEquals(r.status, 'login_required');
  assertEquals(tables.plaid_items[0].status, 'login_required');
  assertEquals(tables.sync_runs.length, 1);
});

Deno.test('loans: payments copied from chequing once, interest logged from the balance change', async () => {
  const user = 'u1';
  const tables: Record<string, Row[]> = {
    accounts: [
      { id: 'loan', user_id: user, type: 'loan', kind: 'plaid', name: 'Car loan', current_balance: 10000, loan_payment_match: 'TD ON-LINE LOANS',
        loan_paying_account_id: null, loan_last_balance: 10350, loan_last_balance_date: '2026-09-01' },
      { id: 'chq', user_id: user, type: 'depository', kind: 'plaid', name: 'Chequing' },
    ],
    transactions: [
      { id: 'p1', user_id: user, account_id: 'chq', date: '2026-09-10', amount: -200, name: 'TD ON-LINE LOANS 123', merchant: null },
      { id: 'p2', user_id: user, account_id: 'chq', date: '2026-09-24', amount: -200, name: 'TD ON-LINE LOANS 456', merchant: null },
      { id: 'x', user_id: user, account_id: 'chq', date: '2026-09-24', amount: -12, name: 'COFFEE', merchant: null },
      // already on the loan from the Fina import (same amount, 1 day apart) → not copied again
      { id: 'old', user_id: user, account_id: 'loan', date: '2026-09-11', amount: 200, name: 'LOAN PAYMENT' },
    ],
    categories: [{ id: 'tr', user_id: user, name: 'Transfer', kind: 'transfer' }],
  };
  const r = await processLoans(fakeDb(tables), user, '2026-09-30');
  assertEquals(r[0].payments, 1);
  const copied = tables.transactions.filter((t) => t.import_id === 'loanpay:p2');
  assertEquals([copied.length, copied[0].amount, copied[0].is_transfer], [1, 200, true]);
  assertEquals(tables.transactions.find((t) => t.id === 'p2')!.is_transfer, true);
  // 10000 − 10350 + 400 paid = 50 interest (under 35% of payments) → logged
  assertEquals(r[0].interest, 50);
  const int = tables.transactions.find((t) => String(t.import_id).startsWith('loanint:'))!;
  assertEquals([int.amount, int.name], [-50, 'Interest Accrued Sep 2 - Sep 30']);
  assertEquals([tables.accounts[0].loan_last_balance, tables.accounts[0].loan_last_balance_date], [10000, '2026-09-30']);
  // running again copies nothing new
  const again = await processLoans(fakeDb(tables), user, '2026-09-30');
  assertEquals(again[0].payments, 0);
});

Deno.test('transfers: card payment paired with the payment received on the card', async () => {
  const user = 'u1';
  const tables: Record<string, Row[]> = {
    transactions: [
      { id: 'out', user_id: user, account_id: 'chq', date: '2026-09-10', amount: -500, is_transfer: false, category_id: 'cc', transfer_pair_id: null },
      { id: 'in', user_id: user, account_id: 'card', date: '2026-09-11', amount: 500, is_transfer: false, category_id: null, transfer_pair_id: null },
    ],
    categories: [{ id: 'cc', user_id: user, name: 'Credit card payment', kind: 'transfer' }],
  };
  assertEquals(await pairRecentTransfers(fakeDb(tables), user, '2026-09-30'), 1);
  const [o, i] = tables.transactions;
  assertEquals([o.transfer_pair_id, i.transfer_pair_id, o.is_transfer, i.is_transfer, i.category_id], ['in', 'out', true, true, 'cc']);
});

Deno.test('a pending transaction is replaced in place when it posts, keeping its category', async () => {
  Deno.env.set('PLAID_ENV', 'sandbox');
  const user = 'u1';
  const tables: Record<string, Row[]> = {
    accounts: [], transactions: [], merchant_rules: [], category_rules: [],
    categories: [{ id: 'cat-food', user_id: user, name: 'Restaurants', kind: 'expense' }],
    plaid_items: [{ id: 'item-row', user_id: user, item_id: 'item-1', institution_name: 'Test Bank', access_token_secret_id: 's', cursor: null }],
    sync_runs: [],
  };
  const db = fakeDb(tables);
  const accounts = [{ account_id: 'pa1', name: 'Visa', mask: '4242', type: 'credit', subtype: 'credit card', balances: { current: 40, available: 960, iso_currency_code: 'CAD' } }];
  fakePlaid([
    { from: '', res: { added: [tx('p1', 'pa1', '2026-10-03', 35, 'PIZZA PLACE', { pending: true })], modified: [], removed: [], next_cursor: 'c1', has_more: false } },
    { from: 'c1', res: { added: [tx('s1', 'pa1', '2026-10-04', 41.5, 'PIZZA PLACE TORONTO ON', { pending_transaction_id: 'p1' })], modified: [], removed: [{ transaction_id: 'p1' }], next_cursor: 'c2', has_more: false } },
  ], accounts);
  await syncItem(db, tables.plaid_items[0] as any);
  assertEquals(tables.transactions.length, 1);
  const row = tables.transactions[0];
  assertEquals([row.pending, row.reviewed], [true, true]);
  row.category_id = 'cat-food'; row.category_source = 'manual'; row.notes = 'with Sam';
  const r2 = await syncItem(db, { ...tables.plaid_items[0], cursor: 'c1' } as any);
  assertEquals(r2.status, 'ok', r2.error);
  assertEquals(tables.transactions.length, 1, 'replaced, not added and removed');
  assertEquals([row.plaid_transaction_id, row.pending, row.amount, row.date, row.category_id, row.notes], ['s1', false, -41.5, '2026-10-04', 'cat-food', 'with Sam']);
});

Deno.test('balance gap: money the bank counted but has not listed yet', async () => {
  const tables: Record<string, Row[]> = {
    accounts: [{ id: 'a1', type: 'depository', current_balance: 450, balance_anchor: 500, balance_anchor_at: new Date(Date.now() - 86_400_000).toISOString() }],
    transactions: [{ id: 't', account_id: 'a1', amount: -20, created_at: new Date().toISOString() }],
  };
  const db = fakeDb(tables);
  await trackBalanceGaps(db, ['a1']);
  assertEquals(tables.accounts[0].balance_gap, -30, '$50 down, $20 of it listed');
  // The rest arrives: the gap closes and the anchor moves on.
  tables.transactions.push({ id: 'u', account_id: 'a1', amount: -30, created_at: new Date().toISOString() });
  await trackBalanceGaps(db, ['a1']);
  assertEquals([tables.accounts[0].balance_gap, tables.accounts[0].balance_anchor], [0, 450]);
});
