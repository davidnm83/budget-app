// Pay later (buy now, pay later): loading and saving plans, and keeping the books in step with them.
//
// How a plan is recorded, so the planner, budgets, reports and net worth need no special cases:
//  • A bill (recurring) for the payments, on the account they come from: the planner shows each one and matches it
//    to the real payment, Bills lists it, notifications remind you. Payments of an odd amount (the first, or the
//    last with interest) are per-date changes of that bill.
//  • Each matched payment is filed under what was bought: spending in the month it's paid.
//  • What's still owed sits on a "Pay later" account (a manual loan account): the purchase adds to it and each payment
//    made takes its share of the price off, both under the "Pay later" transfer category, so net worth counts the debt
//    and the budget doesn't count anything twice. These carry import_id "paylater:<plan id>:…".
import * as core from '@budget-app/core';
import { payLaterRegular, payLaterSchedule, payLaterStatus, type PayLater, type PayLaterStatus, type PostedTxn } from '@budget-app/core';
import { isOffline } from './offline';
import { loadPosted, today } from './plan';
import { supabase } from './supabase';

export interface PayLaterPlan extends PayLater {
  categoryId: string | null; purchaseDate: string | null; recurringId: string | null; notes: string | null;
}
export type PayLaterInput = Omit<PayLaterPlan, 'id' | 'recurringId' | 'paidByHand' | 'closedOn'> & { paidByHand?: number[]; closedOn?: string | null };

const CATEGORY = 'Pay later';
const ACCOUNT_SUBTYPE = 'pay later';
const fail = (e: { message: string; code?: string } | null) => { if (e) throw new Error(e.message); };
const noTable = (e: any) => e?.code === 'PGRST205' || e?.code === '42P01';
export const NEEDS_UPDATE = 'Pay later needs the newest database update (supabase db push).';

const fromRow = (r: any): PayLaterPlan => ({
  id: r.id, provider: r.provider, description: r.description, total: Number(r.total), downPayment: Number(r.down_payment), payments: Number(r.payments),
  frequency: r.frequency, firstDate: r.first_date, apr: Number(r.apr), accountId: r.account_id, matchText: r.match_text,
  paidByHand: (r.paid_by_hand ?? []).map(Number), closedOn: r.closed_on, categoryId: r.category_id, purchaseDate: r.purchase_date,
  recurringId: r.recurring_id, notes: r.notes,
});
const toRow = (p: PayLaterInput) => ({
  provider: p.provider, description: p.description, total: p.total, down_payment: p.downPayment, payments: p.payments, frequency: p.frequency,
  first_date: p.firstDate, purchase_date: p.purchaseDate, apr: p.apr, account_id: p.accountId, category_id: p.categoryId,
  match_text: p.matchText?.trim() || null, notes: p.notes, ...(p.paidByHand ? { paid_by_hand: p.paidByHand } : {}), ...(p.closedOn !== undefined ? { closed_on: p.closedOn } : {}),
});

export async function loadPayLater(): Promise<PayLaterPlan[]> {
  const { data, error } = await supabase.from('pay_later').select('*').order('first_date', { ascending: false });
  if (error) { if (noTable(error)) return []; throw new Error(error.message); }
  return (data ?? []).map(fromRow);
}

/** Each plan with where it stands: payments made (matched or marked), what's owed, the next one. */
export async function loadPayLaterStatus(plans?: PayLaterPlan[]): Promise<{ plan: PayLaterPlan; status: PayLaterStatus }[]> {
  const list = plans ?? await loadPayLater();
  const txns = await paymentsFor(list);
  const taken = new Set<string>();
  return list.slice().sort((a, b) => a.firstDate.localeCompare(b.firstDate)).map((plan) => {
    const status = payLaterStatus(plan, txns, today(), taken);
    for (const x of status.schedule) if (x.txnId) taken.add(x.txnId);
    return { plan, status };
  });
}

async function paymentsFor(list: PayLaterPlan[]): Promise<PostedTxn[]> {
  const ids = [...new Set(list.map((p) => p.accountId).filter(Boolean) as string[])];
  if (!ids.length) return [];
  const from = list.reduce((m, p) => (p.firstDate < m ? p.firstDate : m), today());
  const to = list.reduce((m, p) => { const s = payLaterSchedule(p); const last = s[s.length - 1]?.date ?? p.firstDate; return last > m ? last : m; }, today());
  return loadPosted(ids, core.addDays(from, -7), core.addDays(to, 10));
}

export async function savePayLater(input: PayLaterInput, id?: string): Promise<string> {
  const row = toRow(input);
  if (id) {
    fail((await supabase.from('pay_later').update(row).eq('id', id)).error);
    // The schedule may have changed: what was written for the old one goes, and is written again.
    await clearGenerated(id);
    const { data } = await supabase.from('pay_later').select('recurring_id').eq('id', id).single();
    if (data?.recurring_id) fail((await supabase.from('plan_entries').delete().eq('recurring_id', data.recurring_id).is('matched_transaction_id', null)).error);
  } else {
    const made = await supabase.from('pay_later').insert(row).select('id').single();
    if (made.error) throw new Error(noTable(made.error) ? NEEDS_UPDATE : made.error.message);
    id = made.data.id as string;
  }
  await syncPayLater();
  return id!;
}

export async function updatePayLater(id: string, patch: { paidByHand?: number[]; closedOn?: string | null }) {
  fail((await supabase.from('pay_later').update({ ...(patch.paidByHand ? { paid_by_hand: patch.paidByHand } : {}), ...(patch.closedOn !== undefined ? { closed_on: patch.closedOn } : {}) }).eq('id', id)).error);
  await syncPayLater();
}

export async function deletePayLater(plan: PayLaterPlan) {
  await clearGenerated(plan.id);
  if (plan.recurringId) fail((await supabase.from('recurring').delete().eq('id', plan.recurringId)).error);
  fail((await supabase.from('pay_later').delete().eq('id', plan.id)).error);
}

async function clearGenerated(id: string) { fail((await supabase.from('transactions').delete().like('import_id', `paylater:${id}:%`)).error); }

/** The transfer category the Pay later account's entries sit under. Made the first time it's needed. */
async function payLaterCategory(): Promise<string> {
  const { data, error } = await supabase.from('categories').select('id').eq('name', CATEGORY).eq('kind', 'transfer').maybeSingle();
  fail(error);
  if (data) return data.id;
  const made = await supabase.from('categories').insert({ name: CATEGORY, group_name: 'Transfers', kind: 'transfer', sort: 104 }).select('id').single();
  fail(made.error);
  return made.data!.id;
}

/** The account what's owed sits on. Made the first time it's needed. */
async function payLaterAccount(): Promise<string> {
  const { data, error } = await supabase.from('accounts').select('id').eq('kind', 'manual').eq('subtype', ACCOUNT_SUBTYPE).limit(1);
  fail(error);
  if (data?.length) return data[0].id;
  const made = await supabase.from('accounts').insert({ name: 'Pay later', kind: 'manual', type: 'loan', subtype: ACCOUNT_SUBTYPE, start_balance: 0, csv_reminder: false }).select('id').single();
  fail(made.error);
  return made.data!.id;
}

/** Is this the Pay later account (kept by the app, not a loan of its own)? */
export const isPayLaterAccount = (a: { subtype?: string | null; kind?: string }) => a.subtype === ACCOUNT_SUBTYPE;

/**
 * Brings the books in line with the plans: each plan's bill and odd-amount payments, matched payments filed under what
 * was bought, and the Pay later account's entries. Safe to call often. Returns how many entries it added.
 */
export async function syncPayLater(): Promise<number> {
  if (isOffline()) return 0;
  const plans = await loadPayLater().catch(() => [] as PayLaterPlan[]);
  if (!plans.length) return 0;
  const rows = await loadPayLaterStatus(plans);
  const [cat, account] = [await payLaterCategory(), await payLaterAccount()];
  const { data: have, error } = await supabase.from('transactions').select('id, import_id, amount, date').like('import_id', 'paylater:%');
  fail(error);
  const existing = new Map(((have ?? []) as any[]).map((r) => [r.import_id as string, r]));
  const money = typeof (core as any).currency === 'function' ? { currency: (core as any).currency() as string } : {};
  const wanted = new Map<string, { date: string; amount: number; name: string }>();
  let added = 0;

  for (const { plan: p, status } of rows) {
    const s = status.schedule;
    const name = `${p.provider} · ${p.description}`;
    // The bill for the payments.
    const bill = {
      name, kind: 'bill', amount: -payLaterRegular(s), estimated: false, frequency: p.frequency, start_date: p.firstDate, end_date: s[s.length - 1]?.date ?? p.firstDate,
      account_id: p.accountId, category_id: p.categoryId, match_text: p.matchText, active: !status.done,
      notes: 'Kept by Pay later: change it there.',
    };
    let rid = p.recurringId;
    if (rid) {
      const up = await supabase.from('recurring').update(bill).eq('id', rid).select('id');
      fail(up.error);
      if (!up.data?.length) rid = null; // deleted under Bills: made again
    }
    if (!rid) {
      const made = await supabase.from('recurring').insert(bill).select('id').single();
      fail(made.error);
      rid = made.data!.id as string;
      fail((await supabase.from('pay_later').update({ recurring_id: rid }).eq('id', p.id)).error);
    }
    // Payments of an odd amount: that date's change of the bill (one you've changed yourself is left alone).
    const regular = payLaterRegular(s);
    for (const x of s.filter((y) => Math.abs(y.amount - regular) >= 0.005)) {
      const ins = await supabase.from('plan_entries').insert({ recurring_id: rid, occurrence_date: x.date, date: x.date, description: name, amount: -x.amount, account_id: p.accountId });
      if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message);
    }
    // Matched payments are spending in what was bought (unless you've filed one yourself).
    const paidIds = s.map((x) => x.txnId).filter(Boolean) as string[];
    if (p.categoryId && paidIds.length) {
      fail((await supabase.from('transactions').update({ category_id: p.categoryId, category_source: 'rule', is_transfer: false })
        .in('id', paidIds).or('category_source.is.null,category_source.neq.manual')).error);
    }
    // What's owed: the purchase onto the Pay later account, each payment's share of the price off it.
    const principal = core.payLaterPrincipal(p);
    wanted.set(`paylater:${p.id}:buy`, { date: p.purchaseDate ?? p.firstDate, amount: -principal, name: `${name} · bought` });
    for (const x of s.filter((y) => y.paid)) wanted.set(`paylater:${p.id}:${x.n}`, { date: x.date, amount: x.principal, name: `${name} · payment ${x.n} of ${s.length}` });
    if (p.closedOn && status.unpaid > 0) wanted.set(`paylater:${p.id}:close`, { date: p.closedOn, amount: status.unpaid, name: `${name} · closed` });
  }

  for (const [key, w] of wanted) {
    const e = existing.get(key);
    if (e && Math.abs(Number(e.amount) - w.amount) < 0.005 && e.date === w.date) continue;
    if (e) fail((await supabase.from('transactions').delete().eq('id', e.id)).error);
    const t = await supabase.from('transactions').insert({
      account_id: account, date: w.date, amount: w.amount, ...money, name: w.name, merchant: w.name.split(' · ')[0], category_id: cat, category_source: 'manual',
      is_transfer: true, reviewed: true, reviewed_at: new Date().toISOString(), source: 'manual', import_id: key,
    });
    if (t.error && t.error.code !== '23505') throw new Error(t.error.message);
    if (!t.error) added++;
  }
  // Entries no longer wanted (a payment unmarked, a plan's schedule changed).
  const stale = [...existing.entries()].filter(([k]) => !wanted.has(k) && rows.some(({ plan }) => k.startsWith(`paylater:${plan.id}:`))).map(([, e]) => e.id);
  if (stale.length) fail((await supabase.from('transactions').delete().in('id', stale)).error);
  return added;
}
