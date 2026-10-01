// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Merchant cleanup. A rule maps text found in a bank description to the
 * merchant name you use ("RCSS" → "Superstore"). Descriptions are normalised
 * first so store numbers, reference numbers and "CITY, ON" don't matter.
 */
export interface MerchantRule {
  match: string;     // text to look for (normalised before comparing)
  merchant: string;  // name to use
}

const BOILERPLATE =
  /^(POINT OF SALE - (INTERAC|VISA DEBIT)\s*|INTERNET BANKING\s*|ELECTRONIC FUNDS TRANSFER\s*|BRANCH TRANSACTION\s*|VISA DEBIT\s*|RETAIL PURCHASE\s*|PREAUTHORIZED DEBIT\s*)+/;

/** Uppercase, drop bank boilerplate, reference numbers and a trailing "CITY, PR". */
export function normalizeDescription(s: unknown): string {
  let d = String(s ?? '').toUpperCase().trim();
  const tail = d.match(/^(.*\S)\s+\S+,\s*[A-Z]{2}$/); // "RCSS 1077 TORONTO, ON" → "RCSS 1077"
  if (tail) d = tail[1];
  d = d.replace(BOILERPLATE, '');
  return d.replace(/[0-9#*]+/g, ' ').replace(/[^A-Z&' -]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The merchant for a description, or '' if no rule matches. Longest match wins. */
export function merchantFor(rules: MerchantRule[], description: string): string {
  const d = normalizeDescription(description);
  if (!d) return '';
  let best: MerchantRule | null = null;
  let bestLen = 0;
  for (const r of rules) {
    const m = normalizeDescription(r.match);
    if (m.length >= 3 && m.length > bestLen && d.includes(m)) {
      best = r;
      bestLen = m.length;
    }
  }
  return best ? best.merchant : '';
}

/**
 * Learn rules from rows you categorised yourself: for each normalised
 * description, the merchant name you used most often.
 */
export function learnMerchantRules(rows: { name: string; merchant: string }[]): MerchantRule[] {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = normalizeDescription(r.name);
    const merchant = (r.merchant ?? '').trim();
    if (!merchant || key.length < 3) continue;
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(merchant, (m.get(merchant) ?? 0) + 1);
    counts.set(key, m);
  }
  return [...counts.entries()]
    .map(([match, m]) => ({ match, merchant: [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => a.match.localeCompare(b.match));
}
