// Pop-up forms for a recurring bill/income and for a one-off planned entry.
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, categoryIcon, formatMoney, parseMoney, round2, shortDate, toIsoDate, type Frequency, type Recurring } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateField } from './DateField';
import { ModalFrame } from '@/components/ModalFrame';
import { MultiPicker } from '@/components/Picker';
import { Button, Chip, Segmented } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useBackToClose } from '@/lib/useBackToClose';
import { useTheme, type Theme } from '@/lib/theme';
import type { Account } from '@/lib/types';

export function Sheet({ title, onClose, children, footer, scroll = true }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  useBackToClose(true, onClose);
  return (
    <ModalFrame onClose={onClose} fit={scroll}>
      <>
        <View style={[styles.head, { borderColor: t.line }]}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Ionicons name="close" size={26} color={t.text} /></Pressable>
        </View>
        {scroll ? <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>}
        {footer ? <View style={[styles.footer, { borderColor: t.line, paddingBottom: insets.bottom + 12 }]}>{footer}</View> : null}
      </>
    </ModalFrame>
  );
}

export const Field = ({ t, label, children, hint }: { t: Theme; label: string; children: React.ReactNode; hint?: string }) => (
  <View style={{ gap: 6 }}>
    <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    {children}
    {hint ? <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text> : null}
  </View>
);

const FREQ: { key: Frequency; label: string }[] = [
  { key: 'weekly', label: 'Weekly' }, { key: 'biweekly', label: 'Every 2 weeks' }, { key: 'monthly', label: 'Monthly' }, { key: 'yearly', label: 'Yearly' },
];

/** Add or edit a recurring bill or income (BIL-1, 8, 9). `initial` without an id = new (e.g. a suggestion). */
export function BillForm({ initial, accounts, categories, onClose, onSaved }: {
  initial: Partial<Recurring>; accounts: Account[]; categories: { id: string; name: string; group_name: string; icon?: string | null }[];
  onClose: () => void; onSaved: () => void;
}) {
  const t = useTheme();
  const [kind, setKind] = useState<'bill' | 'income'>(initial.kind ?? 'bill');
  const [name, setName] = useState(initial.name ?? '');
  const [amount, setAmount] = useState(initial.amount != null ? String(Math.abs(initial.amount)) : '');
  const [estimated, setEstimated] = useState(!!initial.estimated);
  const [frequency, setFrequency] = useState<Frequency | 'once'>(initial.frequency ?? 'monthly');
  const once = frequency === 'once';
  const [start, setStart] = useState(initial.start_date ?? '');
  const [end, setEnd] = useState(initial.end_date ?? '');
  const [accountId, setAccountId] = useState<string | null>(initial.account_id ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(initial.category_id ?? null);
  const [matchText, setMatchText] = useState(initial.match_text ?? '');
  const [cardId, setCardId] = useState<string | null>((initial as any).card_account_id ?? null);
  const [cardRule, setCardRule] = useState<'statement' | 'minimum' | 'custom'>((initial as any).card_rule ?? 'statement');
  const [pickCat, setPickCat] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];

  const save = async () => {
    const card = kind === 'bill' && cardId;
    const a = card && cardRule !== 'custom' ? 0 : parseMoney(amount);
    const s = toIsoDate(start), e = end.trim() ? toIsoDate(end) : null;
    if (!name.trim() || isNaN(a) || !s || e === '') { setError('Fill in a name, an amount and a first due date.'); return; }
    if (once) {
      // A one-off goes straight into the plan (PLN-3) rather than the bills list.
      if (!accountId) { setError(`Pick the account it ${kind === 'bill' ? 'comes out of' : 'goes into'}, so it shows in that week's plan.`); return; }
      setBusy(true);
      const { error } = await supabase.from('plan_entries').insert({
        description: name.trim(), amount: round2(kind === 'bill' ? -Math.abs(a) : Math.abs(a)), date: s, account_id: accountId, category_id: categoryId,
      });
      setBusy(false);
      if (error) setError(error.message); else { onSaved(); onClose(); }
      return;
    }
    setBusy(true);
    const row = {
      name: name.trim(), kind, amount: round2(kind === 'bill' ? -Math.abs(a) : Math.abs(a)), estimated, frequency: frequency as Frequency,
      start_date: s, end_date: e, account_id: accountId, category_id: categoryId, match_text: matchText.trim() || null, active: true,
      card_account_id: card ? cardId : null, card_rule: card ? cardRule : null,
    };
    const { error } = initial.id ? await supabase.from('recurring').update(row).eq('id', initial.id) : await supabase.from('recurring').insert(row);
    setBusy(false);
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };
  const remove = async () => {
    if (!initial.id) return;
    const { error } = await supabase.from('recurring').delete().eq('id', initial.id);
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };

  return (
    <Sheet title={initial.id ? 'Edit' : kind === 'bill' ? 'New bill' : 'New income'} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {initial.id ? <Button title="Delete" kind="danger" onPress={remove} /> : null}
        <Button title="Save" onPress={save} busy={busy} style={{ flex: 1 }} />
      </View>}>
      <Segmented value={kind} onChange={setKind} options={[{ value: 'bill', label: 'Bill' }, { value: 'income', label: 'Income' }]} />
      <Field t={t} label="Name"><TextInput value={name} onChangeText={setName} placeholder="e.g. Phone bill" placeholderTextColor={t.muted} style={input} /></Field>
      {kind === 'bill' && accounts.some((a) => a.type === 'credit') && (
        <Field t={t} label="Credit card payment?" hint={cardId ? 'The amount follows the card: its statement (set the closing and due days on the card’s Details), an estimated minimum, or a fixed amount.' : undefined}>
          <View style={styles.chips}>
            <Chip label="No" on={!cardId} onPress={() => setCardId(null)} />
            {accounts.filter((a) => a.type === 'credit').map((a) => (
              <Chip key={a.id} label={a.name} on={cardId === a.id} onPress={() => {
                setCardId(a.id);
                if (!name.trim()) setName(`${a.name} payment`);
                if (a.due_day && !initial.id) {
                  const d = new Date(); const next = new Date(Date.UTC(d.getFullYear(), d.getMonth() + (d.getDate() > a.due_day ? 1 : 0), a.due_day));
                  setStart(next.toISOString().slice(0, 10));
                }
              }} />
            ))}
          </View>
          {cardId && (
            <View style={styles.chips}>
              {([['statement', 'Statement balance'], ['minimum', 'Minimum (est.)'], ['custom', 'Fixed amount']] as const).map(([k, l]) => (
                <Chip key={k} label={l} on={cardRule === k} onPress={() => setCardRule(k)} />
              ))}
            </View>
          )}
        </Field>
      )}
      {!(kind === 'bill' && cardId && cardRule !== 'custom') && <Field t={t} label="Amount">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={[input, { flex: 1 }]} />
          {!once && <Text style={{ color: t.text }}>Varies</Text>}
          {!once && <Switch value={estimated} onValueChange={setEstimated} />}
        </View>
      </Field>}
      <Field t={t} label="How often">
        <View style={styles.chips}>
          {FREQ.map((f) => <Chip key={f.key} label={f.label} on={frequency === f.key} onPress={() => setFrequency(f.key)} />)}
          {!initial.id && <Chip label="Just once" on={once} onPress={() => setFrequency('once')} />}
        </View>
      </Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label={once ? 'Date' : 'Next / first due'} hint={once ? 'Shows in the planner that week' : 'Sets the day it repeats on'}><DateField value={start} onChange={setStart} /></Field></View>
        {!once && <View style={{ flex: 1 }}><Field t={t} label="Ends (optional)" hint="For instalment plans"><DateField value={end} onChange={setEnd} min={start || undefined} /></Field></View>}
      </View>
      <Field t={t} label={kind === 'bill' ? 'Paid from' : 'Paid into'}>
        <View style={styles.chips}>
          {accounts.map((a) => <Chip key={a.id} label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`} on={accountId === a.id} onPress={() => setAccountId(accountId === a.id ? null : a.id)} />)}
        </View>
      </Field>
      <Field t={t} label="Category">
        <Pressable onPress={() => setPickCat(true)} style={[styles.input, styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
          <Text style={{ color: categoryId ? t.text : t.muted, flex: 1 }}>{(() => { const c = categories.find((x) => x.id === categoryId); return c ? `${categoryIcon(c.name, c.icon)}  ${c.name}` : 'Choose'; })()}</Text>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
      </Field>
      {!once && <Field t={t} label="Matches transactions containing" hint="Text in the bank description, so the payment is recognised (e.g. ROGERS). Leave blank to match by amount and date.">
        <TextInput value={matchText} onChangeText={setMatchText} autoCapitalize="characters" placeholder="optional" placeholderTextColor={t.muted} style={input} />
      </Field>}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <MultiPicker visible={pickCat} title="Category" onClose={() => setPickCat(false)}
        items={categories.map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))}
        selected={categoryId ? [categoryId] : []} onChange={(ids) => { setCategoryId(ids[ids.length - 1] ?? null); setPickCat(false); }} />
    </Sheet>
  );
}

/** Add a one-off planned entry, or change one date of a recurring entry (PLN-3, PLN-8, PLN-9). */
export function PlanEntryForm({ initial, accounts, onClose, onSaved }: {
  initial: { id?: string | null; date: string; description: string; amount: number | null; account_id: string | null; to_account_id?: string | null;
    recurring_id?: string | null; occurrence_date?: string | null;
    matched?: { id: string; date: string; amount: number; name: string } | null; manualMatch?: boolean };
  accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const t = useTheme();
  const [dir, setDir] = useState<'out' | 'in' | 'transfer'>(initial.to_account_id ? 'transfer' : (initial.amount ?? -1) > 0 ? 'in' : 'out');
  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount] = useState(initial.amount != null ? String(Math.abs(initial.amount)) : '');
  const [date, setDate] = useState(initial.date);
  const [accountId, setAccountId] = useState<string | null>(initial.account_id);
  const [toId, setToId] = useState<string | null>(initial.to_account_id ?? null);
  const [error, setError] = useState('');
  const recurring = !!initial.recurring_id;
  const existing = !!(initial.id || recurring);
  const [pickMatch, setPickMatch] = useState(false);
  const [candidates, setCandidates] = useState<{ id: string; date: string; amount: number; display_name: string }[]>([]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  useEffect(() => { if (dir !== 'transfer') setToId(null); }, [dir]);
  // PLN-6: transactions near the date on the same account, to match this entry by hand.
  useEffect(() => {
    if (!pickMatch || !initial.account_id) return;
    supabase.from('transaction_list').select('id, date, amount, display_name').eq('account_id', initial.account_id)
      .gte('date', addDays(initial.date, -10)).lte('date', addDays(initial.date, 10)).order('date')
      .then(({ data }) => setCandidates((data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }))));
  }, [pickMatch]);
  const setMatch = async (txnId: string | null) => {
    const { error } = await upsert({ description: initial.description, amount: initial.amount ?? 0, date: initial.date, account_id: initial.account_id,
      to_account_id: initial.to_account_id ?? null, matched_transaction_id: txnId, skipped: false });
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };

  const upsert = async (patch: Record<string, unknown>) => {
    const row = { ...patch, ...(recurring ? { recurring_id: initial.recurring_id, occurrence_date: initial.occurrence_date } : {}) };
    return initial.id ? supabase.from('plan_entries').update(row).eq('id', initial.id)
      : recurring ? supabase.from('plan_entries').upsert(row, { onConflict: 'recurring_id,occurrence_date' })
      : supabase.from('plan_entries').insert(row);
  };
  const save = async () => {
    const a = parseMoney(amount), d = toIsoDate(date);
    if (!description.trim() || isNaN(a) || !d || !accountId) { setError('Fill in a description, amount, date and account.'); return; }
    const { error } = await upsert({ description: description.trim(), amount: dir === 'in' ? Math.abs(a) : -Math.abs(a), date: d, account_id: accountId,
      to_account_id: dir === 'transfer' ? toId : null, skipped: false });
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };
  const skip = async () => {
    const { error } = recurring
      ? await upsert({ description: initial.description, amount: initial.amount ?? 0, date: initial.date, account_id: initial.account_id, skipped: true })
      : await supabase.from('plan_entries').delete().eq('id', initial.id!);
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };
  const plan = accounts.filter((a) => a.plan_include);

  return (
    <Sheet title={recurring ? 'Change this date only' : initial.id ? 'Edit planned entry' : 'Plan an entry'} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {(initial.id || recurring) ? <Button title={recurring ? 'Skip this one' : 'Delete'} kind="danger" onPress={skip} /> : null}
        <Button title="Save" onPress={save} style={{ flex: 1 }} />
      </View>}>
      {recurring && <Text style={{ color: t.muted, fontSize: 13 }}>Changes here apply to {initial.occurrence_date} only. Edit the bill itself under Bills & income.</Text>}
      {!recurring && <Segmented value={dir} onChange={setDir} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }, { value: 'transfer', label: 'Transfer' }]} />}
      <Field t={t} label="Description"><TextInput value={description} onChangeText={setDescription} placeholder="e.g. Groceries" placeholderTextColor={t.muted} style={input} /></Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Amount"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field></View>
      </View>
      <Field t={t} label={dir === 'transfer' ? 'From' : 'Account'}>
        <View style={styles.chips}>{(plan.length ? plan : accounts).map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => setAccountId(a.id)} />)}</View>
      </Field>
      {dir === 'transfer' && (
        <Field t={t} label="To">
          <View style={styles.chips}>{accounts.filter((a) => a.id !== accountId).map((a) => <Chip key={a.id} label={a.name} on={toId === a.id} onPress={() => setToId(a.id)} />)}</View>
        </Field>
      )}
      {existing && (
        <Field t={t} label="Matched transaction">
          {initial.matched
            ? <Text style={{ color: t.text }}>{shortDate(initial.matched.date)} · {initial.matched.name} · {formatMoney(initial.matched.amount)}{initial.manualMatch ? ' (matched by you)' : ' (matched automatically)'}</Text>
            : <Text style={{ color: t.muted }}>Not matched yet. It matches on its own when a similar transaction posts within 3 days.</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={initial.matched ? 'Match a different one' : 'Match by hand'} kind="plain" onPress={() => setPickMatch(true)} style={{ flex: 1 }} />
            {initial.manualMatch && <Button title="Back to automatic" kind="plain" onPress={() => setMatch(null)} style={{ flex: 1 }} />}
          </View>
        </Field>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <MultiPicker visible={pickMatch} title="Transaction" onClose={() => setPickMatch(false)} selected={initial.matched ? [initial.matched.id] : []}
        items={candidates.map((c) => ({ id: c.id, label: `${shortDate(c.date)} · ${c.display_name}`, detail: formatMoney(c.amount) }))}
        onChange={(ids) => { setPickMatch(false); if (ids.length) setMatch(ids[ids.length - 1]); }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  pick: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
