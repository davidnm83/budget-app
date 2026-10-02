// Card payment plans: loading and saving them, and writing each instalment into the books once
// its date arrives.
//
// How a plan is recorded, so budgets, reports and lists need no special cases:
//  • The purchase itself is set to the "Payment plan" category (a transfer), so it doesn't count
//    as spending in the month it was made.
//  • Each instalment, once due, becomes a $0.00 transaction on the card with two parts: the
//    instalment under the purchase's category (spending that month), and the same amount back
//    under "Payment plan". The card's balance is untouched: the purchase already put it there.
//  • The one-time fee and each month's interest are added as charges on the card, unless the
//    plan says the statement already lists them.
// Generated transactions carry import_id "plan:<plan id>:…", which is how they are found again.
import { currency, planSchedule, type PaymentPlan } from '@budget-app/core';
import { isOffline } from './offline';
import { today } from './plan';
import { supabase } from './supabase';

export interface CardPlan extends PaymentPlan {
  accountId: string; transactionId: string | null; categoryId: string | null; interestCategoryId: string | null;
  payingAccountId: string | null; postCharges: boolean;
}
export type PlanInput = Omit<CardPlan, 'id'>;
const PLAN_CATEGORY = 'Payment plan';

const fromRow = (r: any): CardPlan => ({
  id: r.id, description: r.description, principal: Number(r.principal), months: Number(r.months), startDate: r.start_date, setupFee: Number(r.setup_fee), apr: Number(r.apr),
  countFrom: r.count_from, closedOn: r.closed_on, accountId: r.account_id, transactionId: r.transaction_id, categoryId: r.category_id,
  interestCategoryId: r.interest_category_id, payingAccountId: r.paying_account_id, postCharges: r.post_charges,
});
const toRow = (p: PlanInput) => ({
  description: p.description, principal: p.principal, months: p.months, start_date: p.startDate, setup_fee: p.setupFee, apr: p.apr, count_from: p.countFrom ?? null,
  closed_on: p.closedOn ?? null, account_id: p.accountId, transaction_id: p.transactionId, category_id: p.categoryId, interest_category_id: p.interestCategoryId,
  paying_account_id: p.payingAccountId, post_charges: p.postCharges,
});
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
// An install that hasn't run the payment-plans migration yet simply has no plans.
const noTable = (e: any) => e?.code === 'PGRST205' || e?.code === '42P01';

export async function loadPlans(): Promise<CardPlan[]> {
  const { data, error } = await supabase.from('payment_plans').select('*').order('start_date', { ascending: false });
  if (error) { if (noTable(error)) return []; throw new Error(error.message); }
  return (data ?? []).map(fromRow);
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
  const { data: have, error } = await supabase.from('transactions').select('import_id').like('import_id', 'plan:%');
  fail(error);
  const done = new Set((have ?? []).map((r: any) => r.import_id as string));
  let cat: string | null = null, added = 0;
  for (const p of list) {
    const schedule = planSchedule(p);
    for (const x of schedule) {
      if (x.date > now || (p.countFrom && x.date < p.countFrom)) continue;
      const base = { account_id: p.accountId, date: x.date, currency: currency(), merchant: p.description, category_source: 'manual', reviewed: true, reviewed_at: new Date().toISOString(), source: 'manual' };
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
      const charge = x.interest + x.fee, ckey = `plan:${p.id}:c:${x.n}`;
      if (p.postCharges && charge > 0 && !done.has(ckey)) {
        const what = x.fee && x.interest ? 'plan fee and interest' : x.fee ? 'plan fee' : 'plan interest';
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

/** Paid off early: what was left becomes one last instalment today. */
export const closePlan = (p: CardPlan) => updatePlan(p, { ...p, closedOn: today() });

/** Remove a plan and what it wrote; the purchase goes back to being ordinary spending under its category. */
export async function deletePlan(p: CardPlan) {
  await clearGenerated(p.id);
  await unmarkPurchase(p);
  fail((await supabase.from('payment_plans').delete().eq('id', p.id)).error);
}
