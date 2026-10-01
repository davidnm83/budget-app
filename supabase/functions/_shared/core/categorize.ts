// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Picks a category for a new transaction:
 *   1. your rules (longest matching text wins; optional account and amount range)
 *   2. the category you used last time for the same merchant ("learned")
 *   3. a mapping from Plaid's category, if you set one up
 * The result says where it came from so the review inbox can show it.
 */
import { normalizeDescription } from './merchants.ts';

export interface CategoryRule {
  id?: string;
  matchText: string;        // looked for in the merchant name and the description
  categoryId: string;
  accountId?: string | null;
  minAmount?: number | null; // compared to the absolute amount
  maxAmount?: number | null;
}

export interface TxnForCategorize {
  name: string;
  merchant: string;
  amount: number;
  accountId: string;
  plaidCategory?: string | null; // e.g. 'FOOD_AND_DRINK_GROCERIES'
}

export type CategorySource = 'rule' | 'learned' | 'plaid' | null;

export interface CategorySuggestion {
  categoryId: string | null;
  source: CategorySource;
}

export function matchRule(rules: CategoryRule[], t: TxnForCategorize): CategoryRule | null {
  const hay = normalizeDescription(t.merchant) + ' | ' + normalizeDescription(t.name);
  const abs = Math.abs(t.amount);
  let best: CategoryRule | null = null;
  let bestLen = 0;
  for (const r of rules) {
    const needle = normalizeDescription(r.matchText);
    if (needle.length < 2 || !hay.includes(needle)) continue;
    if (r.accountId && r.accountId !== t.accountId) continue;
    if (r.minAmount != null && abs < r.minAmount) continue;
    if (r.maxAmount != null && abs > r.maxAmount) continue;
    if (needle.length > bestLen) {
      best = r;
      bestLen = needle.length;
    }
  }
  return best;
}

export function suggestCategory(
  t: TxnForCategorize,
  rules: CategoryRule[],
  learnedByMerchant: Record<string, string>, // merchant (lowercase) → categoryId
  plaidMap: Record<string, string> = {},      // Plaid category → categoryId
): CategorySuggestion {
  const rule = matchRule(rules, t);
  if (rule) return { categoryId: rule.categoryId, source: 'rule' };
  const learned = t.merchant ? learnedByMerchant[t.merchant.toLowerCase()] : undefined;
  if (learned) return { categoryId: learned, source: 'learned' };
  if (t.plaidCategory && plaidMap[t.plaidCategory]) return { categoryId: plaidMap[t.plaidCategory], source: 'plaid' };
  return { categoryId: null, source: null };
}

/**
 * Default mapping from Plaid's personal-finance categories to the starter
 * category names. Detailed codes are checked first, then the primary code.
 */
const PLAID_TO_NAME: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries',
  FOOD_AND_DRINK: 'Restaurants',
  TRANSPORTATION_GAS: 'Gas',
  TRANSPORTATION_PARKING: 'Parking & Transit',
  TRANSPORTATION_PUBLIC_TRANSIT: 'Parking & Transit',
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: 'Parking & Transit',
  LOAN_PAYMENTS_CAR_PAYMENT: 'Car Payment',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'Credit Card Payment',
  RENT_AND_UTILITIES_TELEPHONE: 'Phone & Internet',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'Phone & Internet',
  GENERAL_SERVICES_INSURANCE: 'Car Insurance',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'Gym',
  PERSONAL_CARE: 'Personal Care',
  GENERAL_MERCHANDISE: 'Shopping',
  MEDICAL: 'Health',
  ENTERTAINMENT: 'Entertainment',
  BANK_FEES: 'Interest & Fees',
  LOAN_PAYMENTS: 'Interest & Fees',
  GENERAL_SERVICES_EDUCATION: 'Education',
  HOME_IMPROVEMENT: 'Home',
  INCOME_WAGES: 'Paycheque',
  INCOME: 'Other Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
};

export function plaidCategoryToName(detailed?: string | null, primary?: string | null): string | null {
  if (detailed) {
    for (let k = detailed; k.includes('_'); k = k.slice(0, k.lastIndexOf('_'))) {
      if (PLAID_TO_NAME[k]) return PLAID_TO_NAME[k];
    }
  }
  return (primary && PLAID_TO_NAME[primary]) || null;
}

/** Transfers between your own accounts (incl. card payments) are left out of spending. */
export function isTransferCategory(primary?: string | null, detailed?: string | null): boolean {
  return primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT' || detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
}
