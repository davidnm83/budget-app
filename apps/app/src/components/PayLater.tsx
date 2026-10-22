// Pay later (buy now, pay later): adding or changing a plan, and one plan's payments. See lib/payLater.ts for how a
// plan is kept in the books.
import Ionicons from '@expo/vector-icons/Ionicons';
import { categoryIcon, formatMoney, parseMoney, payLaterPrincipal, payLaterSchedule, shortDate, toIsoDate, type PayLaterStatus } from '@budget-app/core';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { SinglePicker } from '@/components/Picker';
import { Bar, Button, Chip, Segmented } from '@/components/ui';
import { deletePayLater, savePayLater, updatePayLater, type PayLaterInput, type PayLaterPlan } from '@/lib/payLater';
import { today } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import type { Account } from '@/lib/types';

const PROVIDERS = ['Affirm', 'Klarna', 'PayPal', 'Afterpay', 'Sezzle'];
const FREQ = [{ value: 'biweekly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }] as const;
const money0 = (n: number) => formatMoney(n);

export function PayLaterForm({ plan, accounts, onClose, onSaved }: { plan?: PayLaterPlan; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const now = today();
  const payers = accounts.filter((a) => a.type === 'depository' || a.type === 'credit');
  const [provider, setProvider] = useState(plan?.provider ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [total, setTotal] = useState(plan ? String(plan.total) : '');
  const [down, setDown] = useState(plan?.downPayment ? String(plan.downPayment) : '');
  const [payments, setPayments] = useState(String(plan?.payments ?? 4));
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>(plan?.frequency ?? 'biweekly');
  const [first, setFirst] = useState(plan?.firstDate ?? now);
  const [bought, setBought] = useState(plan?.purchaseDate ?? '');
  const [apr, setApr] = useState(plan?.apr ? String(plan.apr) : '');
  const [accountId, setAccountId] = useState<string | null>(plan?.accountId ?? payers.find((a) => a.plan_include)?.id ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(plan?.categoryId ?? null);
  const [matchText, setMatchText] = useState(plan?.matchText ?? '');
  const [cats, setCats] = useState<{ id: string; name: string; group_name: string; kind: string; icon: string | null }[]>([]);
  const [pickCat, setPickCat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = useChanged([provider, description, total, down, payments, frequency, first, bought, apr, accountId, categoryId, matchText]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  useEffect(() => { supabase.from('categories').select('id, name, group_name, kind, icon').eq('is_hidden', false).order('sort').then(({ data }) => setCats((data ?? []) as any)); }, []);

  const num = (s: string) => (s.trim() ? parseMoney(s) : 0);
  const draft = useMemo(() => {
    const tot = num(total), d = num(down), n = Math.round(Number(payments)), a = num(apr), f = toIsoDate(first);
    if (!(tot > 0) || isNaN(d) || d >= tot || !(n >= 1 && n <= 120) || isNaN(a) || a < 0 || !f) return null;
    return { total: tot, downPayment: d, payments: n, frequency, firstDate: f, apr: a };
  }, [total, down, payments, frequency, first, apr]);
  const schedule = draft ? payLaterSchedule(draft) : [];
  const interest = schedule.reduce((x, p) => x + p.interest, 0);

  const save = async () => {
    if (!provider.trim() || !description.trim()) { setError('Fill in who it’s with and what you bought.'); return; }
    if (!draft) { setError('Check the price, the number of payments and the first payment date.'); return; }
    if (!accountId) { setError('Choose the account or card the payments come from.'); return; }
    const p = toIsoDate(bought);
    const input: PayLaterInput = { ...draft, provider: provider.trim(), description: description.trim(), accountId, categoryId,
      matchText: matchText.trim() || provider.trim(), purchaseDate: p && p <= draft.firstDate ? p : null, notes: plan?.notes ?? null };
    setBusy(true); setError('');
    try { await savePayLater(input, plan?.id); toast(plan ? 'Plan saved' : 'Plan added'); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={plan ? 'Edit plan' : 'Pay later plan'} dirty={changed && !busy} onClose={() => { if (!busy) onClose(); }} footer={<Button title={plan ? 'Save' : 'Add plan'} onPress={save} busy={busy} />}>
      <Field t={t} label="With">
        <View style={styles.chips}>{PROVIDERS.map((p) => <Chip key={p} label={p} on={provider === p} onPress={() => { setProvider(p); if (!matchText.trim() || PROVIDERS.some((x) => x.toUpperCase() === matchText.trim())) setMatchText(p.toUpperCase()); }} />)}</View>
        <TextInput value={provider} onChangeText={setProvider} placeholder="or type another" placeholderTextColor={t.muted} style={[input, { marginTop: 6 }]} accessibilityLabel="Provider" />
      </Field>
      <Field t={t} label="What you bought"><TextInput value={description} onChangeText={setDescription} placeholder="e.g. Headphones" placeholderTextColor={t.muted} style={input} /></Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Price"><TextInput value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} accessibilityLabel="Price" /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Down payment" hint="Paid at checkout, if any."><TextInput value={down} onChangeText={setDown} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} accessibilityLabel="Down payment" /></Field></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Payments"><TextInput value={payments} onChangeText={setPayments} keyboardType="number-pad" style={input} accessibilityLabel="Number of payments" /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Interest (% a year)"><TextInput value={apr} onChangeText={setApr} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} accessibilityLabel="Interest percent a year" /></Field></View>
      </View>
      <Field t={t} label="How often"><Segmented value={frequency} onChange={(v) => setFrequency(v as any)} options={FREQ.map((f) => ({ value: f.value, label: f.label }))} /></Field>
      <Field t={t} label="First payment" hint="For Pay in 4, that's usually the day you bought it."><DateField value={first} onChange={setFirst} /></Field>
      {draft && (
        <Text style={{ color: t.text }}>
          {schedule.length} payment{schedule.length === 1 ? '' : 's'} of {money0(schedule[schedule.length > 1 ? 1 : 0].amount)}
          {Math.abs(schedule[0].amount - schedule[schedule.length > 1 ? 1 : 0].amount) >= 0.005 ? ` (the first ${money0(schedule[0].amount)})` : ''}
          {Math.abs(schedule[schedule.length - 1].amount - schedule[schedule.length > 1 ? 1 : 0].amount) >= 0.005 && schedule.length > 2 ? ` (the last ${money0(schedule[schedule.length - 1].amount)})` : ''}, the last on {shortDate(schedule[schedule.length - 1].date)}.
          {interest > 0 ? ` ${money0(interest)} in interest.` : ' No interest.'}
        </Text>
      )}
      <Field t={t} label="Payments come from">
        <View style={styles.chips}>{payers.map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => setAccountId(a.id)} />)}</View>
      </Field>
      <Field t={t} label="Budget category" hint="What you bought: each payment counts there in the month it's paid.">
        <Pressable onPress={() => setPickCat(true)} style={[styles.input, styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
          {(() => { const c = cats.find((x) => x.id === categoryId); return <Text style={{ color: c ? t.text : t.muted, flex: 1 }} numberOfLines={1}>{c ? `${categoryIcon(c.name, c.icon)}  ${c.name}` : 'Choose'}</Text>; })()}
          <Ionicons name="chevron-down" size={16} color={t.muted} />
        </Pressable>
      </Field>
      <Field t={t} label="Shows on your bank as" hint="Part of the payment's description, so the app can tell it's this plan's.">
        <TextInput value={matchText} onChangeText={setMatchText} placeholder={provider.toUpperCase() || 'e.g. AFFIRM'} placeholderTextColor={t.muted} style={input} autoCapitalize="characters" />
      </Field>
      <Field t={t} label="Bought on (optional)" hint="When it was a while before the first payment."><DateField value={bought} onChange={setBought} placeholder="Same as the first payment" /></Field>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <SinglePicker visible={pickCat} title="Category" selected={categoryId} onClose={() => setPickCat(false)}
        items={cats.filter((c) => c.kind === 'expense').map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))}
        onPick={(id) => { setCategoryId(id); setPickCat(false); }} />
    </Sheet>
  );
}

/** One plan: where it stands, each payment (matched, marked by hand, missed, to come), and what you can do with it. */
export function PayLaterSheet({ plan, status, accounts, onClose, onChanged, onEdit }: {
  plan: PayLaterPlan; status: PayLaterStatus; accounts: Account[]; onClose: () => void; onChanged: () => void; onEdit: () => void;
}) {
  const t = useTheme();
  const [confirm, confirmSheet] = useConfirm();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, msg: string, close = false) => {
    setBusy(true);
    try { await f(); toast(msg); onChanged(); if (close) onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const mark = (n: number, on: boolean) => run(() => updatePayLater(plan.id, { paidByHand: on ? [...plan.paidByHand, n] : plan.paidByHand.filter((x) => x !== n) }), on ? 'Marked paid' : 'Unmarked');
  const from = accounts.find((a) => a.id === plan.accountId);
  const s = status.schedule;
  const links = plan.paidWith ?? {};
  // Linking a payment by hand: money out of the plan's account within a few weeks of it, the nearest amount first.
  const [linking, setLinking] = useState<(typeof s)[number] | null>(null);
  const [found, setFound] = useState<{ id: string; date: string; amount: number; display_name: string; account_name: string | null }[]>([]);
  useEffect(() => {
    if (!linking) { setFound([]); return; }
    const away = (d: string, k: number) => new Date(Date.parse(d + 'T00:00:00Z') + k * 86_400_000).toISOString().slice(0, 10);
    let q = supabase.from('transaction_list').select('id, date, amount, display_name, account_name').lt('amount', 0).gte('date', away(linking.date, -21)).lte('date', away(linking.date, 21));
    if (plan.accountId) q = q.eq('account_id', plan.accountId);
    q.order('date').limit(200).then(({ data }) => {
      const want = linking.amount, days = (d: string) => Math.abs(Date.parse(d) - Date.parse(linking.date)) / 864e5;
      const others = new Set(s.filter((x) => x.n !== linking.n && x.txnId).map((x) => x.txnId));
      setFound(((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount) })).filter((r) => !others.has(r.id))
        .sort((a, b) => Math.abs(-a.amount - want) - Math.abs(-b.amount - want) || days(a.date) - days(b.date)).slice(0, 40));
    });
  }, [linking?.n]);
  const link = (n: number, id: string | null) => {
    const next = { ...links };
    if (id) next[String(n)] = id; else delete next[String(n)];
    const was = links[String(n)];
    return run(async () => {
      // A link taken away: the planner's bill stops showing that transaction as the payment too.
      if (was && was !== id && plan.recurringId) await supabase.from('plan_entries').update({ matched_transaction_id: null }).eq('recurring_id', plan.recurringId).eq('matched_transaction_id', was);
      await updatePayLater(plan.id, { paidWith: next, paidByHand: plan.paidByHand.filter((x) => x !== n) });
    }, id ? 'Payment linked' : 'Link removed');
  };
  return (
    <Sheet title={`${plan.provider} · ${plan.description}`} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}><Button title="Edit" kind="plain" onPress={onEdit} style={{ flex: 1 }} /><Button title="Done" onPress={onClose} style={{ flex: 1 }} /></View>}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{status.done ? (plan.closedOn ? 'Closed' : 'Paid off 🎉') : `${money0(status.owing)} owing`}</Text>
        <Bar value={status.paidCount} max={s.length} color={t.accent} height={8} />
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {status.paidCount} of {s.length} paid ({money0(status.paidAmount)}){status.interestPaid > 0 ? `, ${money0(status.interestPaid)} of it interest` : ''}
          {from ? ` · from ${from.name}` : ''}{plan.downPayment ? ` · ${money0(plan.downPayment)} down` : ''} · price {money0(plan.total)}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        {s.map((x) => {
          const byHand = plan.paidByHand.includes(x.n), byLink = !!links[String(x.n)];
          return (
            <View key={x.n} style={[styles.row, { borderColor: t.line }]}>
              <Ionicons name={x.paid ? 'checkmark-circle' : x.missed ? 'alert-circle' : 'time-outline'} size={20} color={x.paid ? t.positive : x.missed ? t.danger : t.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>{shortDate(x.date)} · payment {x.n}</Text>
                <Text style={{ color: x.missed ? t.danger : t.muted, fontSize: 12 }}>
                  {x.txnId ? (byLink ? 'paid (linked by you)' : 'paid (matched to the payment)') : byHand ? 'paid (marked by you)' : x.missed ? 'no payment found' : 'to come'}{x.interest > 0 ? ` · ${money0(x.interest)} interest` : ''}
                </Text>
              </View>
              <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{money0(x.amount)}</Text>
              {!byHand && !plan.closedOn && (
                <Pressable onPress={() => setLinking(x)} disabled={busy} hitSlop={8} accessibilityLabel={x.txnId ? `Change the payment linked to payment ${x.n}` : `Link a payment to payment ${x.n}`}>
                  <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>{x.txnId ? 'Change' : 'Link'}</Text>
                </Pressable>
              )}
              {!x.txnId && !plan.closedOn && (
                <Pressable onPress={() => mark(x.n, !byHand)} disabled={busy} hitSlop={8} accessibilityLabel={byHand ? 'Unmark paid' : 'Mark paid'}>
                  <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>{byHand ? 'Unmark' : 'Mark paid'}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Payments are found among {from ? `${from.name}'s` : 'the account’s'} transactions by amount and “{plan.matchText || plan.provider}” in the description, and filed under the plan's category. Link one the app didn't find, or mark it paid if it came out some other way.
      </Text>
      <SinglePicker visible={!!linking} title={linking ? `Payment ${linking.n} · ${money0(linking.amount)} · ${shortDate(linking.date)}` : ''} selected={linking ? links[String(linking.n)] ?? linking.txnId ?? 'none' : 'none'}
        onClose={() => setLinking(null)}
        items={[...(linking && links[String(linking.n)] ? [{ id: 'none', label: 'Not linked (let the app find it)' }] : []), ...found.map((x) => {
          const off = Math.round((-x.amount - (linking?.amount ?? 0)) * 100) / 100;
          return { id: x.id, label: `${shortDate(x.date)} · ${x.display_name}`, detail: formatMoney(x.amount),
            sub: [x.account_name ?? '', Math.abs(off) < 0.005 ? 'same amount' : `${formatMoney(Math.abs(off))} ${off > 0 ? 'more' : 'less'}`].filter(Boolean).join(' · ') };
        })]}
        onPick={(id) => { const n = linking!.n; setLinking(null); link(n, id === 'none' ? null : id); }} />
      {!status.done && <Button title="Paid off early or cancelled (today)" kind="plain" disabled={busy} onPress={() => confirm({ title: 'Close this plan?', message: `What's left (${money0(status.owing)}) is taken off what you owe, and no more payments are planned.`, action: 'Close plan', run: () => run(() => updatePayLater(plan.id, { closedOn: today() }), 'Plan closed') })} />}
      {plan.closedOn && <Button title="Open the plan again" kind="plain" disabled={busy} onPress={() => run(() => updatePayLater(plan.id, { closedOn: null }), 'Plan open again')} />}
      <Button title="Delete plan" kind="danger" disabled={busy} onPress={() => confirm({ title: 'Delete this plan?', message: 'Its bill and what it added to the Pay later account are removed. Payments already filed under its category stay where they are.', action: 'Delete', run: () => run(() => deletePayLater(plan), 'Plan deleted', true) })} />
      {confirmSheet}
    </Sheet>
  );
}

/** A plan in the list: what it is, how far along, the next payment. */
export function PayLaterRow({ t, plan, status, onPress }: { t: Theme; plan: PayLaterPlan; status: PayLaterStatus; onPress: () => void }) {
  const s = status.schedule;
  const missed = s.filter((x) => x.missed).length;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ gap: 6, paddingVertical: 10, opacity: pressed ? 0.7 : 1 }]} accessibilityRole="button">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{plan.description}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{plan.provider} · {status.paidCount} of {s.length} paid</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{status.done ? (plan.closedOn ? 'Closed' : 'Paid off') : money0(status.owing)}</Text>
          {status.next && <Text style={{ color: missed ? t.danger : t.muted, fontSize: 12 }}>{missed ? `${missed} missed` : `next ${money0(status.next.amount)} · ${shortDate(status.next.date)}`}</Text>}
        </View>
      </View>
      <Bar value={status.paidCount} max={s.length} color={missed ? t.danger : t.accent} height={6} />
    </Pressable>
  );
}

/** What's owed on every plan, and the payments coming in the next 30 days. */
export function payLaterTotals(rows: { plan: PayLaterPlan; status: PayLaterStatus }[], now: string) {
  const soon = new Date(Date.parse(now) + 30 * 86_400_000).toISOString().slice(0, 10);
  const open = rows.filter((r) => !r.status.done);
  const upcoming = open.flatMap((r) => r.status.schedule.filter((x) => !x.paid && x.date <= soon).map((x) => ({ ...x, plan: r.plan }))).sort((a, b) => a.date.localeCompare(b.date));
  return {
    owing: open.reduce((x, r) => x + r.status.owing, 0), open: open.length,
    next: upcoming[0] ?? null, next30: upcoming.reduce((x, p) => x + p.amount, 0), missed: open.reduce((x, r) => x + r.status.schedule.filter((p) => p.missed).length, 0),
    principal: open.reduce((x, r) => x + payLaterPrincipal(r.plan), 0),
  };
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  pick: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});

