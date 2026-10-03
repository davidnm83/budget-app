// Card payment plans on the Credit cards page: the list with progress, a plan's details and
// schedule, and the form to add one (from a purchase, or one that already started).
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, categoryIcon, formatMoney, monthsAfter, parseMoney, planProgress, planSchedule, shortDate, toIsoDate } from '@budget-app/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { SinglePicker } from '@/components/Picker';
import { Bar, Button, Card, Chip, Segmented } from '@/components/ui';
import { closePlan, createPlan, deletePlan, updatePlan, type CardPlan, type PlanInput } from '@/lib/paymentPlans';
import { today } from '@/lib/plan';
import { afterClose } from '@/lib/useBackToClose';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import type { Account } from '@/lib/types';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
/** What a new plan starts from: a purchase in the app, or nothing (a plan entered by hand). */
export type PlanSeed = Partial<PlanInput> & { purchaseDate?: string };

/** The list on the Credit cards page. */
export function PlansCard({ t, plans, accounts, onChanged }: { t: Theme; plans: CardPlan[]; accounts: Account[]; onChanged: () => void }) {
  const [form, setForm] = useState<{ plan?: CardPlan; seed?: PlanSeed } | null>(null);
  const [open, setOpen] = useState<CardPlan | null>(null);
  const [showDone, setShowDone] = useState(false);
  const now = today();
  const rows = plans.map((p) => ({ p, g: planProgress(p, now) }));
  const active = rows.filter((r) => !r.g.finished), finished = rows.filter((r) => r.g.finished);
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '';
  const cards = accounts.filter((a) => a.type === 'credit');
  const monthly = active.reduce((s, r) => s + r.g.monthly, 0), left = active.reduce((s, r) => s + r.g.left, 0);
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.between}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>PAYMENT PLANS</Text>
        {cards.length > 0 && <Pressable onPress={() => setForm({})} hitSlop={8} accessibilityLabel="Add a payment plan"><Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>Add a plan</Text></Pressable>}
      </View>
      {!plans.length && <Text style={{ color: t.muted, fontSize: 13 }}>A purchase you’re paying off in monthly instalments on a card. Add one here (including plans that already started), or from the purchase itself: open the transaction and choose “Put on a payment plan”.</Text>}
      {active.length > 0 && <Text style={{ color: t.text }}>{money0(monthly)} a month across {active.length} plan{active.length === 1 ? '' : 's'} · {money0(left)} still to come</Text>}
      {(showDone ? rows : active).map(({ p, g }) => (
        <Pressable key={p.id} onPress={() => setOpen(p)} style={({ pressed, hovered }: any) => [{ gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { opacity: 0.75 }]}>
          <View style={styles.between}>
            <Text style={{ color: t.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{p.description}</Text>
            <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(g.paid)} <Text style={{ color: t.muted }}>of {formatMoney(p.principal)}</Text></Text>
          </View>
          <Bar value={g.paid} max={p.principal} color={t.accent} height={6} />
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {name(p.accountId)} · {g.finished ? `finished ${shortDate(g.endDate)}` : `${g.done} of ${g.count} · ${formatMoney(g.monthly)} a month · next ${shortDate(g.next!.date)} · ends ${shortDate(g.endDate)}`}
          </Text>
        </Pressable>
      ))}
      {finished.length > 0 && <Pressable onPress={() => setShowDone(!showDone)} hitSlop={6}><Text style={{ color: t.accent, fontSize: 12 }}>{showDone ? 'Hide' : 'Show'} {finished.length} finished</Text></Pressable>}
      {form && <PlanForm plan={form.plan} seed={form.seed} accounts={accounts} onClose={() => setForm(null)} onSaved={onChanged} />}
      {open && <PlanDetail t={t} plan={open} accounts={accounts} onClose={() => setOpen(null)} onChanged={onChanged} onEdit={() => { const p = open; setOpen(null); afterClose(() => setForm({ plan: p })); }} />}
    </Card>
  );
}

function PlanDetail({ t, plan, accounts, onClose, onChanged, onEdit }: { t: Theme; plan: CardPlan; accounts: Account[]; onClose: () => void; onChanged: () => void; onEdit: () => void }) {
  const [confirm, confirmSheet] = useConfirm();
  const [busy, setBusy] = useState(false);
  const now = today();
  const s = planSchedule(plan), g = planProgress(plan, now);
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '';
  const run = async (fn: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try { await fn(); toast(said); onChanged(); onClose(); } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); } finally { setBusy(false); }
  };
  return (
    <Sheet title={plan.description} onClose={onClose}>
      <Text style={{ color: t.muted }}>
        {formatMoney(plan.principal)} on {name(plan.accountId)}, {plan.months} months{plan.apr ? ` at ${plan.apr}%` : ', no interest'}{plan.monthlyFee ? `, ${formatMoney(plan.monthlyFee)} fee a month` : ''}{plan.setupFee ? `, ${formatMoney(plan.setupFee)} one-time fee` : ''}.{!plan.transactionId ? ' Against the card’s balance.' : ''}
        {plan.payingAccountId ? ` Paid from ${name(plan.payingAccountId)}.` : ''}
      </Text>
      <Text style={{ color: t.text }}>
        {g.finished ? 'Finished.' : `${formatMoney(g.left)} still to come${g.costLeft ? `, plus ${formatMoney(g.costLeft)} in ${plan.monthlyFee ? 'fees and interest' : 'interest'}` : ''}.`} Fees and interest so far: {formatMoney(g.costPaid)}.
      </Text>
      <View>
        {s.map((x) => {
          const past = x.date <= now, skipped = !!plan.countFrom && x.date < plan.countFrom;
          return (
            <View key={x.n} style={[styles.between, { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }]}>
              <Ionicons name={past ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={past ? t.accent : t.muted} />
              <Text style={{ color: past ? t.text : t.muted, flex: 1 }}>{shortDate(x.date)}{skipped ? ' · recorded by you' : ''}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{x.interest + x.fee + x.monthlyFee > 0 ? `${formatMoney(x.principal)} + ${formatMoney(x.interest + x.fee + x.monthlyFee)}` : ''}</Text>
              <Text style={{ color: past ? t.text : t.muted, fontVariant: ['tabular-nums'], minWidth: 76, textAlign: 'right' }}>{formatMoney(x.total)}</Text>
            </View>
          );
        })}
      </View>
      <Button title="Edit" kind="plain" onPress={onEdit} disabled={busy} />
      {!g.finished && <Button title="Paid off early (today)" kind="plain" disabled={busy} onPress={() => confirm({ title: 'Mark as paid off?', message: `The ${formatMoney(g.left)} left counts as one last instalment today, and the plan ends.`, action: 'Paid off', run: () => run(() => closePlan(plan), 'Plan paid off') })} />}
      <Button title="Delete plan" kind="danger" disabled={busy} onPress={() => confirm({ title: 'Delete this plan?', message: `The instalments it added are removed${plan.transactionId ? ', and the purchase goes back to counting as spending in the month it was made' : ''}.`, action: 'Delete', run: () => run(() => deletePlan(plan), 'Plan deleted') })} />
      {confirmSheet}
    </Sheet>
  );
}

/** Add or edit a plan. `seed` fills it in from a purchase. */
export function PlanForm({ plan, seed, accounts, onClose, onSaved }: { plan?: CardPlan; seed?: PlanSeed; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const from = plan ?? seed ?? {};
  const now = today();
  const cards = accounts.filter((a) => a.type === 'credit'), cash = accounts.filter((a) => a.type === 'depository');
  const [description, setDescription] = useState(from.description ?? '');
  const [accountId, setAccountId] = useState<string | null>(from.accountId ?? (cards.length === 1 ? cards[0].id : null));
  const [amount, setAmount] = useState(from.principal ? String(from.principal) : '');
  const [start, setStart] = useState(from.startDate ?? monthsAfter(seed?.purchaseDate ?? now, 1));
  const [months, setMonths] = useState(String(from.months ?? 12));
  const [fee, setFee] = useState(from.setupFee ? String(from.setupFee) : '');
  const [apr, setApr] = useState(from.apr ? String(from.apr) : '');
  const [monthlyFee, setMonthlyFee] = useState(from.monthlyFee ? String(from.monthlyFee) : '');
  // What the plan is for: one purchase in the app, or an amount of the card's balance.
  const [mode, setMode] = useState<'purchase' | 'balance'>(plan ? (plan.transactionId ? 'purchase' : 'balance') : seed?.transactionId ? 'purchase' : 'balance');
  const [offset, setOffset] = useState(plan ? plan.offsetStart : true);
  const offsetTouched = useRef(!!plan); // once you set the switch yourself, picking a category leaves it alone
  const [categoryId, setCategoryId] = useState<string | null>(from.categoryId ?? null);
  const [costCat, setCostCat] = useState<string | null>(from.interestCategoryId ?? null);
  const [payFrom, setPayFrom] = useState<string | null>(from.payingAccountId ?? null);
  const [post, setPost] = useState(from.postCharges ?? true);
  const [postFee, setPostFee] = useState(from.postFee ?? true);
  const [txnId, setTxnId] = useState<string | null>(from.transactionId ?? null);
  const [past, setPast] = useState<'add' | 'skip'>(plan?.countFrom ? 'skip' : 'add');
  const [cats, setCats] = useState<{ id: string; name: string; group_name: string; kind: string; icon: string | null }[]>([]);
  const [found, setFound] = useState<{ id: string; date: string; amount: number; display_name: string }[]>([]);
  const [pick, setPick] = useState<'cat' | 'cost' | 'txn' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = useChanged([description, accountId, amount, start, months, fee, apr, monthlyFee, mode, offset, categoryId, payFrom, post, postFee, txnId, past]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];

  useEffect(() => {
    supabase.from('categories').select('id, name, group_name, kind, icon').eq('is_hidden', false).order('group_name').order('name').then(({ data }) => {
      const list = (data ?? []) as typeof cats;
      setCats(list);
      // Fee and interest usually belong with card interest; start on a category that sounds like it.
      setCostCat((c) => c ?? list.find((x) => x.kind === 'expense' && /interest/i.test(x.name))?.id ?? list.find((x) => x.kind === 'expense' && /fee/i.test(x.name))?.id ?? null);
    });
  }, []);
  const p = parseMoney(amount), n = Math.round(Number(months)), f = fee.trim() ? parseMoney(fee) : 0, r = apr.trim() ? Number(apr) : 0, mf = monthlyFee.trim() ? parseMoney(monthlyFee) : 0, d = toIsoDate(start);
  const good = !isNaN(p) && p > 0 && n >= 1 && n <= 120 && !isNaN(f) && f >= 0 && !isNaN(r) && r >= 0 && !isNaN(mf) && mf >= 0 && !!d;
  const draft = useMemo(() => (good ? { id: 'draft', description, principal: Math.abs(p), months: n, startDate: d as string, setupFee: f, apr: r, monthlyFee: mf } : null), [good, description, p, n, d, f, r, mf]);
  const schedule = draft ? planSchedule(draft) : [];
  const interest = schedule.reduce((s, x) => s + x.interest, 0), monthlyFees = schedule.reduce((s, x) => s + x.monthlyFee, 0);
  const started = !!d && d <= now; // some instalments are already in the past
  const pastCount = schedule.filter((x) => x.date <= now).length;

  // Purchases on this card for this amount, to link the plan to (when it wasn't started from one).
  useEffect(() => {
    if (mode !== 'purchase' || !accountId || isNaN(p) || p <= 0) { setFound([]); return; }
    supabase.from('transaction_list').select('id, date, amount, display_name').eq('account_id', accountId).gte('amount', -Math.abs(p) - 0.005).lte('amount', -Math.abs(p) + 0.005)
      .order('date', { ascending: false }).limit(20).then(({ data }) => setFound((data ?? []).map((x: any) => ({ ...x, amount: Number(x.amount) }))));
  }, [accountId, amount, mode]);
  const linked = found.find((x) => x.id === txnId);

  const save = async () => {
    if (!description.trim()) { setError('Give it a name, e.g. what you bought.'); return; }
    if (!accountId) { setError('Choose the card.'); return; }
    if (!draft) { setError('Check the amount, months, fees, interest and date.'); return; }
    if (mode === 'balance' && !categoryId) { setError('Choose the budget category the instalments count under.'); return; }
    setBusy(true); setError('');
    const input: PlanInput = { ...draft, description: description.trim(), accountId, transactionId: mode === 'purchase' ? txnId : null, offsetStart: mode === 'balance' && offset && chosen?.kind !== 'transfer', categoryId, interestCategoryId: costCat, payingAccountId: payFrom,
      postCharges: post, postFee, countFrom: started && past === 'skip' ? (plan?.countFrom ?? addDays(now, 1)) : null, closedOn: plan?.closedOn ?? null };
    try { if (plan) await updatePlan(plan, input); else await createPlan(input); toast(plan ? 'Plan saved' : 'Plan added'); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const catLabel = (id: string | null) => { const c = cats.find((x) => x.id === id); return c ? `${categoryIcon(c.name, c.icon)}  ${c.name}` : ''; };
  const row = (label: string, value: string, empty: string, onPress: () => void) => (
    <Field t={t} label={label}>
      <Pressable onPress={onPress} style={[styles.input, styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
        <Text style={{ color: value ? t.text : t.muted, flex: 1 }} numberOfLines={1}>{value || empty}</Text>
        <Ionicons name="chevron-down" size={16} color={t.muted} />
      </Pressable>
    </Field>
  );
  const spendCats = cats.filter((c) => c.kind === 'expense').map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }));
  // A plan against the balance can also sit under a transfer category (it then never counts as spending, only tracks the debt).
  const planCats = mode === 'balance' ? cats.filter((c) => c.kind !== 'income').map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name })) : spendCats;
  const chosen = cats.find((c) => c.id === categoryId);
  const pickCategory = (id: string) => {
    setCategoryId(id);
    // A debt-payment category is a budget line for paying the card down: each instalment should simply count there,
    // with nothing taken back out at the start. Any other category starts with the switch on.
    const c = cats.find((x) => x.id === id);
    if (mode === 'balance' && c && !offsetTouched.current) setOffset(!/debt|loan|payment/i.test(c.name));
  };

  return (
    <Sheet title={plan ? 'Edit payment plan' : 'Payment plan'} dirty={changed && !busy} onClose={() => { if (!busy) onClose(); }} footer={<Button title={plan ? 'Save' : 'Add plan'} onPress={save} busy={busy} />}>
      <Field t={t} label="What it’s for"><TextInput value={description} onChangeText={setDescription} placeholder="e.g. Laptop" placeholderTextColor={t.muted} style={input} /></Field>
      <Field t={t} label="Card"><View style={styles.chips}>{cards.map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => setAccountId(a.id)} />)}</View></Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Amount on the plan"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={input} accessibilityLabel="Amount on the plan" /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Months"><TextInput value={months} onChangeText={setMonths} keyboardType="number-pad" style={input} accessibilityLabel="Months" /></Field></View>
      </View>
      <Field t={t} label="First instalment" hint="The date the first one is billed. A date in the past is fine for a plan that already started."><DateField value={start} onChange={setStart} /></Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="One-time fee"><TextInput value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} accessibilityLabel="One-time fee" /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Interest (% a year)"><TextInput value={apr} onChangeText={setApr} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} accessibilityLabel="Interest percent a year" /></Field></View>
      </View>
      <Field t={t} label="Fixed monthly fee" hint="For cards that charge the same fee every month, with or instead of interest. If yours is a percentage of the amount, enter what that comes to in dollars.">
        <TextInput value={monthlyFee} onChangeText={setMonthlyFee} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} accessibilityLabel="Fixed monthly fee" />
      </Field>
      {draft && (
        <Text style={{ color: t.text }}>
          {n} payment{n === 1 ? '' : 's'} of {formatMoney(planProgress(draft, now).monthly)}, ending {shortDate(schedule[schedule.length - 1].date)}.
          {interest + f + monthlyFees > 0 ? ` Costs ${formatMoney(interest + f + monthlyFees)} in all (${[f ? `${formatMoney(f)} one-time fee` : '', monthlyFees ? `${formatMoney(monthlyFees)} in monthly fees` : '', interest ? `${formatMoney(interest)} interest` : ''].filter(Boolean).join(' + ')}).` : ' No fees or interest.'}
        </Text>
      )}
      {row('Budget category', catLabel(categoryId), 'Choose (what the purchase was for)', () => setPick('cat'))}
      {(f > 0 || r > 0 || mf > 0) && (
        <>
          {row('Category for the fee and interest', catLabel(costCat), 'Choose', () => setPick('cost'))}
          {f > 0 && (
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>Add the one-time fee as a transaction</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>Turn off if the fee shows on your statement when the plan starts (many cards do this), so it isn’t counted twice. It still counts in the plan’s cost.</Text>
              </View>
              <Switch value={postFee} onValueChange={setPostFee} accessibilityLabel="Add the one-time fee as a transaction" />
            </View>
          )}
          {(r > 0 || mf > 0) && (
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>Add the {r > 0 && mf > 0 ? 'interest and monthly fee' : mf > 0 ? 'monthly fee' : 'interest'} as transactions</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>Turn off if your statement lists {r > 0 && mf > 0 ? 'them' : 'it'} each month.</Text>
              </View>
              <Switch value={post} onValueChange={setPost} accessibilityLabel="Add the monthly charges as transactions" />
            </View>
          )}
        </>
      )}
      {cash.length > 0 && (
        <Field t={t} label="Paid from" hint="The account you pay this card from. Shown with the plan in the planner.">
          <View style={styles.chips}>{cash.map((a) => <Chip key={a.id} label={a.name} on={payFrom === a.id} onPress={() => setPayFrom(payFrom === a.id ? null : a.id)} />)}</View>
        </Field>
      )}
      <Field t={t} label="What’s on the plan">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'purchase', label: 'A purchase' }, { value: 'balance', label: 'Part of the balance' }]} />
      </Field>
      {mode === 'purchase' ? (
        <>
      <Field t={t} label="The purchase" hint={txnId ? 'It stops counting as spending in the month it was made; the instalments count instead.' : 'Not linked. If the purchase is in the app, link it; otherwise make sure it is categorized as a transfer so it isn’t counted twice.'}>
        <Pressable onPress={() => found.length && setPick('txn')} style={[styles.input, styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
          <Text style={{ color: txnId ? t.text : t.muted, flex: 1 }} numberOfLines={1}>
            {linked ? `${shortDate(linked.date)} · ${linked.display_name} · ${formatMoney(linked.amount)}` : txnId ? 'Linked' : found.length ? `${found.length} on this card for this amount · choose` : 'None found on this card for this amount'}
          </Text>
          {found.length > 0 && <Ionicons name="chevron-down" size={16} color={t.muted} />}
        </Pressable>
      </Field>
        </>
      ) : chosen?.kind === 'transfer' ? (
        <Text style={{ color: t.muted, fontSize: 13 }}>{chosen.name} is a transfer category, so this plan never counts as spending: it tracks what’s left, and the card’s statement amount. Only the fees and interest count, under their own category.</Text>
      ) : (
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text }}>Take this amount out of {catLabel(categoryId) || 'the category'} when the plan starts</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>It was already counted as spending when it was charged to the card. On: it comes out once on the first instalment date and the instalments put it back month by month, so nothing is counted twice. Off: the instalments are simply added.</Text>
          </View>
          <Switch value={offset} onValueChange={(v) => { offsetTouched.current = true; setOffset(v); }} accessibilityLabel="Take this amount out of the category when the plan starts" />
        </View>
      )}
      {started && pastCount > 0 && (
        <Field t={t} label={`The ${pastCount} instalment${pastCount === 1 ? '' : 's'} already past`} hint={past === 'add' ? 'Each one is added to the budget of its month.' : 'They show as paid in the plan, but nothing is added to past months. Use this if you already recorded them yourself.'}>
          <Segmented value={past} onChange={setPast} options={[{ value: 'add', label: 'Add to past months' }, { value: 'skip', label: 'Already recorded' }]} />
        </Field>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <SinglePicker visible={pick === 'cat'} title="Category" selected={categoryId} onClose={() => setPick(null)} items={planCats} onPick={(id) => { pickCategory(id); setPick(null); }} />
      <SinglePicker visible={pick === 'cost'} title="Category" selected={costCat} onClose={() => setPick(null)} items={spendCats} onPick={(id) => { setCostCat(id); setPick(null); }} />
      <SinglePicker visible={pick === 'txn'} title="Purchase" placeholder="Search purchases" selected={txnId ?? 'none'} onClose={() => setPick(null)}
        items={[{ id: 'none', label: 'Not linked' }, ...found.map((x) => ({ id: x.id, label: `${shortDate(x.date)} · ${x.display_name}`, detail: formatMoney(x.amount) }))]}
        onPick={(id) => { setTxnId(id === 'none' ? null : id); setPick(null); }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
