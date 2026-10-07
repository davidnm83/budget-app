// Adding by hand: an account the bank connection can't reach (no CSV either), and a transaction on any
// account. A transaction added to a connected account is linked to the bank's own copy when that arrives
// (the sync matches it by amount and date), so nothing is counted twice.
import { categoryIcon, parseMoney, round2, toIsoDate } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { SinglePicker } from '@/components/Picker';
import { SuggestInput } from '@/components/SuggestInput';
import { Button, Chip, Segmented } from '@/components/ui';
import { forgetKnown, knownMerchants } from '@/lib/known';
import { today } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import type { Account, Category } from '@/lib/types';

const TYPES = [
  { label: 'Chequing', type: 'depository', subtype: 'checking' },
  { label: 'Savings', type: 'depository', subtype: 'savings' },
  { label: 'Credit card', type: 'credit', subtype: 'credit card' },
  { label: 'Line of credit', type: 'credit', subtype: 'line of credit' },
  { label: 'Loan', type: 'loan', subtype: 'loan' },
  { label: 'Investment', type: 'investment', subtype: 'brokerage' },
  { label: 'Cash', type: 'depository', subtype: 'cash' },
];

/** A manual account: its balance today, then each transaction added keeps it current. */
export function NewAccountForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [kind, setKind] = useState(TYPES[0]);
  const [balance, setBalance] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useChanged([name, kind, balance, limit]);
  const owed = kind.type === 'credit' || kind.type === 'loan';
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const save = async () => {
    const b = balance.trim() ? parseMoney(balance) : 0, l = limit.trim() ? parseMoney(limit) : null;
    if (!name.trim()) { setError('Give it a name.'); return; }
    if (isNaN(b) || (l != null && isNaN(l))) { setError('Check the amounts.'); return; }
    setBusy(true); setError('');
    const { data, error } = await supabase.from('accounts').insert({
      name: name.trim(), kind: 'manual', type: kind.type, subtype: kind.subtype, start_balance: 0, csv_reminder: false,
      ...(kind.type === 'credit' && l != null ? { credit_limit: Math.abs(l) } : {}),
      ...(kind.type === 'depository' && kind.subtype === 'checking' ? { plan_include: true } : {}),
    }).select('id').single();
    if (error) { setBusy(false); setError(error.message); return; }
    const set = await supabase.rpc('set_balance_today', { p_account: data.id, p_balance: owed ? -Math.abs(b) : b });
    setBusy(false);
    if (set.error) { setError(set.error.message); return; }
    toast('Account added');
    onSaved(data.id); onClose();
  };
  return (
    <Sheet title="Add an account" dirty={dirty} onClose={onClose} footer={<Button title="Add" onPress={save} busy={busy} />}>
      <Text style={{ color: t.muted, fontSize: 13 }}>For an account your bank connection can’t reach. Add its transactions by hand (or from a CSV file); they keep the balance current.</Text>
      <Field t={t} label="Name"><TextInput value={name} onChangeText={setName} placeholder="e.g. Amazon Mastercard" placeholderTextColor={t.muted} style={input} autoFocus /></Field>
      <Field t={t} label="Type">
        <View style={styles.chips}>{TYPES.map((x) => <Chip key={x.label} label={x.label} on={x === kind} onPress={() => setKind(x)} />)}</View>
      </Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field t={t} label={owed ? 'Amount owing today' : 'Balance today'}>
            <TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} accessibilityLabel={owed ? 'Amount owing today' : 'Balance today'} />
          </Field>
        </View>
        {kind.type === 'credit' && (
          <View style={{ flex: 1 }}>
            <Field t={t} label="Credit limit">
              <TextInput value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="e.g. 2000" placeholderTextColor={t.muted} style={input} accessibilityLabel="Credit limit" />
            </Field>
          </View>
        )}
      </View>
      {kind.type === 'credit' && <Text style={{ color: t.muted, fontSize: 12 }}>The statement and due days, interest rate and minimum payment are set on the account once it’s added.</Text>}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

/** One transaction by hand. Splits, money owed, notes and the rest are in the editor once it's added. */
export function NewTransactionForm({ accounts, accountId: startAccount, onClose, onSaved }: {
  accounts: Account[]; accountId?: string | null; onClose: () => void; onSaved: (id: string) => void;
}) {
  const t = useTheme();
  const shown = accounts.filter((a) => !a.is_hidden);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string | null>(startAccount ?? (shown.find((a) => a.kind === 'manual' && (a.type === 'credit' || a.type === 'depository')) ?? shown.find((a) => a.type === 'depository') ?? shown[0])?.id ?? null);
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [merchants, setMerchants] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useChanged([dir, amount, date, accountId, merchant, categoryId]);
  useEffect(() => {
    supabase.from('categories').select('id, name, group_name, kind, sort, icon').eq('is_hidden', false).order('sort').then(({ data }) => setCats((data ?? []) as Category[]));
    knownMerchants().then(setMerchants).catch(() => {});
  }, []);
  // The category this merchant had last time, once you've typed one you've used before.
  useEffect(() => {
    const m = merchant.trim();
    if (!m || categoryId) return;
    const h = setTimeout(async () => {
      const { data } = await supabase.from('transactions').select('category_id').ilike('merchant', m).not('category_id', 'is', null).order('date', { ascending: false }).limit(1);
      if (data?.[0]?.category_id) setCategoryId((c) => c ?? data[0].category_id);
    }, 400);
    return () => clearTimeout(h);
  }, [merchant]);
  const cat = cats.find((c) => c.id === categoryId) as any;
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const save = async () => {
    const a = parseMoney(amount), d = toIsoDate(date);
    if (!merchant.trim() || isNaN(a) || !a || !d || !accountId) { setError('Fill in who it was with, the amount, the date and the account.'); return; }
    setBusy(true); setError('');
    const signed = round2(dir === 'out' ? -Math.abs(a) : Math.abs(a));
    const { data, error } = await supabase.from('transactions').insert({
      account_id: accountId, date: d, amount: signed, name: merchant.trim(), merchant: merchant.trim(), source: 'manual',
      category_id: categoryId, category_source: categoryId ? 'manual' : null, is_transfer: cat?.kind === 'transfer',
      reviewed: !!categoryId, reviewed_at: categoryId ? new Date().toISOString() : null,
    }).select('id').single();
    setBusy(false);
    if (error) { setError(error.message); return; }
    forgetKnown();
    onSaved(data.id); onClose();
  };
  return (
    <Sheet title="Add a transaction" dirty={dirty} onClose={onClose} footer={<Button title="Add" onPress={save} busy={busy} />}>
      <Segmented value={dir} onChange={setDir} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Amount"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} accessibilityLabel="Amount" autoFocus /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field></View>
      </View>
      <Field t={t} label={dir === 'out' ? 'Where (merchant)' : 'From'}>
        <SuggestInput style={input} value={merchant} onChange={setMerchant} options={merchants} placeholder={dir === 'out' ? 'e.g. Amazon' : 'e.g. Mum'} />
      </Field>
      <Field t={t} label="Account">
        <View style={styles.chips}>{shown.map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => setAccountId(a.id)} />)}</View>
      </Field>
      {accounts.find((a) => a.id === accountId)?.kind === 'plaid' && (
        <Text style={{ color: t.muted, fontSize: 12 }}>This account is connected to the bank. When the bank’s copy of this transaction arrives, the two are linked, so it isn’t counted twice.</Text>
      )}
      <Field t={t} label="Category">
        <Chip label={cat ? `${categoryIcon(cat.name, cat.icon)} ${cat.name}` : 'Choose (optional)'} on={!!cat} onPress={() => setPicking(true)} />
      </Field>
      <Text style={{ color: t.muted, fontSize: 12 }}>To split it, mark money owed or add notes, open it from Transactions once it’s added.</Text>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <SinglePicker visible={picking} title="Category" onClose={() => setPicking(false)} selected={categoryId}
        items={cats.map((c: any) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))}
        onPick={(id) => { setCategoryId(id); setPicking(false); }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
