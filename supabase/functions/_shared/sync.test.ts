// Run: deno test supabase/functions/_shared/sync.test.ts
// Exercises syncItem() against a fake Plaid API and an in-memory stand-in for the database.
import { syncItem } from './sync.ts';

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
    let single = false;
    let returning = false;
    const run = () => {
      const t = tables[name];
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: `${name}-${++idSeq}`, ...r }));
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
      update: (p: any) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return q; },
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
  assertEquals(r1.added, 4, 'pending skipped');
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

Deno.test('syncItem marks connections that need a new sign-in', async () => {
  const tables: Record<string, Row[]> = { accounts: [], transactions: [], merchant_rules: [], category_rules: [], categories: [],
    plaid_items: [{ id: 'i', user_id: 'u', item_id: 'item-2', institution_name: 'Bank', access_token_secret_id: 's', cursor: null }], sync_runs: [] };
  globalThis.fetch = (async () => new Response(JSON.stringify({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' }), { status: 400 })) as typeof fetch;
  const r = await syncItem(fakeDb(tables), tables.plaid_items[0] as any);
  assertEquals(r.status, 'login_required');
  assertEquals(tables.plaid_items[0].status, 'login_required');
  assertEquals(tables.sync_runs.length, 1);
});
