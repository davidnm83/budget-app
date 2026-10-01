/**
 * Loan interest from balance changes, as the Plaid Sync script does:
 *   interest = new balance − last balance + payments since the last balance
 * Logged only once the balance has dropped after a payment, and only when the
 * result is plausible; otherwise the caller waits for the bank to catch up.
 */
import { round2 } from './money.ts';

export const MAX_INTEREST_SHARE = 0.35;

export type InterestResult =
  | { status: 'interest'; interest: number }
  | { status: 'waiting-payment' | 'waiting-balance' | 'not-caught-up' | 'mismatch'; interest?: number };

export function computeLoanInterest(lastBalance: number, newBalance: number, paymentsSince: number): InterestResult {
  const interest = round2(newBalance - lastBalance + paymentsSince);
  if (paymentsSince <= 0) return { status: 'waiting-payment' };
  if (newBalance >= lastBalance - 0.005) return { status: 'waiting-balance' };
  if (interest < 0) return { status: 'mismatch', interest };
  if (interest > MAX_INTEREST_SHARE * paymentsSince) return { status: 'not-caught-up', interest };
  return { status: 'interest', interest };
}
