import { balanceHistory, plansOffBalance, type PlanOnCard } from '@budget-app/core';

export interface Category { id: string; name: string; group_name: string; kind: 'expense' | 'income' | 'transfer'; sort: number }
export interface Account {
  id: string; name: string; mask: string | null; type: string | null; subtype: string | null; kind: 'plaid' | 'manual';
  current_balance: number | null; available_balance: number | null; balance_updated_at: string | null; is_hidden: boolean; plaid_item_id: string | null;
  official_name?: string | null; plan_include?: boolean; plan_buffer?: number; start_balance?: number | null;
  credit_limit?: number | null; statement_day?: number | null; due_day?: number | null; apr?: number | null;
  loan_payment_match?: string | null; loan_paying_account_id?: string | null; loan_last_balance?: number | null; loan_last_balance_date?: string | null; icon?: string | null; csv_reminder?: boolean | null;
  /** Cards: still owed on payment plans the bank has moved off its balance (added by loadAccounts), and those plans. */
  off_balance?: number; off_plans?: PlanOnCard[];
}
export interface Txn {
  id: string; account_id: string; date: string; amount: number; currency: string; name: string; merchant: string | null;
  category_id: string | null; category_source: 'rule' | 'learned' | 'plaid' | 'manual' | null; reviewed: boolean; notes: string | null; is_transfer: boolean;
  source?: 'plaid' | 'csv' | 'manual' | 'loan' | 'import'; tags?: string[]; transfer_pair_id?: string | null; original_date?: string | null; original_amount?: number | null;
  transaction_splits?: { id: string; amount: number; notes: string | null; category_id: string | null; categories: { name: string } | null }[];
  accounts?: { name: string; mask: string | null } | null;
  categories?: { name: string } | null;
}
export interface PlaidItem { id: string; item_id: string; institution_name: string; status: 'ok' | 'login_required' | 'error'; error_code: string | null; last_synced_at: string | null }

// Plaid reports what you owe on cards and loans as a positive balance; the app shows it as negative.
/** The balance as the bank reports it. Card statements are worked out from this one. */
export const bankBalance = (a: Pick<Account, 'type' | 'current_balance'>) => (a.type === 'credit' || a.type === 'loan' ? -1 : 1) * Number(a.current_balance ?? 0);
/**
 * The balance everywhere else: for a card, everything owed on it, including payment plans the bank
 * has moved off its balance with a credit (still owed, billed month by month).
 */
export const signedBalance = (a: Pick<Account, 'type' | 'current_balance'> & { off_balance?: number }) => bankBalance(a) - (a.type === 'credit' ? a.off_balance ?? 0 : 0);
/** What a card's off-balance plans came to on a past date (for charts worked back from today). */
export const offBalanceAt = (a: Pick<Account, 'off_plans'>, date: string) => plansOffBalance(a.off_plans ?? [], date);

/** The heading an account sits under in lists and pickers, by its type. */
export const ACCOUNT_GROUPS = ['Cash', 'Credit cards', 'Loans', 'Investments', 'Other'] as const;
export function accountGroup(type: string | null | undefined): string {
  return type === 'depository' ? 'Cash' : type === 'credit' ? 'Credit cards' : type === 'loan' ? 'Loans' : type === 'investment' ? 'Investments' : 'Other';
}
/** Accounts in picker order: by group (Cash, cards, loans…), then name. */
export const byAccountGroup = <T extends { type?: string | null; name: string }>(list: T[]) =>
  [...list].sort((a, b) => ACCOUNT_GROUPS.indexOf(accountGroup(a.type) as any) - ACCOUNT_GROUPS.indexOf(accountGroup(b.type) as any) || a.name.localeCompare(b.name));

/** A day's balance as the bank reported it (IDEA-2), oldest first. */
export interface Snapshot { date: string; balance: number }
/**
 * Accounts whose balance moves without a transaction (an investment's market value, a loan's interest).
 * Their history follows the saved daily balances where there are any; cash and cards are worked back from
 * their transactions, which explain every change and match what a tap on the chart lists.
 */
export const followsSnapshots = (a: Pick<Account, 'type'>) => a.type === 'investment' || a.type === 'loan';

/**
 * An account's balance over time, worked back from today's through its transactions. For a card,
 * what's owed in all on each date: the plans the bank had moved off its balance by then are added.
 * For investments and loans, a date on or after the first saved balance uses the latest one saved by then.
 */
export function accountHistory(a: Account, txns: { date: string; amount: number }[], today: string, points: number, step: number, snaps: Snapshot[] = []) {
  const now = a.off_balance ?? 0;
  const worked = balanceHistory(signedBalance(a), txns, today, points, step)
    .map((p) => (a.off_plans?.length ? { ...p, balance: p.balance + now - offBalanceAt(a, p.date) } : p));
  if (!snaps.length || !followsSnapshots(a)) return worked;
  return worked.map((p) => {
    if (p.date >= today) return p; // today: the balance the app has now
    let last: Snapshot | null = null;
    for (const s of snaps) { if (s.date > p.date) break; last = s; }
    return last ? { ...p, balance: last.balance } : p;
  });
}
