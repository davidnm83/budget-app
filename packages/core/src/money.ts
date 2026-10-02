/**
 * Amount convention used everywhere in the app: money OUT of an account is
 * negative, money IN is positive (Fina/spreadsheet style). Plaid uses the
 * opposite sign, so convert at the edge with fromPlaidAmount().
 */
export function fromPlaidAmount(plaidAmount: number): number {
  return round2(-plaidAmount);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "-$1,234.56", "(12.00)", "1,234", 12 → number. Empty or unreadable → NaN. */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || s.includes('-');
  const n = parseFloat(s.replace(/[()\-]/g, ''));
  if (isNaN(n)) return NaN;
  return neg ? -n : n;
}

let CURRENCY = 'USD';
let SYMBOL = '$';

/** Sets the currency every amount is shown in (a 3-letter code such as USD, EUR, GBP). */
export function setCurrency(code: string): void {
  CURRENCY = (code || 'USD').toUpperCase();
  try {
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
    SYMBOL = parts.find((p) => p.type === 'currency')?.value ?? CURRENCY + ' ';
  } catch {
    SYMBOL = CURRENCY + ' ';
  }
  if (/^[A-Z]{3}$/.test(SYMBOL)) SYMBOL += ' ';
}
export const currency = (): string => CURRENCY;
export const currencySymbol = (): string => SYMBOL;

export function formatMoney(n: number, _currency?: string): string {
  const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + SYMBOL + abs;
}
