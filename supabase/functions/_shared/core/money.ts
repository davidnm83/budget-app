// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
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

export function formatMoney(n: number, currency = 'CAD'): string {
  const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sym = currency === 'CAD' || currency === 'USD' ? '$' : currency + ' ';
  return (n < 0 ? '-' : '') + sym + abs;
}
