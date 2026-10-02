// What a chart widget can show. Each source turns the account's data into the same shape, so
// any view (bars, line, pie, list, table, tiles) can draw it and a tap can open what's behind it.
import { addDays, addMonths, balanceHistory, daysBetween, loanSummary, monthName, monthOf, categoryIcon, formatMoney, monthEnd, shortDate } from '@budget-app/core';
import { supabase } from './supabase';
import type { TxnQuery } from '@/components/TxnSheet';
import { loadTxnsFor } from './accountTxns';
import { loadAccounts, today } from './plan';
import { loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, type Category } from './reports';
import { signedBalance, type Account } from './types';

export type Source = 'spending' | 'cashflow' | 'networth' | 'carddebt' | 'balance';
/** How a chart's total is split into parts (for the pie, the ranked list and the table). */
export type SplitBy = 'category' | 'group' | 'account' | 'type';
export type ChartView = 'bars' | 'line' | 'pie' | 'list' | 'table' | 'tiles';
export const VIEW_LABEL: Record<ChartView, string> = { bars: 'Bars', line: 'Line', pie: 'Pie', list: 'Ranked list', table: 'Table', tiles: 'Numbers' };
export const SOURCES: Record<Source, { title: string; about: string; views: ChartView[] }> = {
  spending: { title: 'Spending', about: 'All spending or the categories you choose, by month and by category', views: ['bars', 'line', 'pie', 'list', 'table', 'tiles'] },
  cashflow: { title: 'Money in and out', about: 'Income against spending each month', views: ['bars', 'line', 'table', 'tiles'] },
  networth: { title: 'Net worth', about: 'Everything you own minus everything you owe, over time, and by account or type', views: ['line', 'bars', 'list', 'table', 'tiles'] },
  carddebt: { title: 'Card debt', about: 'What you owe on credit cards over time, and by card', views: ['line', 'bars', 'pie', 'list', 'table', 'tiles'] },
  balance: { title: 'Account balance', about: 'One account, or several added together, over time', views: ['line', 'bars', 'pie', 'list', 'table', 'tiles'] },
};

/** Which ways each source can be split. The first is the default. */
export const SPLITS: Record<Source, SplitBy[]> = { spending: ['category', 'group', 'account'], cashflow: [], networth: ['account', 'type'], carddebt: ['account'], balance: ['account'] };
export const SPLIT_LABEL: Record<SplitBy, string> = { category: 'Category', group: 'Group', account: 'Account', type: 'Account type' };

export interface ChartCfg {
  source?: Source; months?: number; categoryIds?: string[]; group?: string; names?: string[];
  /** Only these accounts. None = all (Account balance needs at least one). */
  accountIds?: string[];
  /** Older single-account settings: an id, or a pattern matched against account names. */
  accountId?: string; accountMatch?: string;
  by?: SplitBy;
  /** A dashed line at the average of the period. */
  avg?: boolean;
  /** One loan picked under Account balance: add its payoff date and interest to the numbers. */
  payoff?: boolean;
}
export interface ChartData {
  labels: string[];
  series: { name: string; values: number[] }[];
  /** Parts of the whole over the period (categories, cards, apps), biggest first. Empty when the source has none. */
  breakdown: { label: string; value: number; query?: Omit<TxnQuery, 'title' | 'from' | 'to'> }[];
  tiles: { label: string; value: string; sub?: string }[];
  /** A dashed line across the chart, when asked for. */
  refLine?: number;
  /** The transactions behind point i, when there are any to show. */
  drill?: (i: number) => Omit<TxnQuery, 'title'> | null;
  period: string; from: string; to: string;
  /** A better default title than the source's name (the account's name for a single account). */
  title?: string;
  empty?: string;
}

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
const monthShort = (m: string) => new Date(m + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });
const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);

/** Which categories a spending widget covers: picked ones, a whole group, or by name (templates). None = all spending. */
export function cfgCategories(cfg: ChartCfg, cats: Category[]): Category[] {
  if (cfg.categoryIds?.length) return cats.filter((c) => cfg.categoryIds!.includes(c.id));
  if (cfg.group) return cats.filter((c) => c.kind === 'expense' && c.group.toLowerCase() === cfg.group!.toLowerCase());
  if (cfg.names?.length) return cats.filter((c) => cfg.names!.some((n) => n.toLowerCase() === c.name.toLowerCase()));
  return [];
}

/**
 * `anchor` is the month a page is showing (Budget); periods then end at that month, not this one.
 * `range` is a page's date range (Reports): the chart covers the months it spans (whole months,
 * at most the last 24), whatever period the widget was set to.
 */
export async function loadChart(cfg: ChartCfg, anchor?: string, range?: { from: string; to: string }): Promise<ChartData> {
  const now = today();
  let n = cfg.months ?? 6;
  let cur = anchor ?? thisMonth();
  if (range) {
    cur = monthOf(range.to && range.to < now ? range.to : now);
    const floor = addMonths(cur, -23);
    const start = !range.from || monthOf(range.from) < floor ? floor : monthOf(range.from);
    n = 1; for (let m = start; m < cur; m = addMonths(m, 1)) n++;
  }
  const past = cur < thisMonth();
  const first = addMonths(cur, -(n - 1));
  const months = Array.from({ length: n }, (_, i) => addMonths(first, i));
  const period = past ? (n === 1 ? monthShort(cur) : `${n} months to ${monthShort(cur)}`) : n === 1 ? 'this month' : `last ${n} months`;
  const base = { labels: months.map(monthShort), period, from: first, to: monthEnd(cur) };
  const source = cfg.source ?? 'spending';

  const allAccounts = (await loadAccounts()).filter((a) => !a.is_hidden);
  const chosen = pickAccounts(cfg, allAccounts);
  const accIds = chosen.map((a) => a.id);
  const by: SplitBy | undefined = cfg.by && SPLITS[source].includes(cfg.by) ? cfg.by : SPLITS[source][0];
  const mean = (values: number[]) => (cfg.avg && values.length > 1 ? avg(values) : undefined);

  if (source === 'spending') {
    // Per-account numbers come from the transactions themselves; otherwise the database's monthly totals.
    const perAccount = accIds.length > 0 || by === 'account';
    const [cats, rows] = await Promise.all([loadCategories(), perAccount ? loadLines(first, monthEnd(cur), accIds) : loadCategoryMonths(first, cur).then((r) => r.map((x) => ({ ...x, account_id: '' })))]);
    const picked = cfgCategories(cfg, cats);
    const scope = picked.length ? picked : cats.filter((c) => c.kind === 'expense');
    const byId = new Map(scope.map((c) => [c.id, c]));
    // With no categories chosen it is all spending, so spending with no category counts too.
    const mine = rows.filter((r) => r.kind !== 'transfer' && (r.category_id ? byId.has(r.category_id) : !picked.length && r.kind === 'expense'));
    const values = months.map((m) => -mine.filter((r) => r.month === m).reduce((s, r) => s + r.total, 0));
    const keyFor = (r: { category_id: string | null; account_id: string }) => (by === 'account' ? r.account_id : by === 'group' ? `g:${byId.get(r.category_id ?? '')?.group ?? 'Other'}` : r.category_id ?? 'none');
    const by_ = new Map<string, number>();
    for (const r of mine) by_.set(keyFor(r), (by_.get(keyFor(r)) ?? 0) - r.total);
    const prior = values.slice(0, -1);
    const ids = scope.map((c) => c.id);
    const acc = accIds.length ? { accountIds: accIds } : {};
    const part = (id: string, value: number): ChartData['breakdown'][number] => {
      if (by === 'account') { const a = allAccounts.find((x) => x.id === id); return { label: `${a ? accountIcon(a) : '🏦'} ${a?.name ?? 'Account'}`, value, query: { accountIds: [id], ...(picked.length ? { categoryIds: ids } : { kind: 'expense' as const }), noTransfers: true } }; }
      if (by === 'group') { const g = id.slice(2); return { label: g, value, query: { categoryIds: scope.filter((c) => c.group === g).map((c) => c.id), ...acc, noTransfers: true } }; }
      const c = byId.get(id);
      return c ? { label: `${categoryIcon(c.name, c.icon)} ${c.name}`, value, query: { categoryIds: [id], ...acc, noTransfers: true } } : { label: '❔ Uncategorised', value, query: { category: 'none', ...acc, noTransfers: true } };
    };
    return {
      ...base,
      series: [{ name: 'Spending', values }],
      breakdown: [...by_.entries()].filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).map(([id, value]) => part(id, value)),
      refLine: mean(values),
      tiles: [
        { label: past ? monthShort(cur) : 'This month', value: money0(values[n - 1]) },
        { label: `Average · ${prior.length || 1} mo`, value: money0(avg(prior.length ? prior : values)), sub: 'per month' },
        { label: `Total · ${n} mo`, value: money0(values.reduce((s, v) => s + v, 0)) },
      ],
      drill: (i) => ({ from: months[i], to: monthEnd(months[i]), ...(picked.length ? { categoryIds: ids } : { kind: 'expense' as const }), ...acc, noTransfers: true }),
    };
  }

  if (source === 'cashflow') {
    let income: number[], spending: number[];
    if (accIds.length) {
      const lines = await loadLines(first, monthEnd(cur), accIds);
      const sum = (m: string, kind: string) => Math.abs(lines.filter((r) => r.month === m && r.kind === kind).reduce((x, r) => x + r.total, 0));
      income = months.map((m) => sum(m, 'income')); spending = months.map((m) => sum(m, 'expense'));
    } else {
      const sums = await loadMonthSummaries(first, monthEnd(cur));
      const at = (m: string) => sums.find((x) => x.month === m);
      income = months.map((m) => Math.abs(at(m)?.income ?? 0)); spending = months.map((m) => Math.abs(at(m)?.spending ?? 0));
    }
    const net = months.map((_, i) => income[i] - spending[i]);
    return {
      ...base,
      series: [{ name: 'Money in', values: income }, { name: 'Money out', values: spending }],
      breakdown: [],
      tiles: [
        { label: past ? `Net · ${monthShort(cur)}` : 'Net this month', value: `${net[n - 1] < 0 ? '−' : '+'}${money0(Math.abs(net[n - 1]))}`, sub: `${money0(income[n - 1])} in · ${money0(spending[n - 1])} out` },
        { label: `Average net · ${n} mo`, value: `${avg(net) < 0 ? '−' : '+'}${money0(Math.abs(avg(net)))}`, sub: 'per month' },
      ],
      drill: (i) => ({ from: months[i], to: monthEnd(months[i]), ...(accIds.length ? { accountIds: accIds } : {}), noTransfers: true }),
    };
  }

  // Balances over time: weekly points going back from today.
  const pool = source === 'carddebt' ? allAccounts.filter((a) => a.type === 'credit') : allAccounts;
  const accounts = source === 'balance' ? chosen : accIds.length ? pool.filter((a) => accIds.includes(a.id)) : pool;
  if (!accounts.length) {
    return { ...base, series: [], breakdown: [], tiles: [], empty: source === 'balance' ? 'Pick an account in this chart\'s settings.' : source === 'carddebt' ? 'No credit cards yet.' : 'No accounts yet.' };
  }
  const isDebt = (a: Account) => a.type === 'credit' || a.type === 'loan';
  // Debts are drawn as the amount owed, so paying them down makes the line go down.
  const owedView = source === 'carddebt' || (source === 'balance' && accounts.every(isDebt));
  const loan = source === 'balance' && cfg.payoff !== false && accounts.length === 1 && accounts[0].type === 'loan' ? accounts[0] : null;
  const points = Math.max(2, Math.round(n * 4.35) + 1);
  // Balances are worked back from today's, so a past month needs the weeks since then too.
  const end = past ? monthEnd(cur) : now;
  const total = points + Math.ceil(Math.max(0, daysBetween(end, now)) / 7) + 1;
  const txns = await loadTxnsFor(accounts.map((a) => a.id), loan ? '1900-01-01' : addDays(now, -total * 7 - 7));
  const per = accounts.map((a) => balanceHistory(signedBalance(a), txns.filter((x) => x.account_id === a.id && x.date >= addDays(now, -total * 7 - 7)), now, total, 7).filter((p) => p.date <= end).slice(-points));
  const dates = per[0]?.map((p) => p.date) ?? [];
  const sign = owedView ? -1 : 1;
  const values = dates.map((_, i) => Math.round(per.reduce((x, h) => x + (source === 'carddebt' ? Math.min(0, h[i].balance) : h[i].balance), 0) * sign));
  const last = values[values.length - 1] ?? 0, firstV = values[0] ?? 0;
  const ids = accounts.map((a) => a.id);
  const TYPES: [string, (a: Account) => boolean][] = [['🏦 Cash', (a) => a.type === 'depository'], ['📈 Investments', (a) => a.type === 'investment'], ['💳 Credit cards', (a) => a.type === 'credit'], ['🧾 Loans', (a) => a.type === 'loan']];
  const worth = (a: Account) => (owedView ? Math.max(0, -signedBalance(a)) : signedBalance(a));
  const breakdown: ChartData['breakdown'] = by === 'type'
    ? TYPES.map(([label, f]) => ({ label, value: accounts.filter(f).reduce((x, a) => x + signedBalance(a), 0), query: { accountIds: accounts.filter(f).map((a) => a.id) } })).filter((x) => Math.abs(x.value) > 0.5)
    : accounts.map((a) => ({ label: `${accountIcon(a)} ${a.name}`, value: worth(a), query: { accountIds: [a.id] } })).filter((x) => Math.abs(x.value) > 0.5).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const tiles: ChartData['tiles'] = [
    { label: past ? shortDate(dates[dates.length - 1] ?? end) : owedView ? 'Owing' : source === 'balance' ? 'Balance' : 'Now', value: `${last < 0 ? '−' : ''}${money0(Math.abs(last))}`, sub: accounts.length > 1 && source !== 'networth' ? `${accounts.length} accounts` : undefined },
    { label: `Change · ${n} mo`, value: `${last - firstV < 0 ? '−' : '+'}${money0(Math.abs(last - firstV))}`, sub: `from ${money0(firstV)}` },
  ];
  if (source === 'carddebt') {
    const lim = accounts.filter((a) => a.credit_limit);
    const limit = lim.reduce((x, a) => x + Number(a.credit_limit), 0);
    if (limit) tiles.push({ label: 'Utilisation', value: `${Math.round((lim.reduce((x, a) => x + Math.max(0, -signedBalance(a)), 0) / limit) * 100)}%`, sub: `of ${money0(limit)}` });
    const due = accounts.filter((a) => a.due_day && signedBalance(a) < 0).map((a) => {
      const d = new Date(now + 'T00:00:00Z');
      let c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), a.due_day!));
      if (c.toISOString().slice(0, 10) < now) c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, a.due_day!));
      return { a, due: c.toISOString().slice(0, 10) };
    }).sort((x, y) => x.due.localeCompare(y.due))[0];
    if (due) tiles.push({ label: 'Next due', value: shortDate(due.due), sub: due.a.name });
  }
  if (loan) {
    const ls = loanSummary(Math.abs(signedBalance(loan)), txns.map((x) => ({ date: x.date, amount: x.amount, name: x.name ?? '' })), now);
    tiles.splice(1, 1);
    if (ls.status === 'ok') tiles.push({ label: 'Paid off', value: monthName(ls.payoffDate!.slice(0, 7) + '-01'), sub: `${ls.monthsLeft} months` });
    tiles.push({ label: 'Interest to date', value: money0(ls.interestToDate), sub: `paid ${money0(ls.paymentsToDate)}` });
  }
  return {
    labels: dates.map((d) => shortDate(d)), period, from: dates[0] ?? now, to: end,
    series: [{ name: owedView && source === 'balance' ? 'Owed' : source === 'balance' ? 'Balance' : SOURCES[source].title, values }],
    breakdown, tiles, refLine: mean(values),
    title: source === 'balance' && accounts.length === 1 ? accounts[0].name : undefined,
    drill: (i) => (i === 0 ? null : { from: addDays(dates[i], -6), to: dates[i], accountIds: ids }),
  };
}

const accountIcon = (a: Account) => a.icon ?? (a.type === 'credit' ? '💳' : a.type === 'loan' ? '🧾' : a.type === 'investment' ? '📈' : '🏦');

/** The accounts a chart is limited to: the picked ones, or the older single-account settings. */
export function pickAccounts(cfg: ChartCfg, all: Account[]): Account[] {
  if (cfg.accountIds?.length) return all.filter((a) => cfg.accountIds!.includes(a.id));
  if (cfg.accountId) return all.filter((a) => a.id === cfg.accountId);
  if (cfg.accountMatch) { const re = new RegExp(cfg.accountMatch, 'i'); const a = all.find((x) => re.test(x.name)); return a ? [a] : []; }
  return [];
}

/** Monthly totals per category and account, straight from the transactions (for account filters). */
async function loadLines(from: string, to: string, accountIds: string[]): Promise<{ month: string; category_id: string | null; account_id: string; kind: any; total: number; txns: number }[]> {
  const m = new Map<string, { month: string; category_id: string | null; account_id: string; kind: any; total: number; txns: number }>();
  for (let p = 0; p < 20; p++) {
    let q = supabase.from('transaction_lines').select('month, category_id, account_id, kind, amount').gte('date', from).lte('date', to).order('date').range(p * 1000, p * 1000 + 999);
    if (accountIds.length) q = q.in('account_id', accountIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) {
      const k = `${r.month}|${r.category_id}|${r.account_id}|${r.kind}`;
      const x = m.get(k) ?? { month: r.month, category_id: r.category_id, account_id: r.account_id, kind: r.kind, total: 0, txns: 0 };
      x.total += Number(r.amount); x.txns++; m.set(k, x);
    }
    if (!data || data.length < 1000) break;
  }
  return [...m.values()];
}
