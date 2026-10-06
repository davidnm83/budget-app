// Card payment plans: loading and saving them, and writing each instalment into the books once
// its date arrives.
//
// How a plan is recorded, so budgets, reports and lists need no special cases:
//  • The purchase itself is set to the "Payment plan" category (a transfer), so it doesn't count
//    as spending in the month it was made.
//  • Each instalment, once due, becomes a $0.00 transaction on the card with two parts: the
//    instalment under the purchase's category (spending that month), and the same amount back
//    under "Payment plan". The card's balance is untouched: the purchase already put it there.
//  • The one-time fee and each month's interest are added as charges on the card. Each has its
//    own switch on the plan, for when the statement already lists it: many cards show the fee
//    as its own line when the plan starts, but not the interest.
//  • A plan against the card's balance (no single purchase): that amount was already counted as
//    spending when it was charged. With "offsetStart" on, it is taken back out of the plan's
//    category on the first instalment date (a $0.00 transaction, the mirror image of an
//    instalment), and the instalments then put it back month by month.
// Generated transactions carry import_id "plan:<plan id>:…", which is how they are found again.
import * as core from '@budget-app/core';
import { findPlanCredit, planSchedule, type PaymentPlan, type PlanOnCard } from '@budget-app/core';
import { isOffline } from './offline';
import { today } from './plan';
import { supabase } from './supabase';

export interface CardPlan extends PaymentPlan, PlanOnCard {
  accountId: string; transactionId: string | null; categoryId: string | null; interestCategoryId: string | null;
  payingAccountId: string | null;
  /** Add the interest / the one-time fee as transactions (off when the statement already lists it). */
  postCharges: boolean; postFee: boolean;
  /** Against the balance, not one purchase: take the amount out of the category when the plan starts. */
  offsetStart: boolean;
  /** The bank's plan credit, for cards that move a plan off the balance with one (see PlanOnCard). */
  creditTransactionId?: string | null;
}
export type PlanInput = Omit<CardPlan, 'id'>;
const PLAN_CATEGORY = 'Payment plan';

const fromRow = (r: any): CardPlan => ({
  id: r.id, description: r.description, principal: Number(r.principal), months: Number(r.months), startDate: r.start_date, setupFee: Number(r.setup_fee), apr: Number(r.apr),
  countFrom: r.count_from, closedOn: r.closed_on, accountId: r.account_id, transactionId: r.transaction_id, categoryId: r.category_id,
  interestCategoryId: r.interest_category_id, payingAccountId: r.paying_account_id, postCharges: r.post_charges, postFee: r.post_fee ?? true, monthlyFee: Number(r.monthly_fee ?? 0), offsetStart: !!r.offset_start,
  instalments: r.instalments ?? {}, creditTransactionId: r.credit_transaction_id ?? null,
  purchaseTxnId: r.transaction_id, creditTxnId: r.credit_transaction_id ?? null,
});
const toRow = (p: PlanInput) => ({
  description: p.description, principal: p.principal, months: p.months, start_date: p.startDate, setup_fee: p.setupFee, apr: p.apr, count_from: p.countFrom ?? null,
  closed_on: p.closedOn ?? null, account_id: p.accountId, transaction_id: p.transactionId, category_id: p.categoryId, interest_category_id: p.interestCategoryId,
  paying_account_id: p.payingAccountId, post_charges: p.postCharges, post_fee: p.postFee, monthly_fee: p.monthlyFee ?? 0, offset_start: p.offsetStart,
  // Left out when absent, so an install that hasn't run the newer migrations can still save plans.
  ...(p.creditTransactionId !== undefined && p.creditTransactionId !== null ? { credit_transaction_id: p.creditTransactionId } : {}),
  ...(p.instalments && Object.keys(p.instalments).length ? { instalments: p.instalments } : {}),
});
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
// An install that hasn't run the payment-plans migration yet simply has no plans.
const noTable = (e: any) => e?.code === 'PGRST205' || e?.code === '42P01';

export async function loadPlans(): Promise<CardPlan[]> {
  const { data, error } = await supabase.from('payment_plans').select('*').order('start_date', { ascending: false });
  if (error) { if (noTable(error)) return []; throw new Error(error.message); }
  const plans = (data ?? []).map(fromRow);
  // When the purchase and the bank's plan credit hit the card: statements and what's owed depend on it.
  const ids = plans.flatMap((p) => [p.transactionId, p.creditTransactionId]).filter(Boolean) as string[];
  const { data: dates } = ids.length ? await supabase.from('transactions').select('id, date').in('id', ids) : { data: [] };
  const at = new Map(((dates ?? []) as any[]).map((r) => [r.id, r.date as string]));
  return plans.map((p) => ({ ...p, purchaseDate: p.transactionId ? at.get(p.transactionId) ?? null : null, creditDate: p.creditTransactionId ? at.get(p.creditTransactionId) ?? null : null }));
}

/** The transfer category the purchase and the balancing half of each instalment sit under. Made the first time it's needed. */
async function planCategory(): Promise<string> {
  const { data, error } = await supabase.from('categories').select('id').eq('name', PLAN_CATEGORY).maybeSingle();
  fail(error);
  if (data) return data.id;
  const made = await supabase.from('categories').insert({ name: PLAN_CATEGORY, group_name: 'Transfers', kind: 'transfer', sort: 102 }).select('id').single();
  fail(made.error);
  return made.data!.id;
}

/** Remove everything a plan has written, so it can be written again from its current settings. */
async function clearGenerated(id: string) { fail((await supabase.from('transactions').delete().like('import_id', `plan:${id}:%`)).error); }

/**
 * Write the instalments that have come due and aren't in the books yet. Safe to call often: each
 * instalment has its own import_id, and one that is already there is skipped. Returns how many were added.
 */
export async function syncPlans(plans?: CardPlan[]): Promise<number> {
  if (isOffline()) return 0;
  const list = plans ?? await loadPlans();
  if (!list.length) return 0;
  const now = today();
  await linkPlanCredits(list);
  const { data: have, error } = await supabase.from('transactions').select('import_id').like('import_id', 'plan:%');
  fail(error);
  const done = new Set((have ?? []).map((r: any) => r.import_id as string));
  // Installs with a currency setting stamp it on each row; ones without leave it to the database's default.
  const money = typeof (core as any).currency === 'function' ? { currency: (core as any).currency() as string } : {};
  let cat: string | null = null, added = 0;
  for (const p of list) {
    const schedule = planSchedule(p);
    // Against the balance: the whole amount comes out of the category once, when the plan starts.
    const okey = `plan:${p.id}:o`, first = schedule[0];
    if (p.offsetStart && !p.transactionId && first && first.date <= now && !(p.countFrom && first.date < p.countFrom) && !done.has(okey)) {
      cat ??= await planCategory();
      const t = await supabase.from('transactions').insert({ account_id: p.accountId, date: first.date, ...money, merchant: p.description, category_source: 'manual', reviewed: true,
        reviewed_at: new Date().toISOString(), source: 'manual', amount: 0, name: `${p.description} · moved to a payment plan`, import_id: okey }).select('id').single();
      if (t.error && t.error.code !== '23505') throw new Error(t.error.message);
      if (!t.error) {
        const parts = await supabase.from('transaction_splits').insert([
          { transaction_id: t.data.id, category_id: p.categoryId, amount: p.principal, notes: 'Already counted when it was charged to the card; the instalments count it from here' },
          { transaction_id: t.data.id, category_id: cat, amount: -p.principal },
        ]);
        if (parts.error) { await supabase.from('transactions').delete().eq('id', t.data.id); throw new Error(parts.error.message); }
        added++;
      }
    }
    for (const x of schedule) {
      if (x.date > now || (p.countFrom && x.date < p.countFrom)) continue;
      const base = { account_id: p.accountId, date: x.date, ...money, merchant: p.description, category_source: 'manual', reviewed: true, reviewed_at: new Date().toISOString(), source: 'manual' };
      const key = `plan:${p.id}:${x.n}`;
      if (!done.has(key)) {
        cat ??= await planCategory();
        const last = p.closedOn === x.date && x.n === schedule.length;
        const t = await supabase.from('transactions').insert({ ...base, amount: 0, name: `${p.description} · ${last ? 'plan paid off' : `instalment ${x.n} of ${schedule.length}`}`, import_id: key }).select('id').single();
        if (t.error) { if (t.error.code === '23505') continue; throw new Error(t.error.message); } // another device got there first
        const parts = await supabase.from('transaction_splits').insert([
          { transaction_id: t.data.id, category_id: p.categoryId, amount: -x.principal },
          { transaction_id: t.data.id, category_id: cat, amount: x.principal, notes: 'Balances the instalment: the card was charged when the purchase was made' },
        ]);
        if (parts.error) { await supabase.from('transactions').delete().eq('id', t.data.id); throw new Error(parts.error.message); }
        added++;
      }
      const interest = p.postCharges ? x.interest + x.monthlyFee : 0, fee = p.postFee ? x.fee : 0; // the monthly fee goes with the interest switch
      const charge = Math.round((interest + fee) * 100) / 100, ckey = `plan:${p.id}:c:${x.n}`;
      if (charge > 0 && !done.has(ckey)) {
        const monthly = x.monthlyFee > 0 && x.interest > 0 ? 'interest and monthly fee' : x.monthlyFee > 0 ? 'monthly fee' : 'interest';
        const what = fee && interest ? `plan fee and ${monthly}` : fee ? 'plan fee' : `plan ${monthly}`;
        const c = await supabase.from('transactions').insert({ ...base, amount: -charge, name: `${p.description} · ${what}`, category_id: p.interestCategoryId, import_id: ckey });
        if (c.error && c.error.code !== '23505') throw new Error(c.error.message);
        if (!c.error) added++;
      }
    }
  }
  return added;
}

/** Take the purchase out of spending in the month it was made (the instalments carry it from here). */
async function markPurchase(txnId: string) {
  fail((await supabase.from('transactions').update({ category_id: await planCategory(), category_source: 'manual', is_transfer: true, reviewed: true, reviewed_at: new Date().toISOString() }).eq('id', txnId)).error);
  fail((await supabase.from('transaction_splits').delete().eq('transaction_id', txnId)).error);
}
async function unmarkPurchase(p: CardPlan) {
  if (p.transactionId) fail((await supabase.from('transactions').update({ category_id: p.categoryId, category_source: 'manual', is_transfer: false }).eq('id', p.transactionId)).error);
}

export async function createPlan(input: PlanInput): Promise<CardPlan> {
  const { data, error } = await supabase.from('payment_plans').insert(toRow(input)).select('*').single();
  fail(error);
  const plan = fromRow(data);
  if (plan.transactionId) await markPurchase(plan.transactionId);
  await syncPlans([plan]);
  return plan;
}

/** Change a plan. What it had written is rewritten from the new settings. */
export async function updatePlan(old: CardPlan, input: PlanInput): Promise<CardPlan> {
  const { data, error } = await supabase.from('payment_plans').update(toRow(input)).eq('id', old.id).select('*').single();
  fail(error);
  const plan = fromRow(data);
  if (old.transactionId && old.transactionId !== plan.transactionId) await unmarkPurchase(old);
  if (plan.transactionId && old.transactionId !== plan.transactionId) await markPurchase(plan.transactionId);
  await clearGenerated(plan.id);
  await syncPlans([plan]);
  return plan;
}

/**
 * Change one instalment: its date, the amount the bank billed, the payment that paid it, or its
 * budget suggestion. A new date or amount rewrites what the plan put in the books; the rest is
 * only noted on the plan. `change` replaces what was set for that instalment.
 */
export async function setInstalment(plan: CardPlan, n: number, change: core.InstalmentChange) {
  const before = plan.instalments?.[String(n)] ?? {};
  const clean = Object.fromEntries(Object.entries(change).filter(([, v]) => v != null && v !== '')) as core.InstalmentChange;
  const all = { ...(plan.instalments ?? {}) };
  if (Object.keys(clean).length) all[String(n)] = clean; else delete all[String(n)];
  const { error } = await supabase.from('payment_plans').update({ instalments: all }).eq('id', plan.id);
  fail(error);
  const next = { ...plan, instalments: all };
  if (before.date !== clean.date || before.amount !== clean.amount) { await clearGenerated(plan.id); await syncPlans([next]); }
  return next;
}

/** Paid off early: what was left becomes one last instalment today. */
export const closePlan = (p: CardPlan) => updatePlan(p, { ...p, closedOn: today() });

/** Remove a plan and what it wrote; the purchase goes back to being ordinary spending under its category. */
export async function deletePlan(p: CardPlan) {
  await clearGenerated(p.id);
  await unmarkPurchase(p);
  fail((await supabase.from('payment_plans').delete().eq('id', p.id)).error);
}

/**
 * Cards that move a plan off the balance with a credit ("INSTALLMENT PLAN FOR $1,800.00"): once that
 * credit arrives it's linked to its plan and filed under "Payment plan", so it counts as neither a
 * payment nor income. Plans whose bank keeps them in the balance never get one, and nothing changes.
 */
export async function linkPlanCredits(plans: CardPlan[]): Promise<void> {
  const open = plans.filter((p) => !p.creditTransactionId && !p.closedOn);
  if (!open.length) return;
  const taken = new Set(plans.map((p) => p.creditTransactionId).filter(Boolean) as string[]);
  const from = open.reduce((m, p) => { const d = p.purchaseDate ?? core.monthsAfter(p.startDate, -2); return d < m ? d : m; }, '9999-12-31');
  const { data, error } = await supabase.from('transactions').select('id, account_id, date, amount, name').in('account_id', [...new Set(open.map((p) => p.accountId))])
    .gt('amount', 0).gte('date', core.addDays(from, -3)).limit(500);
  if (error || !data?.length) return;
  const rows = (data as any[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  for (const p of open) {
    const hit = findPlanCredit(p, rows.filter((r) => r.account_id === p.accountId), taken);
    if (!hit) continue;
    taken.add(hit.id);
    const up = await supabase.from('payment_plans').update({ credit_transaction_id: hit.id }).eq('id', p.id);
    if (up.error) return; // before the migration: nothing to store it in
    await supabase.from('transactions').update({ category_id: await planCategory(), category_source: 'manual', is_transfer: true }).eq('id', hit.id);
    p.creditTransactionId = hit.id; p.creditTxnId = hit.id; p.creditDate = hit.date;
  }
}

/** Link the bank's plan credit by hand (or unlink it with null). A linked credit is filed under "Payment plan". */
export async function setPlanCredit(p: CardPlan, txnId: string | null): Promise<void> {
  fail((await supabase.from('payment_plans').update({ credit_transaction_id: txnId }).eq('id', p.id)).error);
  if (txnId) fail((await supabase.from('transactions').update({ category_id: await planCategory(), category_source: 'manual', is_transfer: true }).eq('id', txnId)).error);
}
