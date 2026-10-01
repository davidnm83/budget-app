// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Monthly budgets. A budget is set per category or per category group, per month.
 * "Actual" is what the month's transactions add up to, from the category's point of view:
 * spending for expense categories (refunds reduce it), money received for income categories.
 * Transfers are never budgeted.
 */
import { addDays, type IsoDate } from './dates.ts';
import { round2 } from './money.ts';
import type { CategoryKind } from './fina.ts';

export type Month = IsoDate; // always the 1st, e.g. '2026-09-01'

export function monthOf(iso: IsoDate): Month {
  return iso.slice(0, 7) + '-01';
}

export function addMonths(month: Month, n: number): Month {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}

export function monthEnd(month: Month): IsoDate {
  return addDays(addMonths(month, 1), -1);
}

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthName(month: Month, withYear = true): string {
  const name = NAMES[Number(month.slice(5, 7)) - 1];
  return withYear ? `${name} ${month.slice(0, 4)}` : name;
}

export interface BudgetCategory { id: string; name: string; group: string; kind: CategoryKind }
export interface BudgetRow { categoryId: string | null; groupName: string | null; amount: number; rollover: boolean }
/** Signed total per category for one month (spending negative), from report_category_months. */
export type MonthTotals = Map<string | null, number>;

/** Spending as a positive number for expense categories; money in as positive for income ones. */
export function actualFor(kind: CategoryKind, signedTotal: number): number {
  return round2(kind === 'expense' ? -signedTotal : signedTotal);
}

export const budgetKey = (b: { categoryId: string | null; groupName: string | null }) =>
  b.categoryId ? `c:${b.categoryId}` : `g:${b.groupName}`;

/**
 * What carries into `month` for one budget with rollover on: the running sum of
 * (budgeted − spent) over the earlier consecutive months where that budget existed with
 * rollover on. Positive = money left over, negative = overspent. A month without that budget
 * (or with rollover off) resets it to zero.
 */
export function carryInto(
  month: Month,
  history: { month: Month; budgeted: number; actual: number; rollover: boolean }[],
): number {
  const byMonth = new Map(history.map((h) => [h.month, h]));
  const chain: typeof history = [];
  for (let m = addMonths(month, -1); byMonth.get(m)?.rollover; m = addMonths(m, -1)) chain.unshift(byMonth.get(m)!);
  let carry = 0;
  for (const h of chain) carry = round2(carry + h.budgeted - h.actual);
  return carry;
}

export interface BudgetLine {
  key: string;
  label: string;
  categoryId: string | null;
  groupName: string | null;
  kind: CategoryKind;
  budgeted: number;   // this month's amount
  carryIn: number;    // from rollover (0 if off)
  available: number;  // budgeted + carryIn
  actual: number;     // spent (expense) or received (income)
  left: number;       // available − actual (expense); actual − available (income: positive = more than expected)
  rollover: boolean;
  children?: BudgetLine[]; // categories inside a group budget
}

export interface BudgetMonthView {
  income: BudgetLine[];
  expenses: BudgetLine[];   // group budgets (with children) and category budgets, sorted by group then name
  unbudgeted: BudgetLine[]; // expense/income categories with activity but no budget this month
  totals: { budgetedIncome: number; actualIncome: number; budgetedExpenses: number; actualExpenses: number; unbudgetedExpenses: number };
}

export function buildBudgetMonth(
  categories: BudgetCategory[],
  budgets: BudgetRow[],
  totals: MonthTotals,
  carry: Map<string, number> = new Map(),
): BudgetMonthView {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const actualOf = (c: BudgetCategory) => actualFor(c.kind, totals.get(c.id) ?? 0);
  const covered = new Set<string>();
  const line = (b: BudgetRow, label: string, kind: CategoryKind, actual: number, children?: BudgetLine[]): BudgetLine => {
    const key = budgetKey(b);
    const carryIn = b.rollover ? carry.get(key) ?? 0 : 0;
    const available = round2(b.amount + carryIn);
    return {
      key, label, categoryId: b.categoryId, groupName: b.groupName, kind,
      budgeted: round2(b.amount), carryIn, available, actual,
      left: round2(kind === 'income' ? actual - available : available - actual),
      rollover: b.rollover, children,
    };
  };

  const income: BudgetLine[] = [];
  const expenses: BudgetLine[] = [];
  for (const b of budgets) {
    if (b.categoryId) {
      const c = cat.get(b.categoryId);
      if (!c || c.kind === 'transfer') continue;
      covered.add(c.id);
      (c.kind === 'income' ? income : expenses).push(line(b, c.name, c.kind, actualOf(c)));
    } else if (b.groupName) {
      const members = categories.filter((c) => c.group === b.groupName && c.kind === 'expense');
      const children = members
        .filter((c) => !budgets.some((x) => x.categoryId === c.id))
        .map((c) => {
          covered.add(c.id);
          const a = actualOf(c);
          return { key: `c:${c.id}`, label: c.name, categoryId: c.id, groupName: null, kind: c.kind, budgeted: 0, carryIn: 0, available: 0, actual: a, left: -a, rollover: false };
        })
        .filter((l) => l.actual !== 0);
      const actual = round2(children.reduce((s, l) => s + l.actual, 0));
      expenses.push(line(b, b.groupName, 'expense', actual, children));
    }
  }
  const groupOf = (l: BudgetLine) => (l.groupName ?? cat.get(l.categoryId!)?.group ?? '');
  expenses.sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || a.label.localeCompare(b.label));
  income.sort((a, b) => a.label.localeCompare(b.label));

  const unbudgeted: BudgetLine[] = [];
  for (const c of categories) {
    if (covered.has(c.id) || c.kind === 'transfer') continue;
    const a = actualOf(c);
    if (a === 0) continue;
    unbudgeted.push({ key: `c:${c.id}`, label: c.name, categoryId: c.id, groupName: null, kind: c.kind, budgeted: 0, carryIn: 0, available: 0, actual: a, left: c.kind === 'income' ? a : -a, rollover: false });
  }
  // Spending with no category at all.
  const none = totals.get(null) ?? 0;
  if (none < 0) unbudgeted.push({ key: 'c:none', label: 'Uncategorized', categoryId: null, groupName: null, kind: 'expense', budgeted: 0, carryIn: 0, available: 0, actual: round2(-none), left: round2(none), rollover: false });
  unbudgeted.sort((a, b) => b.actual - a.actual);

  const sum = (ls: BudgetLine[], f: (l: BudgetLine) => number) => round2(ls.reduce((s, l) => s + f(l), 0));
  return {
    income, expenses, unbudgeted,
    totals: {
      budgetedIncome: sum(income, (l) => l.budgeted),
      actualIncome: round2(sum(income, (l) => l.actual) + sum(unbudgeted.filter((l) => l.kind === 'income'), (l) => l.actual)),
      budgetedExpenses: sum(expenses, (l) => l.budgeted),
      actualExpenses: round2(sum(expenses, (l) => l.actual) + sum(unbudgeted.filter((l) => l.kind === 'expense'), (l) => l.actual)),
      unbudgetedExpenses: sum(unbudgeted.filter((l) => l.kind === 'expense'), (l) => l.actual),
    },
  };
}

export interface CompareRow { key: string; label: string; a: number; b: number; change: number; pct: number | null }

/** Side-by-side of two periods (e.g. this month vs last month or last year), biggest change first. */
export function compareTotals(labels: Map<string, string>, a: Map<string, number>, b: Map<string, number>): CompareRow[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys]
    .map((key) => {
      const va = round2(a.get(key) ?? 0), vb = round2(b.get(key) ?? 0);
      return { key, label: labels.get(key) ?? key, a: va, b: vb, change: round2(va - vb), pct: vb ? round2(((va - vb) / Math.abs(vb)) * 100) : null };
    })
    .filter((r) => r.a !== 0 || r.b !== 0)
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
}

/** Suggests a budget from history: the average monthly spending over the last `months` full months. */
export function suggestBudget(actuals: number[]): number {
  const xs = actuals.filter((x) => x > 0);
  if (!xs.length) return 0;
  return Math.ceil(xs.reduce((s, x) => s + x, 0) / actuals.length / 5) * 5;
}
