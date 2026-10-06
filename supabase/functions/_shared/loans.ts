/**
 * Loans (ACC-5, LOAN-1), run after each sync, the way the Plaid Sync script does it:
 *   • Payments: a debit on another account whose description contains the loan's
 *     "payment match" text (e.g. "TD ON-LINE LOANS") is copied to the loan as a payment,
 *     and both sides are marked as a transfer so it isn't counted as spending twice.
 *   • Interest: when the loan's balance from the bank drops after payments,
 *       interest = new balance − last balance + payments since
 *     is logged on the loan as "Interest Accrued <from> - <to>".
 */
import type { Admin } from './supabase.ts';
import { addDays, computeLoanInterest, dedupeAgainstExisting, normalizeDescription, shortDate } from './core/index.ts';

export interface LoanResult { loan: string; payments: number; interest: number | null; status: string }

export async function processLoans(admin: Admin, userId: string, today: string): Promise<LoanResult[]> {
  const { data: loans } = await admin.from('accounts')
    .select('id, name, kind, current_balance, loan_payment_match, loan_paying_account_id, loan_last_balance, loan_last_balance_date')
    .eq('user_id', userId).eq('type', 'loan');
  const out: LoanResult[] = [];
  if (!loans?.length) return out;
  const { data: cats } = await admin.from('categories').select('id, name, kind').eq('user_id', userId);
  const transferCat = (cats ?? []).find((c: any) => c.kind === 'transfer' && /^transfer$/i.test(c.name))?.id ?? null;

  for (const loan of loans as any[]) {
    const r: LoanResult = { loan: loan.name, payments: 0, interest: null, status: '' };
    const { data: onLoan } = await admin.from('transactions').select('id, date, amount, name, pending').eq('account_id', loan.id).gte('date', addDays(today, -120));
    const loanRows = (onLoan ?? []).filter((x: any) => !x.pending).map((x: any) => ({ ...x, amount: Number(x.amount) }));

    // 1) Payments copied from the paying account(s).
    if (loan.loan_payment_match) {
      const needle = normalizeDescription(loan.loan_payment_match);
      const { data: debits } = await admin.from('transactions').select('id, account_id, date, amount, name, merchant, pending')
        .eq('user_id', userId).gte('date', addDays(today, -60)).lt('amount', 0);
      // Pending debits wait until they post, so a payment isn't copied from one the bank later changes.
      const candidates = (debits ?? []).filter((x: any) => !x.pending)
        .filter((d: any) => d.account_id !== loan.id && (!loan.loan_paying_account_id || d.account_id === loan.loan_paying_account_id))
        .filter((d: any) => normalizeDescription(`${d.merchant ?? ''} ${d.name}`).includes(needle));
      // Skip ones already on the loan (copied before, or imported from Fina): same amount within 3 days.
      const fresh = dedupeAgainstExisting(
        candidates.map((d: any) => ({ date: d.date, name: d.id, amount: -Number(d.amount) })),
        loanRows.filter((x) => x.amount > 0).map((x) => ({ date: x.date, amount: x.amount })),
      ).add;
      for (const f of fresh) {
        const src = candidates.find((d: any) => d.id === f.name)!;
        const { data: ins, error } = await admin.from('transactions').insert({
          user_id: userId, account_id: loan.id, source: 'loan', date: src.date, amount: -Number(src.amount),
          name: 'LOAN PAYMENT', merchant: loan.name, category_id: transferCat, category_source: 'rule',
          is_transfer: true, reviewed: true, import_id: `loanpay:${src.id}`, transfer_pair_id: src.id,
        }).select('id').single();
        if (error) { r.status += `payment copy failed: ${error.message}; `; continue; }
        await admin.from('transactions').update({ is_transfer: true, transfer_pair_id: ins!.id }).eq('id', src.id);
        loanRows.push({ id: ins!.id, date: src.date, amount: -Number(src.amount), name: 'LOAN PAYMENT' });
        r.payments++;
      }
    }

    // 2) Interest from the change in the bank's balance (connected loans only).
    const bal = loan.kind === 'plaid' && loan.current_balance != null ? Number(loan.current_balance) : null;
    if (bal == null) {
      r.status += 'no bank balance (interest needs a connected loan)';
    } else if (loan.loan_last_balance == null || !loan.loan_last_balance_date) {
      await admin.from('accounts').update({ loan_last_balance: bal, loan_last_balance_date: today }).eq('id', loan.id);
      r.status += 'starting balance recorded';
    } else {
      const paid = loanRows.filter((x) => x.amount > 0 && x.date > loan.loan_last_balance_date).reduce((s, x) => s + x.amount, 0);
      const res = computeLoanInterest(Number(loan.loan_last_balance), bal, paid);
      if (res.status === 'interest') {
        if (res.interest > 0) {
          await admin.from('transactions').insert({
            user_id: userId, account_id: loan.id, source: 'loan', date: today, amount: -res.interest,
            name: `Interest Accrued ${shortDate(addDays(loan.loan_last_balance_date, 1))} - ${shortDate(today)}`,
            merchant: loan.name, category_id: transferCat, category_source: 'rule', is_transfer: true, reviewed: true,
            import_id: `loanint:${loan.id}:${loan.loan_last_balance_date}>${today}`,
          });
        }
        await admin.from('accounts').update({ loan_last_balance: bal, loan_last_balance_date: today }).eq('id', loan.id);
        r.interest = res.interest;
        r.status += `interest ${res.interest.toFixed(2)} logged`;
      } else {
        r.status += {
          'waiting-payment': 'waiting for the next payment',
          'waiting-balance': 'payment found; waiting for the bank balance to update',
          'not-caught-up': "waiting: the balance hasn't caught up with all payments",
          mismatch: 'balance dropped by more than the payments found; check the payment match text',
        }[res.status];
      }
    }
    out.push(r);
  }
  return out;
}
