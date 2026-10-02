// What a chart widget can show. Each source turns the account's data into the same shape, so
// any view (bars, line, pie, list, table, tiles) can draw it and a tap can open what's behind it.
import { addDays, addMonths, balanceHistory, categoryIcon, formatMoney, monthEnd, platformByKey, shortDate, totalsByPlatform } from '@budget-app/core';
import type { TxnQuery } from '@/components/TxnSheet';
import { loadTxnsFor } from './accountTxns';
import { loadShifts } from './gig';
import { loadAccounts, today } from './plan';
import { loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, type Category } from './reports';
import { signedBalance } from './types';

export type Source = 'spending' | 'cashflow' | 'networth' | 'carddebt' | 'gig';
export type ChartView = 'bars' | 'line' | 'pie' | 'list' | 'table' | 'tiles';
export const VIEW_LABEL: Record<ChartView, string> = { bars: 'Bars', line: 'Line', pie: 'Pie', list: 'Ranked list', table: 'Table', tiles: 'Numbers' };
export const SOURCES: Record<Source, { title: string; about: string; views: ChartView[] }> = {
  spending: { title: 'Spending', about: 'All spending or the categories you choose, by month and by category', views: ['bars', 'line', 'pie', 'list', 'table', 'tiles'] },
  cashflow: { title: 'Money in and out', about: 'Income against spending each month', views: ['bars', 'line', 'table', 'tiles'] },
  networth: { title: 'Net worth', about: 'Everything you own minus everything you owe, over time', views: ['line', 'bars', 'table', 'tiles'] },
  carddebt: { title: 'Card debt', about: 'What you owe on credit cards over time, and by card', views: ['line', 'bars', 'pie', 'list', 'table', 'tiles'] },
  gig: { title: 'Gig earnings', about: 'Shift earnings by month, and by app', views: ['bars', 'line', 'pie', 'list', 'table', 'tiles'] },
};

export interface ChartCfg { source?: Source; months?: number; categoryIds?: string[]; group?: string; names?: string[] }
export interface ChartData {
  labels: string[];
  series: { name: string; values: number[] }[];
  /** Parts of the whole over the period (categories, cards, apps), biggest first. Empty when the source has none. */
  breakdown: { label: string; value: number; query?: Omit<TxnQuery, 'title' | 'from' | 'to'> }[];
  tiles: { label: string; value: string; sub?: string }[];
  /** The transactions behind point i, when there are any to show. */
  drill?: (i: number) => Omit<TxnQuery, 'title'> | null;
  period: string; from: string; to: string;
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

export async function loadChart(cfg: ChartCfg): Promise<ChartData> {
  const n = cfg.months ?? 6;
  const cur = thisMonth(), first = addMonths(cur, -(n - 1)), now = today();
  const months = Array.from({ length: n }, (_, i) => addMonths(first, i));
  const period = n === 1 ? 'this month' : `last ${n} months`;
  const base = { labels: months.map(monthShort), period, from: first, to: monthEnd(cur) };
  const source = cfg.source ?? 'spending';

  if (source === 'spending') {
    const [cats, rows] = await Promise.all([loadCategories(), loadCategoryMonths(first, cur)]);
    const picked = cfgCategories(cfg, cats);
    const scope = picked.length ? picked : cats.filter((c) => c.kind === 'expense');
    const byId = new Map(scope.map((c) => [c.id, c]));
    const mine = rows.filter((r) => r.category_id && byId.has(r.category_id) && r.kind !== 'transfer');
    const values = months.map((m) => -mine.filter((r) => r.month === m).reduce((s, r) => s + r.total, 0));
    const by = new Map<string, number>();
    for (const r of mine) by.set(r.category_id!, (by.get(r.category_id!) ?? 0) - r.total);
    const prior = values.slice(0, -1);
    const ids = scope.map((c) => c.id);
    return {
      ...base,
      series: [{ name: 'Spending', values }],
      breakdown: [...by.entries()].filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1])
        .map(([id, value]) => { const c = byId.get(id)!; return { label: `${categoryIcon(c.name, c.icon)} ${c.name}`, value, query: { categoryIds: [id], noTransfers: true } }; }),
      tiles: [
        { label: 'This month', value: money0(values[n - 1]) },
        { label: `Average · ${prior.length || 1} mo`, value: money0(avg(prior.length ? prior : values)), sub: 'per month' },
        { label: `Total · ${n} mo`, value: money0(values.reduce((s, v) => s + v, 0)) },
      ],
      drill: (i) => ({ from: months[i], to: monthEnd(months[i]), ...(picked.length ? { categoryIds: ids } : { kind: 'expense' as const }), noTransfers: true }),
    };
  }

  if (source === 'cashflow') {
    const sums = await loadMonthSummaries(first, monthEnd(cur));
    const at = (m: string) => sums.find((s) => s.month === m);
    const income = months.map((m) => Math.abs(at(m)?.income ?? 0)), spending = months.map((m) => Math.abs(at(m)?.spending ?? 0));
    const net = months.map((_, i) => income[i] - spending[i]);
    return {
      ...base,
      series: [{ name: 'Money in', values: income }, { name: 'Money out', values: spending }],
      breakdown: [],
      tiles: [
        { label: 'Net this month', value: `${net[n - 1] < 0 ? '−' : '+'}${money0(Math.abs(net[n - 1]))}`, sub: `${money0(income[n - 1])} in · ${money0(spending[n - 1])} out` },
        { label: `Average net · ${n} mo`, value: `${avg(net) < 0 ? '−' : '+'}${money0(Math.abs(avg(net)))}`, sub: 'per month' },
      ],
      drill: (i) => ({ from: months[i], to: monthEnd(months[i]), noTransfers: true }),
    };
  }

  if (source === 'gig') {
    const shifts = await loadShifts(first);
    const values = months.map((m) => totalsByPlatform(shifts.filter((s) => s.date.slice(0, 7) === m.slice(0, 7))).reduce((s, p) => s + p.earnings, 0));
    return {
      ...base,
      series: [{ name: 'Earnings', values }],
      breakdown: totalsByPlatform(shifts).filter((p) => p.earnings > 0).map((p) => { const g = platformByKey(p.platform); return { label: `${g.icon} ${g.name}`, value: p.earnings }; }),
      tiles: [
        { label: 'This month', value: money0(values[n - 1]) },
        { label: `Average · ${n} mo`, value: money0(avg(values)), sub: 'per month' },
        { label: 'Shifts', value: String(shifts.length), sub: period },
      ],
      empty: shifts.length ? undefined : 'No shifts logged in this period.',
    };
  }

  // Balances over time: weekly points going back from today.
  const all = (await loadAccounts()).filter((a) => !a.is_hidden);
  const accounts = source === 'carddebt' ? all.filter((a) => a.type === 'credit') : all;
  const points = Math.max(2, Math.round(n * 4.35) + 1);
  const txns = accounts.length ? await loadTxnsFor(accounts.map((a) => a.id), addDays(now, -points * 7 - 7)) : [];
  const per = accounts.map((a) => balanceHistory(signedBalance(a), txns.filter((x) => x.account_id === a.id), now, points, 7));
  const dates = per[0]?.map((p) => p.date) ?? [];
  const sign = source === 'carddebt' ? -1 : 1;
  const values = dates.map((_, i) => Math.round(per.reduce((s, h) => s + (source === 'carddebt' ? Math.min(0, h[i].balance) : h[i].balance), 0) * sign));
  const last = values[values.length - 1] ?? 0, firstV = values[0] ?? 0;
  const ids = accounts.map((a) => a.id);
  return {
    labels: dates.map((d) => shortDate(d)), period, from: dates[0] ?? now, to: now,
    series: [{ name: SOURCES[source].title, values }],
    breakdown: source === 'carddebt'
      ? accounts.map((a) => ({ label: `${a.icon ?? '💳'} ${a.name}`, value: Math.max(0, -signedBalance(a)), query: { accountIds: [a.id] } })).filter((x) => x.value > 0.5).sort((a, b) => b.value - a.value)
      : [],
    tiles: [
      { label: 'Now', value: `${last < 0 ? '−' : ''}${money0(Math.abs(last))}` },
      { label: `Change · ${n} mo`, value: `${last - firstV < 0 ? '−' : '+'}${money0(Math.abs(last - firstV))}`, sub: `from ${money0(firstV)}` },
    ],
    drill: (i) => (i === 0 ? null : { from: addDays(dates[i], -6), to: dates[i], accountIds: ids }),
    empty: accounts.length ? undefined : source === 'carddebt' ? 'No credit cards yet.' : 'No accounts yet.',
  };
}
