/**
 * History import from another budgeting app (Mint, Monarch, YNAB, Fina, or any CSV with one row
 * per transaction).
 *
 * A mapping says which column holds what. Known exports are recognised from their header row;
 * anything else gets a best guess that you can correct on the import page.
 *
 * Exports don't say which rows are parts of one split, and same-day rows with the same bank
 * description are often separate purchases (two orders, a charge and its refund). So every row
 * is imported as its own transaction. When history overlaps transactions already in the app,
 * rows are matched to them one by one, and a group of rows whose total matches one bank
 * transaction becomes that transaction's split.
 */
import { parseCsvText } from './csv.ts';
import { daysBetween, type IsoDate } from './dates.ts';
import { parseMoney, round2 } from './money.ts';

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface HistoryRow {
  index: number;
  importId: string;   // stable across re-imports of the same export
  groupKey: string;   // date | account | description
  date: IsoDate;
  name: string;       // bank description
  merchant: string;
  category: string;   // display name, e.g. "Fast food"
  group: string;      // category group from the export, when it has one
  kind: CategoryKind;
  amount: number;
  account: string;
  notes: string;
  tags: string[];
}

export interface HistoryAccount {
  name: string;
  rows: number;
  first: IsoDate;
  last: IsoDate;
  mask: string | null;
  type: 'depository' | 'credit' | 'loan';
  subtype: string;
}

export interface HistoryCategory { name: string; kind: CategoryKind; group: string; sort: number; rows: number }

export interface HistoryExport {
  format: string;
  rows: HistoryRow[];
  accounts: HistoryAccount[];
  categories: HistoryCategory[];
}

const KIND: Record<string, CategoryKind> = { expenses: 'expense', income: 'income', transfers: 'transfer' };

/** "fast food" → "Fast food"; names you already capitalised are kept. */
export function categoryName(type: string): string {
  const t = type.trim();
  if (/^[a-z]{2}$/.test(t)) return t.toUpperCase(); // tv → TV, pc → PC
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Everyday Checking - 8691" → "Everyday Checking" (the number becomes the account's mask). */
export function cleanAccountName(name: string): string {
  return name.replace(/\s*-?\s*\d{4,}\s*$/, '').trim() || name;
}

/**
 * Common category names and the group each belongs to. Categories not listed here keep their
 * own name as a one-category group (or the group column, when the export has one).
 */
const TREE: [string, string[]][] = [
  ['Home', ['rent', 'mortgage & rent', 'mortgage', 'furniture', 'household items', 'home improvement', 'home insurance']],
  ['Bills & utilities', ['phone bill', 'mobile phone', 'internet', 'utilities', 'television', 'home phone']],
  ['Fees & charges', ['bank charges & fees', 'credit card interest', 'installment plan', 'credit card debt']],
  ['Food & dining', ['groceries', 'fast food', 'snacks', 'food delivery', 'restaurants', 'coffee shops', 'alcohol & bars']],
  ['Transportation', ['car payments', 'vehicle repairs & maintenance', 'public transportation', 'gas', 'gas & fuel', 'auto payment', 'auto insurance', 'service & parts', 'other transportation', 'taxis',
    'parking', 'parking tickets', 'license & vehicle fees', 'vehicle insurance', 'car wash']],
  ['Subscription services', ['shopping', 'tv', 'sports', 'music', 'news', 'other', 'gaming subscription']],
  ['Shopping', ['clothing', 'general goods', 'shoes', 'household supplies', 'software', 'gaming']],
  ['Electronics', ['accessories', 'computer', 'phone', 'tablet', 'laptop']],
  ['Health & wellness', ['medical', 'gym', 'other health & wellness', 'dentist', 'eyecare', 'health insurance', 'medication']],
  ['Travel & vacation', ['air travel', 'hotel']],
  ['Entertainment', ['gambling', 'movies', 'movies & dvds', 'music', 'games']],
  ['Personal care', ['hair', 'laundry', 'toiletries']],
  ['Services', ['printing', 'professional services', 'shipping', 'tailor']],
  ['Education', ['student loan', 'tuition', 'books & supplies']],
  ['Gifts & donations', ['gifts & donations']],
  ['Investments', ['investments']],
  ['Taxes', ['taxes']],
  ['Insurance', ['insurance']],
  ['Other expenses', ['other expenses']],
  ['Moving expenses', ['moving expenses']],
  ['Work expenses', ['work expenses']],
  ['Savings', ['savings']],
];
const INCOME = ['paycheck', 'paychecks', 'salary', 'bonus', 'repayment from others', 'other income', 'money from family', 'tax returns & benefits', 'cashback', 'interest income', 'sales', 'student loans'];
const TRANSFERS = ['transfer', 'transfers', 'credit card payment', 'buy & trade', 'sell & trade'];

const GROUP_OF = new Map<string, { group: string; order: number }>();
TREE.forEach(([group, names], gi) => names.forEach((n, i) => GROUP_OF.set(n, { group, order: gi * 100 + i })));

export function categoryGroup(type: string, kind: CategoryKind, given = ''): string {
  if (given.trim()) return given.trim();
  if (kind === 'income') return 'Income';
  if (kind === 'transfer') return 'Transfers';
  return GROUP_OF.get(type.trim().toLowerCase())?.group ?? categoryName(type);
}

/** Sort position: income first, then expense groups in the order above, transfers last. */
export function categorySort(type: string, kind: CategoryKind): number {
  const n = type.trim().toLowerCase();
  if (kind === 'income') return 100 + Math.max(0, INCOME.indexOf(n)) ;
  if (kind === 'transfer') return 9000 + Math.max(0, TRANSFERS.indexOf(n));
  return 1000 + (GROUP_OF.get(n)?.order ?? 7000);
}

/** "Everyday Checking - 8691" → "8691"; "Car Loan- 32481975" → "1975"; no number → null. */
export function accountMask(name: string): string | null {
  const m = name.match(/(\d{4,})\s*$/);
  return m ? m[1].slice(-4) : null;
}

export function guessAccountType(name: string): Pick<HistoryAccount, 'type' | 'subtype'> {
  const n = name.toLowerCase();
  if (/loan|mortgage|financing|line of credit/.test(n)) return { type: 'loan', subtype: /student/.test(n) ? 'student' : 'loan' };
  if (/master ?card|visa|amex|american express|discover|credit|card/.test(n)) return { type: 'credit', subtype: 'credit card' };
  if (/saving|high interest|money market/.test(n)) return { type: 'depository', subtype: 'savings' };
  return { type: 'depository', subtype: 'checking' };
}

/** Which column (by position) holds what. -1 means the export doesn't have it. */
export interface Mapping {
  format: string;          // "Mint", "Monarch", "YNAB", "Fina" or "Other"
  date: number;
  name: number;            // the description
  merchant: number;
  category: number;
  group: number;           // category group
  kind: number;            // a column saying expenses / income / transfers
  amount: number;          // one signed amount column, or…
  outflow: number;         // …money out and money in as two columns
  inflow: number;
  direction: number;       // a "debit" / "credit" column that gives the amount its sign
  account: number;
  notes: number;
  tags: number;
  dateOrder: 'ymd' | 'mdy' | 'dmy';
  flip: boolean;           // the export shows money out as positive
}

export const MAPPING_FIELDS: { key: keyof Mapping; label: string; need?: boolean }[] = [
  { key: 'date', label: 'Date', need: true }, { key: 'name', label: 'Description', need: true },
  { key: 'amount', label: 'Amount' }, { key: 'outflow', label: 'Money out' }, { key: 'inflow', label: 'Money in' },
  { key: 'direction', label: 'Debit or credit' }, { key: 'account', label: 'Account' }, { key: 'category', label: 'Category' },
  { key: 'group', label: 'Category group' }, { key: 'merchant', label: 'Merchant' }, { key: 'notes', label: 'Notes' }, { key: 'tags', label: 'Tags' },
];

/** Splits a CSV into its header row and the rows under it. */
export function readTable(text: string): { head: string[]; body: string[][] } {
  const data = parseCsvText(text);
  if (!data.length) throw new Error('That file is empty.');
  return { head: data[0].map((h) => h.trim()), body: data.slice(1) };
}

/** Works out the column mapping from the header row. Known apps first, then a best guess. */
export function detectMapping(head: string[], body: string[][] = []): Mapping {
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const has = (...names: string[]) => names.every((n) => h.includes(n));
  const m: Mapping = { format: 'Other', date: -1, name: -1, merchant: -1, category: -1, group: -1, kind: -1, amount: -1, outflow: -1, inflow: -1, direction: -1, account: -1, notes: -1, tags: -1, dateOrder: 'ymd', flip: false };

  if (has('date', 'name', 'type', 'amount', 'account', 'area')) {
    Object.assign(m, { format: 'Fina', date: col('date'), name: col('name'), merchant: col('merchant'), category: col('type'), kind: col('area'), amount: col('amount'), account: col('account'), notes: col('description'), tags: col('tag') });
  } else if (has('date', 'original description', 'transaction type', 'account name')) {
    Object.assign(m, { format: 'Mint', date: col('date'), name: col('original description'), merchant: col('description'), category: col('category'), amount: col('amount'), direction: col('transaction type'), account: col('account name'), notes: col('notes'), tags: col('labels') });
  } else if (has('date', 'merchant', 'original statement', 'amount')) {
    Object.assign(m, { format: 'Monarch', date: col('date'), name: col('original statement'), merchant: col('merchant'), category: col('category'), amount: col('amount'), account: col('account'), notes: col('notes'), tags: col('tags') });
  } else if (has('payee', 'outflow', 'inflow')) {
    Object.assign(m, { format: 'YNAB', date: col('date'), name: col('payee'), merchant: col('payee'), category: col('category'), group: col('category group'), outflow: col('outflow'), inflow: col('inflow'), account: col('account'), notes: col('memo'), tags: col('flag') });
  } else {
    Object.assign(m, {
      date: col('date', 'transaction date', 'posted date', 'posting date'),
      name: col('description', 'name', 'original description', 'original statement', 'payee', 'details', 'memo'),
      merchant: col('merchant', 'payee'),
      category: col('category', 'type'),
      group: col('category group', 'group'),
      amount: col('amount', 'value'),
      outflow: col('outflow', 'debit', 'withdrawal', 'withdrawals', 'money out'),
      inflow: col('inflow', 'credit', 'deposit', 'deposits', 'money in'),
      direction: col('transaction type'),
      account: col('account', 'account name'),
      notes: col('notes', 'note', 'memo'),
      tags: col('tags', 'labels', 'tag'),
    });
    if (m.notes === m.name) m.notes = -1;
    if (m.amount >= 0) { m.outflow = -1; m.inflow = -1; }
  }
  m.dateOrder = guessDateOrder(body.map((r) => r[m.date] ?? ''));
  return m;
}

/** ISO dates are read as they are. For 03/04/2026-style dates, a part above 12 settles which is the day. */
export function guessDateOrder(samples: string[]): Mapping['dateOrder'] {
  let dmy = false;
  for (const s of samples) {
    const p = s.trim().split(/[\/.\-\s]/).map(Number);
    if (p.length < 3 || isNaN(p[0]) || isNaN(p[1])) continue;
    if (p[0] > 31) return 'ymd';
    if (p[0] > 12) dmy = true;
    else if (p[1] > 12) return 'mdy';
  }
  return dmy ? 'dmy' : 'mdy';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads a date in the given order; also "Sep 3, 2026" and "3 Sep 2026". Returns '' when it can't. */
export function readDate(raw: string, order: Mapping['dateOrder']): IsoDate | '' {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const out = (y: number, mo: number, d: number) => (y > 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31
    ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
  if (iso) return out(+iso[1], +iso[2], +iso[3]);
  const named = s.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/) ;
  if (named && MONTHS.includes(named[1])) return out(+named[3], MONTHS.indexOf(named[1]) + 1, +named[2]);
  const named2 = s.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if (named2 && MONTHS.includes(named2[2])) return out(+named2[3], MONTHS.indexOf(named2[2]) + 1, +named2[1]);
  const p = s.split(/[\/.\-]/).map((x) => parseInt(x, 10));
  if (p.length < 3 || p.some(isNaN)) return '';
  const year = (y: number) => (y < 100 ? 2000 + y : y);
  if (order === 'ymd') return out(year(p[0]), p[1], p[2]);
  if (order === 'dmy') return out(year(p[2]), p[1], p[0]);
  return out(year(p[2]), p[0], p[1]);
}

/** Reads a whole export. Without a mapping, the columns are worked out from the header row. */
export function parseHistory(text: string, mapping?: Mapping): HistoryExport {
  const { head, body } = readTable(text);
  const m = mapping ?? detectMapping(head, body);
  if (m.date < 0) throw new Error('Pick which column holds the date.');
  if (m.name < 0 && m.merchant < 0) throw new Error('Pick which column holds the description.');
  if (m.amount < 0 && m.outflow < 0 && m.inflow < 0) throw new Error('Pick which column holds the amount.');
  if (m.format === 'Fina' && body.some((r) => r[m.date] === '-' || /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d/.test(r[m.date] ?? ''))) {
    throw new Error('This is Fina\'s "rollup" export, which has no years in its dates. Export the "raw" version instead.');
  }

  const rows: HistoryRow[] = [];
  const seen = new Map<string, number>();
  for (const r of body) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const date = readDate(get(m.date), m.dateOrder);
    let amount = m.amount >= 0 ? parseMoney(get(m.amount)) : (parseMoney(get(m.inflow)) || 0) - (parseMoney(get(m.outflow)) || 0);
    if (!date || isNaN(amount)) continue;
    if (m.amount < 0 && !get(m.inflow) && !get(m.outflow)) continue;
    if (m.direction >= 0) amount = /debit|withdraw|out|expense/i.test(get(m.direction)) ? -Math.abs(amount) : Math.abs(amount);
    if (m.flip) amount = -amount;
    amount = round2(amount);
    const rawCategory = get(m.category) || 'Uncategorized';
    const lower = rawCategory.toLowerCase();
    const group = get(m.group);
    const kind: CategoryKind = KIND[get(m.kind).toLowerCase()]
      ?? (TRANSFERS.includes(lower) || /transfer|credit card payment/.test(lower) || /transfer/i.test(group) ? 'transfer'
        : INCOME.includes(lower) || /^income$|inflow/i.test(group) || /income|paycheck|salary/.test(lower) ? 'income' : 'expense');
    const name = get(m.name) || get(m.merchant) || '(no description)';
    const account = get(m.account) || 'Imported account';
    const groupKey = `${date}|${account}|${name}`;
    // Stable id: the same row in a later export gets the same id, so a second import skips it.
    const base = `hist:${groupKey}|${amount.toFixed(2)}|${rawCategory}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({
      index: rows.length,
      importId: n === 1 ? base : `${base}#${n}`,
      groupKey, date, name,
      merchant: m.merchant === m.name ? '' : get(m.merchant),
      category: categoryName(rawCategory),
      group,
      kind, amount, account,
      notes: get(m.notes),
      tags: get(m.tags) ? get(m.tags).split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  if (!rows.length) throw new Error('No transactions found in that file. Check the date and amount columns.');

  const accounts = new Map<string, HistoryAccount>();
  const categories = new Map<string, HistoryCategory>();
  for (const r of rows) {
    const a = accounts.get(r.account);
    if (a) {
      a.rows++;
      if (r.date < a.first) a.first = r.date;
      if (r.date > a.last) a.last = r.date;
    } else {
      accounts.set(r.account, { name: r.account, rows: 1, first: r.date, last: r.date, mask: accountMask(r.account), ...guessAccountType(r.account) });
    }
    const key = r.category.toLowerCase();
    const c = categories.get(key);
    if (c) c.rows++;
    else categories.set(key, { name: r.category, kind: r.kind, group: categoryGroup(r.category, r.kind, r.group), sort: categorySort(r.category, r.kind), rows: 1 });
  }
  return {
    format: m.format,
    rows,
    accounts: [...accounts.values()].sort((x, y) => y.rows - x.rows),
    categories: [...categories.values()].sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name)),
  };
}

export interface ExistingTxn { id: string; accountId: string; date: IsoDate; amount: number }

export interface HistoryMatch {
  single: Map<number, string>;                 // row index → existing transaction id
  splits: { existingId: string; rows: number[] }[]; // several rows that together are one bank transaction
  unmatched: number[];                          // row indexes to insert as new transactions
}

/**
 * Lines imported history up with transactions the app already has. Rows only match within the
 * same account (after you map the export's accounts to the app's), with the same amount and dates no
 * more than `toleranceDays` apart; closest date wins and each existing transaction is used once.
 * Rows that share a date and description and are still unmatched are then tried as a group
 * against their total, which is how a split shows up.
 */
export function matchHistory(
  rows: { index: number; accountId: string | null; date: IsoDate; amount: number; groupKey: string }[],
  existing: ExistingTxn[],
  toleranceDays = 3,
): HistoryMatch {
  const used = new Set<string>();
  const byAccount = new Map<string, ExistingTxn[]>();
  for (const e of existing) (byAccount.get(e.accountId) ?? byAccount.set(e.accountId, []).get(e.accountId)!).push(e);
  const find = (accountId: string, date: IsoDate, amount: number) => {
    let best: ExistingTxn | null = null;
    for (const e of byAccount.get(accountId) ?? []) {
      if (used.has(e.id) || Math.abs(e.amount - amount) > 0.005) continue;
      const d = Math.abs(daysBetween(e.date, date));
      if (d <= toleranceDays && (!best || d < Math.abs(daysBetween(best.date, date)))) best = e;
    }
    return best;
  };

  const single = new Map<number, string>();
  const relevant = rows.filter((r) => r.accountId && byAccount.has(r.accountId));
  for (const r of [...relevant].sort((a, b) => a.date.localeCompare(b.date))) {
    const e = find(r.accountId!, r.date, r.amount);
    if (e) { used.add(e.id); single.set(r.index, e.id); }
  }

  const splits: HistoryMatch['splits'] = [];
  const groups = new Map<string, typeof rows>();
  for (const r of relevant) if (!single.has(r.index)) (groups.get(r.groupKey) ?? groups.set(r.groupKey, []).get(r.groupKey)!).push(r);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const e = find(g[0].accountId!, g[0].date, round2(g.reduce((s, r) => s + r.amount, 0)));
    if (e) { used.add(e.id); splits.push({ existingId: e.id, rows: g.map((r) => r.index) }); }
  }

  const inSplit = new Set(splits.flatMap((s) => s.rows));
  const unmatched = rows.filter((r) => !single.has(r.index) && !inSplit.has(r.index)).map((r) => r.index);
  return { single, splits, unmatched };
}
