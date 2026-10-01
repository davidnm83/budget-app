/**
 * One-time history import from Fina (app.fina.money → export → "raw" CSV).
 *
 * The raw export has one row per transaction, or per part of a split transaction:
 *   date,name,merchant,type,amount,currency,account,area,tag,description,city,region
 * "type" is the category, "area" is expenses / income / transfers, "description" is your note.
 * Amounts already use this app's sign (money out negative).
 *
 * The export doesn't say which rows are parts of one split, and same-day rows with the same
 * bank description are often separate purchases (two Amazon orders, a charge and its refund).
 * So every row is imported as its own transaction. When history overlaps transactions already in
 * the app, rows are matched to them one by one, and a group of rows whose total matches one bank
 * transaction becomes that transaction's split.
 */
import { parseCsvText } from './csv.ts';
import { daysBetween, type IsoDate } from './dates.ts';
import { parseMoney, round2 } from './money.ts';

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface FinaRow {
  index: number;
  importId: string;   // stable across re-imports of the same export
  groupKey: string;   // date | account | description
  date: IsoDate;
  name: string;       // bank description
  merchant: string;
  category: string;   // display name, e.g. "Fast food"
  kind: CategoryKind;
  amount: number;
  account: string;
  notes: string;
  tags: string[];
}

export interface FinaAccount {
  name: string;
  rows: number;
  first: IsoDate;
  last: IsoDate;
  mask: string | null;
  type: 'depository' | 'credit' | 'loan';
  subtype: string;
}

export interface FinaCategory { name: string; kind: CategoryKind; group: string; sort: number; rows: number }

export interface FinaExport {
  rows: FinaRow[];
  accounts: FinaAccount[];
  categories: FinaCategory[];
}

const KIND: Record<string, CategoryKind> = { expenses: 'expense', income: 'income', transfers: 'transfer' };

/** "fast food" → "Fast food"; names you already capitalised are kept. */
export function finaCategoryName(type: string): string {
  const t = type.trim();
  if (/^[a-z]{2}$/.test(t)) return t.toUpperCase(); // tv → TV, pc → PC
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "CIBC Chequing - 8691" → "CIBC Chequing" (the number becomes the account's mask). */
export function finaAccountName(name: string): string {
  return name.replace(/\s*-?\s*\d{4,}\s*$/, '').trim() || name;
}

/**
 * Fina's default category tree (expenses), in Fina's order. Categories not listed here keep
 * their own name as a one-category group, like Fina's top-level ones ("Gifts & donations").
 * Rename or move them in the app afterwards.
 */
const FINA_TREE: [string, string[]][] = [
  ['Home', ['rent', 'furniture', 'household items']],
  ['Bills & utilities', ['phone bill']],
  ['Fees & charges', ['bank charges & fees', 'credit card interest', 'installment plan', 'credit card debt']],
  ['Food & dining', ['groceries', 'fast food', 'snacks', 'food delivery', 'restaurants', 'coffee shops', 'movie snacks', 'creami']],
  ['Transportation', ['car payments', 'vehicle repairs & maintenance', 'public transportation', 'gas', 'other transportation', 'taxis',
    'parking', 'parking tickets', 'license & vehicle fees', 'vehicle insurance', 'car wash']],
  ['Subscription services', ['shopping', 'tv', 'sports', 'music', 'news', 'other', 'gaming subscription']],
  ['Shopping', ['clothing', 'general goods', 'shoes', 'household supplies', 'software', 'gaming']],
  ['Electronics', ['accessories', 'keyboard', 'pc', 'phone', 'tablet', 'laptop']],
  ['Health & wellness', ['medical', 'gym', 'other health & wellness', 'dentist', 'eyecare', 'health insurance', 'medication']],
  ['Travel & vacation', ['air travel', 'hotel']],
  ['Entertainment', ['gambling', 'alcohol & bars', 'movies']],
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
const FINA_INCOME = ['paycheck', 'repayment from others', 'other income', 'money from family', 'tax returns & benefits', 'cashback', 'interest income', 'sales', 'student loans'];
const FINA_TRANSFERS = ['transfer', 'credit card payment', 'buy & trade', 'sell & trade'];

const GROUP_OF = new Map<string, { group: string; order: number }>();
FINA_TREE.forEach(([group, names], gi) => names.forEach((n, i) => GROUP_OF.set(n, { group, order: gi * 100 + i })));

export function finaCategoryGroup(type: string, kind: CategoryKind): string {
  if (kind === 'income') return 'Income';
  if (kind === 'transfer') return 'Transfers';
  return GROUP_OF.get(type.trim().toLowerCase())?.group ?? finaCategoryName(type);
}

/** Sort position that keeps Fina's order: income first, then expense groups as Fina lists them, transfers last. */
export function finaCategorySort(type: string, kind: CategoryKind): number {
  const n = type.trim().toLowerCase();
  if (kind === 'income') return 100 + Math.max(0, FINA_INCOME.indexOf(n)) ;
  if (kind === 'transfer') return 9000 + Math.max(0, FINA_TRANSFERS.indexOf(n));
  return 1000 + (GROUP_OF.get(n)?.order ?? 7000);
}

/** "CIBC Chequing - 8691" → "8691"; "Ford Escape- 32481975" → "1975"; no number → null. */
export function accountMask(name: string): string | null {
  const m = name.match(/(\d{4,})\s*$/);
  return m ? m[1].slice(-4) : null;
}

export function guessAccountType(name: string): Pick<FinaAccount, 'type' | 'subtype'> {
  const n = name.toLowerCase();
  if (/loan|escape|auto|mortgage|finance/.test(n)) return { type: 'loan', subtype: /student/.test(n) ? 'student' : 'loan' };
  if (/master ?card|visa|amex|american express|aeroplan|cobalt|credit/.test(n)) return { type: 'credit', subtype: 'credit card' };
  if (/saving|tfsa|high interest/.test(n)) return { type: 'depository', subtype: 'savings' };
  return { type: 'depository', subtype: 'checking' };
}

export function parseFinaExport(text: string): FinaExport {
  const data = parseCsvText(text);
  if (!data.length) throw new Error('That file is empty.');
  const head = data[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  for (const need of ['date', 'name', 'type', 'amount', 'account', 'area']) {
    if (col(need) < 0) throw new Error(`This doesn't look like a Fina export (no "${need}" column).`);
  }
  const body = data.slice(1);
  if (body.some((r) => r[col('date')] === '-') || body.some((r) => /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d/.test(r[col('date')] ?? ''))) {
    throw new Error('This is Fina\'s "rollup" export, which has no years in its dates. Export the "raw" version instead.');
  }

  const rows: FinaRow[] = [];
  const seen = new Map<string, number>();
  const groupCount = new Map<string, number>();
  for (const r of body) {
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const date = get('date');
    const amount = parseMoney(get('amount'));
    const kind = KIND[get('area').toLowerCase()];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(amount) || !kind) continue;
    const name = get('name');
    const account = get('account');
    const groupKey = `${date}|${account}|${name}`;
    // Stable id: the same row in a later export gets the same id, so a second import skips it.
    const base = `fina:${groupKey}|${round2(amount).toFixed(2)}|${get('type')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    groupCount.set(groupKey, (groupCount.get(groupKey) ?? 0) + 1);
    rows.push({
      index: rows.length,
      importId: n === 1 ? base : `${base}#${n}`,
      groupKey,
      date,
      name: name || get('merchant') || '(no description)',
      merchant: get('merchant'),
      category: finaCategoryName(get('type')),
      kind,
      amount: round2(amount),
      account,
      notes: get('description'),
      tags: get('tag') ? get('tag').split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  if (!rows.length) throw new Error('No transactions found in that file.');

  const accounts = new Map<string, FinaAccount>();
  const categories = new Map<string, FinaCategory>();
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
    else categories.set(key, { name: r.category, kind: r.kind, group: finaCategoryGroup(r.category, r.kind), sort: finaCategorySort(r.category, r.kind), rows: 1 });
  }
  return {
    rows,
    accounts: [...accounts.values()].sort((x, y) => y.rows - x.rows),
    categories: [...categories.values()].sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name)),
  };
}

export interface ExistingTxn { id: string; accountId: string; date: IsoDate; amount: number }

export interface HistoryMatch {
  single: Map<number, string>;                 // Fina row index → existing transaction id
  splits: { existingId: string; rows: number[] }[]; // several Fina rows that together are one bank transaction
  unmatched: number[];                          // Fina row indexes to insert as new transactions
}

/**
 * Lines imported history up with transactions the app already has. Rows only match within the
 * same account (after you map Fina's accounts to the app's), with the same amount and dates no
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
