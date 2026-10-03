export interface Category { id: string; name: string; group_name: string; kind: 'expense' | 'income' | 'transfer'; sort: number }
export interface Account {
  id: string; name: string; mask: string | null; type: string | null; subtype: string | null; kind: 'plaid' | 'manual';
  current_balance: number | null; available_balance: number | null; balance_updated_at: string | null; is_hidden: boolean; plaid_item_id: string | null;
  official_name?: string | null; plan_include?: boolean; plan_buffer?: number; start_balance?: number | null;
  credit_limit?: number | null; statement_day?: number | null; due_day?: number | null; apr?: number | null;
  loan_payment_match?: string | null; loan_paying_account_id?: string | null; loan_last_balance?: number | null; loan_last_balance_date?: string | null; icon?: string | null; csv_reminder?: boolean | null;
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
export const signedBalance = (a: Pick<Account, 'type' | 'current_balance'>) => (a.type === 'credit' || a.type === 'loan' ? -1 : 1) * Number(a.current_balance ?? 0);

/** The heading an account sits under in lists and pickers, by its type. */
export const ACCOUNT_GROUPS = ['Cash', 'Credit cards', 'Loans', 'Investments', 'Other'] as const;
export function accountGroup(type: string | null | undefined): string {
  return type === 'depository' ? 'Cash' : type === 'credit' ? 'Credit cards' : type === 'loan' ? 'Loans' : type === 'investment' ? 'Investments' : 'Other';
}
/** Accounts in picker order: by group (Cash, cards, loans…), then name. */
export const byAccountGroup = <T extends { type?: string | null; name: string }>(list: T[]) =>
  [...list].sort((a, b) => ACCOUNT_GROUPS.indexOf(accountGroup(a.type) as any) - ACCOUNT_GROUPS.indexOf(accountGroup(b.type) as any) || a.name.localeCompare(b.name));
