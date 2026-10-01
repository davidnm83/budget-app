// Edit one transaction: merchant, category, notes, tags, and the date or amount. Saving marks it reviewed.
// "Always use this category" creates a rule so future transactions are categorised the same way.
// Bank transactions keep the bank's original date and amount beside your changes (TXN-12).
import { formatMoney, normalizeDescription, parseMoney, round2, shortDate, toIsoDate } from '@budget-app/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Category, Txn } from '@/lib/types';

export default function TransactionScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [txn, setTxn] = useState<Txn | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [makeRule, setMakeRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: tx }, { data: c }] = await Promise.all([
        supabase.from('transactions').select('*, accounts(name, mask), transaction_splits(id, amount, notes, category_id, categories(name))').eq('id', id).single(),
        supabase.from('categories').select('id, name, group_name, kind, sort').eq('is_hidden', false).order('sort'),
      ]);
      if (tx) {
        setTxn(tx as Txn);
        setMerchant(tx.merchant ?? '');
        setCategoryId(tx.category_id);
        setNotes(tx.notes ?? '');
        setTags((tx.tags ?? []).join(', '));
        setDate(tx.date);
        setAmount(Number(tx.amount).toFixed(2));
      }
      setCats((c ?? []) as Category[]);
    })();
  }, [id]);

  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of cats) (m.get(c.group_name) ?? m.set(c.group_name, []).get(c.group_name)!).push(c);
    return [...m.entries()];
  }, [cats]);

  if (!txn) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  const split = (txn.transaction_splits ?? []).length > 0;

  const resetToBank = async () => {
    setBusy(true);
    const { error } = await supabase.from('transactions').update({
      date: txn.original_date ?? txn.date, amount: txn.original_amount ?? txn.amount, original_date: null, original_amount: null,
    }).eq('id', txn.id);
    setBusy(false);
    if (error) setError(error.message); else router.back();
  };

  const save = async () => {
    setBusy(true);
    setError('');
    const cat = cats.find((c) => c.id === categoryId);
    const changedCategory = categoryId !== txn.category_id;
    const newDate = toIsoDate(date);
    const newAmount = round2(parseMoney(amount));
    if (!newDate || isNaN(newAmount)) { setBusy(false); setError('Check the date (YYYY-MM-DD) and amount.'); return; }
    // First change to a bank transaction's date or amount: keep the bank's value beside it.
    const keep: Record<string, unknown> = {};
    if (txn.source === 'plaid') {
      if (newDate !== txn.date && !txn.original_date) keep.original_date = txn.date;
      if (newAmount !== Number(txn.amount) && txn.original_amount == null) keep.original_amount = txn.amount;
    }
    const { error } = await supabase.from('transactions').update({
      ...keep,
      date: newDate,
      amount: newAmount,
      merchant: merchant.trim() || null,
      ...(split ? {} : { category_id: categoryId, category_source: changedCategory ? 'manual' : txn.category_source, is_transfer: cat?.kind === 'transfer' }),
      notes: notes.trim() || null,
      tags: [...new Set(tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))],
      reviewed: true,
      reviewed_at: new Date().toISOString(),
    }).eq('id', txn.id);
    if (!error && makeRule && categoryId && !split) {
      const matchText = merchant.trim() || normalizeDescription(txn.name);
      await supabase.from('category_rules').insert({ match_text: matchText, category_id: categoryId });
    }
    setBusy(false);
    if (error) setError(error.message);
    else router.back();
  };

  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.bg }];
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 4 }}>
        <Text style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>{formatMoney(Number(txn.amount), txn.currency)}</Text>
        <Text style={{ color: t.muted }}>{shortDate(txn.date)} · {txn.accounts?.name}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }} selectable>{txn.name}</Text>
      </Card>

      {(txn.original_date || txn.original_amount != null) && (
        <View style={styles.ruleRow}>
          <Text style={{ color: t.muted, flex: 1, fontSize: 13 }}>
            The bank says {txn.original_date ? shortDate(txn.original_date) : shortDate(txn.date)}, {formatMoney(Number(txn.original_amount ?? txn.amount))}. You changed it.
          </Text>
          <Button title="Use the bank's" kind="plain" onPress={resetToBank} />
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: t.muted }]}>Date</Text>
          <TextInput style={input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={t.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: t.muted }]}>Amount (money out is negative)</Text>
          <TextInput style={input} value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" />
        </View>
      </View>

      <Text style={[styles.label, { color: t.muted }]}>Merchant</Text>
      <TextInput style={input} value={merchant} onChangeText={setMerchant} placeholder="e.g. Superstore" placeholderTextColor={t.muted} />

      <Text style={[styles.label, { color: t.muted }]}>{split ? 'Split across categories' : 'Category'}</Text>
      {split && (
        <Card style={{ gap: 6 }}>
          {txn.transaction_splits!.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: t.text, flex: 1 }}>{p.categories?.name ?? 'Uncategorized'}{p.notes ? <Text style={{ color: t.muted }}> · {p.notes}</Text> : null}</Text>
              <Text style={{ color: t.text }}>{formatMoney(Number(p.amount))}</Text>
            </View>
          ))}
        </Card>
      )}
      {!split && <Card style={{ padding: 8 }}>
        {groups.map(([group, list]) => (
          <View key={group} style={{ marginBottom: 8 }}>
            <Text style={{ color: t.muted, fontSize: 12, margin: 4 }}>{group}</Text>
            <View style={styles.chips}>
              {list.map((c) => {
                const on = c.id === categoryId;
                return (
                  <Pressable key={c.id} onPress={() => setCategoryId(c.id)}
                    style={[styles.chip, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : 'transparent' }]}>
                    <Text style={{ color: on ? '#fff' : t.text }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </Card>}

      {!split && <View style={styles.ruleRow}>
        <Text style={{ color: t.text, flex: 1 }}>Always use this category for “{merchant.trim() || normalizeDescription(txn.name)}”</Text>
        <Switch value={makeRule} onValueChange={setMakeRule} disabled={!categoryId} />
      </View>}

      <Text style={[styles.label, { color: t.muted }]}>Notes</Text>
      <TextInput style={[input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline />

      <Text style={[styles.label, { color: t.muted }]}>Tags (comma-separated)</Text>
      <TextInput style={input} value={tags} onChangeText={setTags} placeholder="e.g. trip, reimbursable" placeholderTextColor={t.muted} autoCapitalize="none" />

      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Button title="Save and mark reviewed" onPress={save} busy={busy} style={{ marginTop: 16 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, gap: 4, maxWidth: 640, width: '100%', alignSelf: 'center' },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
});
