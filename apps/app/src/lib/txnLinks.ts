// Links that open the Transactions tab on a view (to review, a search, an account, a month). The tab
// clears whatever filters were left on it first, so the view is exactly what the link asked for.
// `v` makes each link new even when it asks for the same view twice.
import { router } from 'expo-router';

export interface TxnView { mode?: 'all' | 'review'; q?: string; account?: string; from?: string; to?: string; label?: string }

export function txnHref(view: TxnView = {}) {
  const params: Record<string, string> = { v: String(Date.now()) };
  for (const [k, x] of Object.entries(view)) if (x) params[k] = x;
  return { pathname: '/transactions', params } as any;
}

export function openTransactions(view: TxnView = {}) { router.navigate(txnHref(view)); }
