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
/**
 * Plaid's personal-finance categories → category names to look for, best first. The first name
 * that exists in your list wins, so both the starter categories and Fina-style ones work.
 * Detailed codes are checked first, then their parents.
 */
const PLAID_TO_NAMES: Record<string, string[]> = {
  FOOD_AND_DRINK_GROCERIES: ['Groceries'],
  FOOD_AND_DRINK_FAST_FOOD: ['Fast food', 'Restaurants'],
  FOOD_AND_DRINK_COFFEE: ['Coffee shops', 'Restaurants'],
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: ['Alcohol & bars', 'Restaurants'],
  FOOD_AND_DRINK: ['Restaurants'],
  TRANSPORTATION_GAS: ['Gas'],
  TRANSPORTATION_PARKING: ['Parking', 'Parking & Transit'],
  TRANSPORTATION_PUBLIC_TRANSIT: ['Public transportation', 'Parking & Transit'],
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: ['Taxis', 'Other transportation', 'Parking & Transit'],
  TRANSPORTATION_TOLLS: ['Other transportation'],
  LOAN_PAYMENTS_CAR_PAYMENT: ['Car payments', 'Car Payment'],
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: ['Credit card payment'],
  RENT_AND_UTILITIES_TELEPHONE: ['Phone bill', 'Phone & Internet'],
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: ['Phone bill', 'Phone & Internet'],
  RENT_AND_UTILITIES_RENT: ['Rent'],
  GENERAL_SERVICES_INSURANCE: ['Vehicle insurance', 'Car Insurance', 'Insurance'],
  GENERAL_SERVICES_AUTOMOTIVE: ['Vehicle repairs & maintenance'],
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: ['Shipping'],
  GENERAL_SERVICES_EDUCATION: ['Tuition', 'Education'],
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: ['Gym'],
  PERSONAL_CARE_HAIR_AND_BEAUTY: ['Hair', 'Personal Care'],
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: ['Laundry', 'Personal Care'],
  PERSONAL_CARE: ['Personal Care', 'Toiletries'],
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: ['Clothing', 'Shopping'],
  GENERAL_MERCHANDISE_ELECTRONICS: ['Accessories', 'Shopping'],
  GENERAL_MERCHANDISE_SUPERSTORES: ['General goods', 'Shopping'],
  GENERAL_MERCHANDISE_DISCOUNT_STORES: ['General goods', 'Shopping'],
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: ['General goods', 'Shopping'],
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: ['Gifts & donations', 'Gifts'],
  GENERAL_MERCHANDISE: ['General goods', 'Shopping'],
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: ['Medication', 'Medical', 'Health'],
  MEDICAL_DENTAL_CARE: ['Dentist', 'Medical', 'Health'],
  MEDICAL_EYE_CARE: ['Eyecare', 'Medical', 'Health'],
  MEDICAL: ['Medical', 'Health'],
  ENTERTAINMENT_TV_AND_MOVIES: ['Movies', 'Entertainment'],
  ENTERTAINMENT_MUSIC_AND_AUDIO: ['Music', 'Entertainment'],
  ENTERTAINMENT_VIDEO_GAMES: ['Gaming', 'Entertainment'],
  ENTERTAINMENT_CASINOS_AND_GAMBLING: ['Gambling', 'Entertainment'],
  ENTERTAINMENT: ['Entertainment', 'Movies'],
  TRAVEL_FLIGHTS: ['Air travel'],
  TRAVEL_LODGING: ['Hotel'],
  BANK_FEES_INTEREST_CHARGE: ['Credit card interest', 'Interest & Fees'],
  BANK_FEES: ['Bank Charges & Fees', 'Interest & Fees'],
  LOAN_PAYMENTS: ['Interest & Fees'],
  HOME_IMPROVEMENT_FURNITURE: ['Furniture', 'Home'],
  HOME_IMPROVEMENT: ['Household items', 'Home'],
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: ['Gifts & donations', 'Gifts'],
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: ['Taxes'],
  INCOME_WAGES: ['Paycheck', 'Paycheque'],
  INCOME_INTEREST_EARNED: ['Interest income', 'Other Income'],
  INCOME_TAX_REFUND: ['Tax returns & benefits', 'Other Income'],
  INCOME: ['Other income'],
  TRANSFER_IN: ['Transfer'],
  TRANSFER_OUT: ['Transfer'],
};

/** Candidate category names for a Plaid category, best first. */
export function plaidCategoryNames(detailed?: string | null, primary?: string | null): string[] {
  const out: string[] = [];
  if (detailed) {
    for (let k = detailed; k.includes('_'); k = k.slice(0, k.lastIndexOf('_'))) out.push(...(PLAID_TO_NAMES[k] ?? []));
  }
  if (primary) out.push(...(PLAID_TO_NAMES[primary] ?? []));
  return [...new Set(out)];
}

/** The first candidate name (for display or a simple lookup). */
export function plaidCategoryToName(detailed?: string | null, primary?: string | null): string | null {
  return plaidCategoryNames(detailed, primary)[0] ?? null;
}

/** Transfers between your own accounts (incl. card payments) are left out of spending. */
export function isTransferCategory(primary?: string | null, detailed?: string | null): boolean {
  return primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT' || detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
}
