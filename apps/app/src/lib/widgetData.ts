// What a chart widget can show. Each source turns the account's data into the same shape, so
// any view (bars, line, pie, list, table, tiles) can draw it and a tap can open what's behind it.
import { addDays, addMonths, weekStart, balanceHistory, daysBetween, loanSummary, monthName, monthOf, categoryIcon, formatMoney, monthEnd, shortDate } from '@budget-app/core';
import { loadScores, scoreLines } from './creditScores';
import { supabase } from './supabase';
import type { TxnQuery } from '@/components/TxnSheet';
import { loadTxnsFor } from './accountTxns';
import { loadAccounts, today } from './plan';
import { loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, type Category } from './reports';
import { signedBalance, type Account } from './types';

export type Source = 'spending' | 'income' | 'cashflow' | 'savings' | 'networth' | 'carddebt' | 'utilization' | 'balance' | 'creditscore';
/** How a chart's total is split into parts (for the pie, the ranked list and the table). */
export type SplitBy = 'category' | 'group' | 'account' | 'type';
export type ChartView = 'bars' | 'line' | 'pie' | 'list' | 'table' | 'tiles';
export const VIEW_LABEL: Record<ChartView, string> = { bars: 'Bars', line: 'Line', pie: 'Pie', list: 'Ranked list', table: 'Table', tiles: 'Numbers' };
export const SOURCES: Record<Source, { title: string; about: string; views: ChartView[] }> = {
  spending: { title: 'Spending', about: 'All spending or the categories you choose, by month and by category', views: ['bars', 'line', 'pie', 'list', 'table', 'tiles'] },
  income: { title: 'Income', about: 'Money coming in, by month and by category', views: ['bars', 'line', 'pie', 'list', 'table', 'tiles'] },
  cashflow: { title: 'Money in and out', about: 'Income against spending each month', views: ['bars', 'line', 'table', 'tiles'] },
  savings: { title: 'Savings rate', about: 'The share of each month\'s income that wasn\'t spent', views: ['bars', 'line', 'table', 'tiles'] },
  networth: { title: 'Net worth', about: 'Everything you own minus everything you owe, over time, and by account or type', views: ['line', 'bars', 'list', 'table', 'tiles'] },
  carddebt: { title: 'Card debt', about: 'What you owe on credit cards over time, and by card', views: ['line', 'bars', 'pie', 'list', 'table', 'tiles'] },
  utilization: { title: 'Card utilisation', about: 'How much of your credit limits is in use, over time and by card', views: ['line', 'bars', 'list', 'table', 'tiles'] },
  balance: { title: 'Account balance', about: 'One account, or several added together, over time', views: ['line', 'bars', 'pie', 'list', 'table', 'tiles'] },
  creditscore: { title: 'Credit score', about: 'The scores you log on the Credit cards page, a line per bureau', views: ['line', 'table', 'tiles'] },
};

/** Which ways each source can be split. The first is the default. */
export const SPLITS: Partial<Record<Source, SplitBy[]>> = { spending: ['category', 'group', 'account'], income: ['category', 'account'], cashflow: [], networth: ['account', 'type'], carddebt: ['account'], utilization: ['account'], balance: ['account'] };
/** Sources that aren't about accounts, so the account picker is hidden for them. */
export const NO_ACCOUNTS: Source[] = ['creditscore'];
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
  /** Bars and lines: one coloured part per category, group or account (whatever `by` says) instead of a single total. */
  stack?: boolean;
  /** Draw the period before beside this one. */
  compare?: boolean;
  /** Spending: where this month is heading, against the average of the 3 months before. */
  pace?: boolean;
  /** One loan picked under Account balance: add its payoff date and interest to the numbers. */
  payoff?: boolean;
}
export interface ChartData {
  labels: string[];
  series: { name: string; values: number[] }[];
  /** Parts of the whole over the period (categories, cards, apps), biggest first. Empty when the source has none. */
  breakdown: { label: string; value: number; query?: Omit<TxnQuery, 'title' | 'from' | 'to'> }[];
  tiles: { label: string; value: string; sub?: string }[];
  /** The numbers above the chart while point i is highlighted (a change then runs from that point). */
  tilesAt?: (i: number) => { label: string; value: string; sub?: string }[];
  /** The series are parts of a whole and should be stacked. */
  stacked?: boolean;
  /** Values are percentages, not money. */
  percent?: boolean;
  /** Values are plain numbers (credit scores), not money. */
  plain?: boolean;
  /** Where the last bar is heading (drawn as a dashed outline), and whether that beats the average. */
  outline?: { i: number; value: number; good: boolean };
  /** A sentence under the title ("Heading for …"). */
  note?: string;
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
// Plain lookups: a date formatter per call was slow on a phone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const dayShort = (d: string) => DAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
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
  // "This week" (months: 0): the chart's columns are the days Monday to Sunday instead of months.
  const week = cfg.months === 0 && !range;
  if (week) n = 7;
  const monday = weekStart(now);
  const past = !week && cur < thisMonth();
  const first = week ? monday : addMonths(cur, -(n - 1));
  const months = week ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : Array.from({ length: n }, (_, i) => addMonths(first, i));
  /** The last day a column covers (a month's end, or the day itself). */
  const endOf = (k: string) => (week ? k : monthEnd(k));
  const lastKey = months[months.length - 1];
  const period = week ? 'this week' : past ? (n === 1 ? monthShort(cur) : `${n} months to ${monthShort(cur)}`) : n === 1 ? 'this month' : `last ${n} months`;
  const base = { labels: months.map((k) => (week ? dayShort(k) : monthShort(k))), period, from: first, to: endOf(lastKey) };
  /** Columns up to today (a week's days still to come have nothing yet). */
  const sofar = week ? months.filter((k) => k <= now).length : n;
  const source = cfg.source ?? 'spending';

  if (source === 'creditscore') {
    // By month whatever the period (a week of scores says nothing): the last 6 months for "this week".
    const cols: string[] = week ? Array.from({ length: 6 }, (_, i) => addMonths(thisMonth(), i - 5)) : [...months];
    const { scores, error } = await loadScores();
    if (error) throw new Error(error);
    let lines = scoreLines(scores, cols);
    // Start at the first month with a score, so the months before the log began aren't blank space.
    const lead = Math.min(cols.length - 2, ...lines.map((l) => l.values.findIndex(Number.isFinite)).filter((i) => i >= 0));
    if (lead > 0) { cols.splice(0, lead); lines = lines.map((l) => ({ ...l, values: l.values.slice(lead) })); }
    const latest = (b: string) => [...scores].reverse().find((s) => s.bureau === b);
    return {
      labels: cols.map(monthShort), period: week ? 'last 6 months' : period, from: cols[0], to: monthEnd(cols[cols.length - 1]), plain: true,
      series: lines, breakdown: [],
      tiles: lines.map((l) => { const s = latest(l.name)!; const prev = [...scores].reverse().find((x) => x.bureau === l.name && x.id !== s.id);
        return { label: l.name, value: String(s.score), sub: prev ? `${s.score >= prev.score ? '▲' : '▼'} ${Math.abs(s.score - prev.score)} · ${shortDate(s.date)}` : shortDate(s.date) }; }),
      // A highlighted month: each bureau's change from that month to its latest score.
      tilesAt: (i) => lines.map((l) => { const s = latest(l.name)!; const was = l.values[i];
        return { label: l.name, value: String(s.score), sub: Number.isFinite(was) ? `${s.score >= was ? '▲' : '▼'} ${Math.abs(s.score - was)} since ${monthShort(cols[i])}` : `no score in ${monthShort(cols[i])}` }; }),
      empty: lines.length ? undefined : 'No scores yet. Log them on the Credit cards page.',
    };
  }

  const allAccounts = (await loadAccounts()).filter((a) => !a.is_hidden);
  const chosen = pickAccounts(cfg, allAccounts);
  const accIds = chosen.map((a) => a.id);
  const by: SplitBy | undefined = cfg.by && (SPLITS[source] ?? []).includes(cfg.by) ? cfg.by : (SPLITS[source] ?? [])[0];
  const mean = (values: number[]) => (cfg.avg && values.length > 1 ? avg(values) : undefined);

  if (source === 'spending' || source === 'income') {
    const want = source === 'income' ? 'income' : 'expense';
    const sign = source === 'income' ? 1 : -1;
    const stack = !!cfg.stack;
    const compare = !!cfg.compare && !stack;
    // The period before is the same number of months (or the week before), straight before this one.
    const dataFrom = compare ? (week ? addDays(first, -7) : addMonths(first, -n)) : first;
    // Per-account or per-day numbers come from the transactions themselves; otherwise the database's monthly totals.
    const perAccount = week || accIds.length > 0 || by === 'account';
    const [cats, rows] = await Promise.all([loadCategories(), perAccount ? loadLines(dataFrom, endOf(lastKey), accIds, week) : loadCategoryMonths(dataFrom, cur).then((r) => r.map((x) => ({ ...x, account_id: '' })))]);
    const picked = cfgCategories(cfg, cats).filter((c) => source === 'spending' || c.kind === 'income');
    const scope = picked.length ? picked : cats.filter((c) => c.kind === want);
    const byId = new Map(scope.map((c) => [c.id, c]));
    // With no categories chosen it is everything of that kind, so rows with no category count too.
    const all = rows.filter((r) => r.kind !== 'transfer' && (r.category_id ? byId.has(r.category_id) : !picked.length && r.kind === want));
    const mine = all.filter((r) => r.month >= first);
    const total = (list: typeof all, m: string) => sign * list.filter((r) => r.month === m).reduce((x, r) => x + r.total, 0);
    const values = months.map((m) => total(mine, m));
    const keyFor = (r: { category_id: string | null; account_id: string }) => (by === 'account' ? r.account_id : by === 'group' ? `g:${byId.get(r.category_id ?? '')?.group ?? 'Other'}` : r.category_id ?? 'none');
    const by_ = new Map<string, number>();
    for (const r of mine) by_.set(keyFor(r), (by_.get(keyFor(r)) ?? 0) + sign * r.total);
    const prior = values.slice(0, -1);
    const ids = scope.map((c) => c.id);
    const acc = accIds.length ? { accountIds: accIds } : {};
    const kindQ = picked.length ? { categoryIds: ids } : { kind: want as 'expense' | 'income' };
    const part = (id: string, value: number): ChartData['breakdown'][number] => {
      if (by === 'account') { const a = allAccounts.find((x) => x.id === id); return { label: `${a ? accountIcon(a) : '🏦'} ${a?.name ?? 'Account'}`, value, query: { accountIds: [id], ...kindQ, noTransfers: true } }; }
      if (by === 'group') { const g = id.slice(2); return { label: g, value, query: { categoryIds: scope.filter((c) => c.group === g).map((c) => c.id), ...acc, noTransfers: true } }; }
      const c = byId.get(id);
      return c ? { label: `${categoryIcon(c.name, c.icon)} ${c.name}`, value, query: { categoryIds: [id], ...acc, noTransfers: true } } : { label: '❔ Uncategorised', value, query: { category: 'none', ...acc, noTransfers: true } };
    };
    const parts = [...by_.entries()].filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
    const title = SOURCES[source].title;
    let series: ChartData['series'] = [{ name: title, values }];
    if (stack && parts.length > 1) {
      // The biggest parts get a colour each; the rest are added together.
      const top = parts.slice(0, 7).map(([id]) => id);
      const per = (id: string) => months.map((m) => sign * mine.filter((r) => r.month === m && keyFor(r) === id).reduce((x, r) => x + r.total, 0));
      series = top.map((id) => ({ name: part(id, 0).label.replace(/^\S+ /, by === 'group' ? '$&' : ''), values: per(id) }));
      if (parts.length > top.length) series.push({ name: 'Everything else', values: months.map((m, i) => values[i] - series.reduce((x, sr) => x + sr.values[i], 0)) });
    } else if (compare) {
      const before = Array.from({ length: n }, (_, i) => (week ? addDays(dataFrom, i) : addMonths(dataFrom, i)));
      series = [{ name: 'This period', values }, { name: 'Period before', values: before.map((m) => total(all, m)) }];
    }
    const sumOf = (v: number[]) => v.reduce((x, y) => x + y, 0);
    const tiles: ChartData['tiles'] = week ? [
      { label: 'This week', value: money0(sumOf(values)) },
      { label: 'Per day', value: money0(sumOf(values) / Math.max(1, sofar)), sub: `${sofar} day${sofar === 1 ? '' : 's'} so far` },
      { label: 'Today', value: money0(values[Math.max(0, sofar - 1)]) },
    ] : [
      { label: past ? monthShort(cur) : 'This month', value: money0(values[n - 1]) },
      { label: `Average · ${prior.length || 1} mo`, value: money0(avg(prior.length ? prior : values)), sub: 'per month' },
      { label: `Total · ${n} mo`, value: money0(sumOf(values)) },
    ];
    // A highlighted column: its own figure, against the average, beside the period's total.
    const tilesAt = (i: number): ChartData['tiles'] => {
      const a = avg(values.filter((_, k) => k !== i)), d = values[i] - a;
      return [
        { label: week ? dayShort(months[i]) : monthShort(months[i]), value: money0(values[i]), sub: n > 1 ? `${d < 0 ? '−' : '+'}${money0(Math.abs(d))} vs the average` : undefined },
        ...tiles.slice(1),
      ];
    };
    if (compare) { const d = sumOf(values) - sumOf(series[1].values); tiles[1] = { label: 'Against the period before', value: `${d < 0 ? '−' : '+'}${money0(Math.abs(d))}`, sub: `was ${money0(sumOf(series[1].values))}` }; }
    // Where this month is heading: what's spent so far plus what the rest of the month usually costs.
    let outline: ChartData['outline'], note: string | undefined, refLine = mean(values);
    if (cfg.pace && source === 'spending' && !past && !week && n > 1) {
      const last3 = values.slice(Math.max(0, n - 4), n - 1);
      const avg3 = avg(last3);
      const rest = await restOfMonth(picked.length ? ids : null, accIds, cur, Math.min(3, n - 1), Number(now.slice(8, 10)));
      const projected = values[n - 1] + rest;
      const diff = projected - avg3;
      outline = { i: n - 1, value: projected, good: projected <= avg3 };
      note = `Heading for ${money0(projected)} this month vs a ${money0(avg3)} average${Math.abs(diff) >= 0.5 ? ` (${diff < 0 ? '−' : '+'}${money0(Math.abs(diff))})` : ''}`;
      refLine = avg3 > 0 ? avg3 : undefined;
    }
    return {
      ...base, series, stacked: stack && series.length > 1,
      breakdown: parts.map(([id, value]) => part(id, value)),
      refLine, outline, note, tiles, tilesAt,
      drill: (i) => ({ from: months[i], to: endOf(months[i]), ...kindQ, ...acc, noTransfers: true }),
    };
  }

  if (source === 'cashflow' || source === 'savings') {
    let income: number[], spending: number[];
    if (accIds.length || week) {
      const lines = await loadLines(first, endOf(lastKey), accIds, week);
      const sum = (m: string, kind: string) => Math.abs(lines.filter((r) => r.month === m && r.kind === kind).reduce((x, r) => x + r.total, 0));
      income = months.map((m) => sum(m, 'income')); spending = months.map((m) => sum(m, 'expense'));
    } else {
      const sums = await loadMonthSummaries(first, monthEnd(cur));
      const at = (m: string) => sums.find((x) => x.month === m);
      income = months.map((m) => Math.abs(at(m)?.income ?? 0)); spending = months.map((m) => Math.abs(at(m)?.spending ?? 0));
    }
    const net = months.map((_, i) => income[i] - spending[i]);
    if (source === 'savings') {
      const rate = months.map((_, i) => (income[i] > 0 ? Math.round((net[i] / income[i]) * 100) : 0));
      const tin = income.reduce((x, y) => x + y, 0), tnet = net.reduce((x, y) => x + y, 0);
      return {
        ...base, percent: true,
        series: [{ name: 'Saved', values: rate }],
        breakdown: [],
        refLine: mean(rate),
        tiles: [
          { label: week ? 'Today' : past ? monthShort(cur) : 'This month', value: `${rate[sofar - 1] ?? 0}%`, sub: `${money0(net[sofar - 1] ?? 0)} of ${money0(income[sofar - 1] ?? 0)}` },
          { label: week ? 'This week' : `Over ${n} mo`, value: `${tin > 0 ? Math.round((tnet / tin) * 100) : 0}%`, sub: `${money0(tnet)} kept` },
        ],
        tilesAt: (i) => [
          { label: week ? dayShort(months[i]) : monthShort(months[i]), value: `${rate[i]}%`, sub: `${money0(net[i])} of ${money0(income[i])}` },
          { label: week ? 'This week' : `Over ${n} mo`, value: `${tin > 0 ? Math.round((tnet / tin) * 100) : 0}%`, sub: `${money0(tnet)} kept` },
        ],
        drill: (i) => ({ from: months[i], to: endOf(months[i]), ...(accIds.length ? { accountIds: accIds } : {}), noTransfers: true }),
      };
    }
    return {
      ...base,
      series: [{ name: 'Money in', values: income }, { name: 'Money out', values: spending }],
      breakdown: [],
      tiles: [
        ...(week ? (() => { const tin = income.reduce((x, y) => x + y, 0), tout = spending.reduce((x, y) => x + y, 0); return [
          { label: 'Net this week', value: `${tin - tout < 0 ? '−' : '+'}${money0(Math.abs(tin - tout))}`, sub: `${money0(tin)} in · ${money0(tout)} out` }]; })() : [
        { label: past ? `Net · ${monthShort(cur)}` : 'Net this month', value: `${net[n - 1] < 0 ? '−' : '+'}${money0(Math.abs(net[n - 1]))}`, sub: `${money0(income[n - 1])} in · ${money0(spending[n - 1])} out` },
        { label: `Average net · ${n} mo`, value: `${avg(net) < 0 ? '−' : '+'}${money0(Math.abs(avg(net)))}`, sub: 'per month' }]),
      ],
      tilesAt: (i) => [
        { label: `Net · ${week ? dayShort(months[i]) : monthShort(months[i])}`, value: `${net[i] < 0 ? '−' : '+'}${money0(Math.abs(net[i]))}`, sub: `${money0(income[i])} in · ${money0(spending[i])} out` },
        ...(week ? [] : [{ label: `Average net · ${n} mo`, value: `${avg(net) < 0 ? '−' : '+'}${money0(Math.abs(avg(net)))}`, sub: 'per month' }]),
      ],
      drill: (i) => ({ from: months[i], to: endOf(months[i]), ...(accIds.length ? { accountIds: accIds } : {}), noTransfers: true }),
    };
  }

  // Balances over time: weekly points going back from today.
  const pool = source === 'utilization' ? allAccounts.filter((a) => a.type === 'credit' && Number(a.credit_limit) > 0) : source === 'carddebt' ? allAccounts.filter((a) => a.type === 'credit') : allAccounts;
  const accounts = source === 'balance' ? chosen : accIds.length ? pool.filter((a) => accIds.includes(a.id)) : pool;
  if (!accounts.length) {
    return { ...base, series: [], breakdown: [], tiles: [], empty: source === 'balance' ? 'Pick an account in this chart\'s settings.' : source === 'utilization' ? 'Add a credit limit to a card (Accounts, then the card\'s details) to see utilisation.' : source === 'carddebt' ? 'No credit cards yet.' : 'No accounts yet.' };
  }
  const isDebt = (a: Account) => a.type === 'credit' || a.type === 'loan';
  // Debts are drawn as the amount owed, so paying them down makes the line go down.
  const owedView = source === 'carddebt' || source === 'utilization' || (source === 'balance' && accounts.every(isDebt));
  const loan = source === 'balance' && cfg.payoff !== false && accounts.length === 1 && accounts[0].type === 'loan' ? accounts[0] : null;
  // Weekly points, or for "This week" one a day from the Monday (the day before it too, as the starting point).
  const step = week ? 1 : 7;
  const points = week ? daysBetween(addDays(monday, -1), now) + 1 : Math.max(2, Math.round(n * 4.35) + 1);
  const span = cfg.compare ? points * 2 : points;
  // Balances are worked back from today's, so a past month needs the weeks since then too.
  const end = past ? monthEnd(cur) : now;
  const total = span + Math.ceil(Math.max(0, daysBetween(end, now)) / step) + 1;
  const txns = await loadTxnsFor(accounts.map((a) => a.id), loan ? '1900-01-01' : addDays(now, -total * step - 7));
  const per = accounts.map((a) => balanceHistory(signedBalance(a), txns.filter((x) => x.account_id === a.id && x.date >= addDays(now, -total * step - 7)), now, total, step).filter((p) => p.date <= end).slice(-span));
  const allDates = per[0]?.map((p) => p.date) ?? [];
  const sign = owedView ? -1 : 1;
  const limit = accounts.reduce((x, a) => x + Number(a.credit_limit ?? 0), 0);
  const allValues = allDates.map((_, i) => (source === 'utilization'
    ? Math.round((per.reduce((x, h) => x + Math.max(0, -h[i].balance), 0) / limit) * 100)
    : Math.round(per.reduce((x, h) => x + (source === 'carddebt' ? Math.min(0, h[i].balance) : h[i].balance), 0) * sign)));
  // With "compare", the first half of the points is the period before.
  const cut = cfg.compare && allValues.length >= points * 2 ? allValues.length - points : 0;
  const dates = allDates.slice(cut), values = allValues.slice(cut);
  const before = cut ? allValues.slice(cut - points, cut) : null;
  const pct = source === 'utilization';
  const show = (v: number) => (pct ? `${Math.round(v)}%` : `${v < 0 ? '−' : ''}${money0(Math.abs(v))}`);
  const last = values[values.length - 1] ?? 0, firstV = values[0] ?? 0;
  const ids = accounts.map((a) => a.id);
  const TYPES: [string, (a: Account) => boolean][] = [['🏦 Cash', (a) => a.type === 'depository'], ['📈 Investments', (a) => a.type === 'investment'], ['💳 Credit cards', (a) => a.type === 'credit'], ['🧾 Loans', (a) => a.type === 'loan']];
  const worth = (a: Account) => (owedView ? Math.max(0, -signedBalance(a)) : signedBalance(a));
  const breakdown: ChartData['breakdown'] = by === 'type'
    ? TYPES.map(([label, f]) => ({ label, value: accounts.filter(f).reduce((x, a) => x + signedBalance(a), 0), query: { accountIds: accounts.filter(f).map((a) => a.id) } })).filter((x) => Math.abs(x.value) > 0.5)
    : accounts.map((a) => ({ label: `${accountIcon(a)} ${a.name}`, value: pct ? Math.round((Math.max(0, -signedBalance(a)) / Number(a.credit_limit)) * 100) : worth(a), query: { accountIds: [a.id] } })).filter((x) => Math.abs(x.value) > 0.5).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const tiles: ChartData['tiles'] = [
    { label: past ? shortDate(dates[dates.length - 1] ?? end) : pct ? 'In use' : owedView ? 'Owing' : source === 'balance' ? 'Balance' : 'Now', value: show(last), sub: pct ? `of ${money0(limit)}` : accounts.length > 1 && source !== 'networth' ? `${accounts.length} accounts` : undefined },
    { label: week ? 'Change · this week' : `Change · ${n} mo`, value: pct ? `${last - firstV < 0 ? '−' : '+'}${Math.abs(last - firstV)} pts` : `${last - firstV < 0 ? '−' : '+'}${money0(Math.abs(last - firstV))}`, sub: `from ${show(firstV)}` },
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
  // A highlighted point: the change runs from it to now (to the end of the chart for a past month).
  const tilesAt = (i: number): ChartData['tiles'] => {
    if (i >= values.length - 1) return tiles;
    const from = values[i], d = last - from;
    const change = { label: `Change since ${week ? dayShort(dates[i]) : shortDate(dates[i])}`, value: pct ? `${d < 0 ? '−' : '+'}${Math.abs(d)} pts` : `${d < 0 ? '−' : '+'}${money0(Math.abs(d))}`, sub: `from ${show(from)}` };
    return loan ? [tiles[0], change, ...tiles.slice(1)] : [tiles[0], change, ...tiles.slice(2)];
  };
  if (loan) {
    const ls = loanSummary(Math.abs(signedBalance(loan)), txns.map((x) => ({ date: x.date, amount: x.amount, name: x.name ?? '' })), now);
    tiles.splice(1, 1);
    if (ls.status === 'ok') tiles.push({ label: 'Paid off', value: monthName(ls.payoffDate!.slice(0, 7) + '-01'), sub: `${ls.monthsLeft} months` });
    tiles.push({ label: 'Interest to date', value: money0(ls.interestToDate), sub: `paid ${money0(ls.paymentsToDate)}` });
  }
  return {
    labels: dates.map((d) => (week ? dayShort(d) : shortDate(d))), period, from: dates[0] ?? now, to: end,
    series: before ? [{ name: 'This period', values }, { name: 'Period before', values: before }] : [{ name: owedView && source === 'balance' ? 'Owed' : source === 'balance' ? 'Balance' : SOURCES[source].title, values }],
    breakdown, tiles, tilesAt, refLine: mean(values), percent: pct,
    title: source === 'balance' && accounts.length === 1 ? accounts[0].name : undefined,
    drill: (i) => (i === 0 ? null : { from: addDays(dates[i], -(step - 1)), to: dates[i], accountIds: ids }),
  };
}

/**
 * What was spent after this day of the month in each of the `back` months before `cur`, averaged:
 * what "the rest of the month" usually costs. Rent paid on the 1st adds nothing by the 2nd.
 */
async function restOfMonth(categoryIds: string[] | null, accountIds: string[], cur: string, back: number, day: number): Promise<number> {
  if (back < 1) return 0;
  let sum = 0;
  for (let p = 0; p < 10; p++) {
    let q = supabase.from('transaction_lines').select('date, amount').eq('kind', 'expense').gte('date', addMonths(cur, -back)).lt('date', cur).order('date').range(p * 1000, p * 1000 + 999);
    if (categoryIds) q = q.in('category_id', categoryIds);
    if (accountIds.length) q = q.in('account_id', accountIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { date: string; amount: number }[]) if (Number(r.date.slice(8, 10)) > day) sum -= Number(r.amount);
    if (!data || data.length < 1000) break;
  }
  return Math.max(0, sum / back);
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
/** Lines added up per month (or, with `byDay`, per day: the `month` field then holds the date). */
async function loadLines(from: string, to: string, accountIds: string[], byDay = false): Promise<{ month: string; category_id: string | null; account_id: string; kind: any; total: number; txns: number }[]> {
  const m = new Map<string, { month: string; category_id: string | null; account_id: string; kind: any; total: number; txns: number }>();
  for (let p = 0; p < 20; p++) {
    let q = supabase.from('transaction_lines').select('month, date, category_id, account_id, kind, amount').gte('date', from).lte('date', to).order('date').range(p * 1000, p * 1000 + 999);
    if (accountIds.length) q = q.in('account_id', accountIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) {
      const key = byDay ? r.date : r.month;
      const k = `${key}|${r.category_id}|${r.account_id}|${r.kind}`;
      const x = m.get(k) ?? { month: key, category_id: r.category_id, account_id: r.account_id, kind: r.kind, total: 0, txns: 0 };
      x.total += Number(r.amount); x.txns++; m.set(k, x);
    }
    if (!data || data.length < 1000) break;
  }
  return [...m.values()];
}
