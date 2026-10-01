export interface Category { id: string; name: string; group_name: string; kind: 'expense' | 'income' | 'transfer'; sort: number }
export interface Account {
  id: string; name: string; mask: string | null; type: string | null; subtype: string | null; kind: 'plaid' | 'manual';
  current_balance: number | null; available_balance: number | null; balance_updated_at: string | null; is_hidden: boolean; plaid_item_id: string | null;
}
export interface Txn {
  id: string; account_id: string; date: string; amount: number; currency: string; name: string; merchant: string | null;
  category_id: string | null; category_source: 'rule' | 'learned' | 'plaid' | 'manual' | null; reviewed: boolean; notes: string | null; is_transfer: boolean;
  source?: 'plaid' | 'csv' | 'manual' | 'loan' | 'import'; tags?: string[]; original_date?: string | null; original_amount?: number | null;
  transaction_splits?: { id: string; amount: number; notes: string | null; category_id: string | null; categories: { name: string } | null }[];
  accounts?: { name: string; mask: string | null } | null;
  categories?: { name: string } | null;
}
export interface PlaidItem { id: string; item_id: string; institution_name: string; status: 'ok' | 'login_required' | 'error'; error_code: string | null; last_synced_at: string | null }
