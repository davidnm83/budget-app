// Merchants: every merchant name on your transactions, with how often it appears. Rename one
// (or merge it into another by giving it that name) and the change is remembered as a rule, so
// future transactions from the bank get the same name.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMoney, shortDate } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field, Sheet } from '@/components/Forms';
import { useTxnSheet } from '@/components/TxnSheet';
import { Button, Segmented } from '@/components/ui';
import { PAGE_MAX, TYPE } from '@/lib/layout';
import { today } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

interface M { merchant: string; txns: number; total: number; last_date: string }

export default function Merchants() {
  const t = useTheme();
  const [rows, setRows] = useState<M[]>([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'count' | 'name' | 'recent'>('count');
  const [edit, setEdit] = useState<M | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showTxns, txnSheet] = useTxnSheet();

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('merchant_list');
    if (error) setError(error.message);
    else setRows(((data ?? []) as any[]).map((r) => ({ merchant: r.merchant, txns: Number(r.txns), total: Number(r.total), last_date: r.last_date })));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? rows.filter((r) => r.merchant.toLowerCase().includes(s)) : [...rows];
    if (sort === 'name') list.sort((a, b) => a.merchant.localeCompare(b.merchant));
    else if (sort === 'recent') list.sort((a, b) => b.last_date.localeCompare(a.last_date));
    else list.sort((a, b) => b.txns - a.txns);
    return list;
  }, [rows, q, sort]);

  const target = name.trim();
  const merging = !!edit && target !== edit.merchant && rows.find((r) => r.merchant.toLowerCase() === target.toLowerCase());
  // Other names that look like this one: likely duplicates worth merging.
  const similar = useMemo(() => {
    if (!edit) return [];
    const key = edit.merchant.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
    return key.length < 4 ? [] : rows.filter((r) => r.merchant !== edit.merchant && r.merchant.toLowerCase().replace(/[^a-z]/g, '').startsWith(key)).slice(0, 5);
  }, [edit, rows]);

  const save = async () => {
    if (!edit || !target || target === edit.merchant) { setEdit(null); return; }
    setBusy(true); setError('');
    try {
      const to = merging ? merging.merchant : target;
      const a = await supabase.from('transactions').update({ merchant: to }).eq('merchant', edit.merchant);
      if (a.error) throw new Error(a.error.message);
      // Transactions with no merchant set show under their bank description.
      const b = await supabase.from('transactions').update({ merchant: to }).eq('name', edit.merchant).or('merchant.is.null,merchant.eq.');
      if (b.error) throw new Error(b.error.message);
      const r = await supabase.from('merchant_rules').upsert({ match: edit.merchant, merchant: to, source: 'manual' }, { onConflict: 'user_id,match' });
      if (r.error) throw new Error(r.error.message);
      setEdit(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.head}>
        <View style={[styles.search, { backgroundColor: t.card, borderColor: t.line }]}>
          <Ionicons name="search" size={16} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={`Search ${rows.length} merchants`} placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: TYPE.body, paddingVertical: 8 }} />
        </View>
        <Segmented value={sort} onChange={setSort} options={[{ value: 'count', label: 'Most used' }, { value: 'recent', label: 'Recent' }, { value: 'name', label: 'A–Z' }]} />
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      </View>
      <FlatList data={shown} keyExtractor={(r) => r.merchant} contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={{ color: t.muted, padding: 12 }}>No merchants match.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => { setEdit(item); setName(item.merchant); setError(''); }}
            style={({ pressed, hovered }: any) => [styles.row, { borderColor: t.line, backgroundColor: pressed || hovered ? t.line : t.card }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: TYPE.body, fontWeight: '600' }} numberOfLines={1}>{item.merchant}</Text>
              <Text style={{ color: t.muted, fontSize: TYPE.label }}>{item.txns} transaction{item.txns === 1 ? '' : 's'} · last {shortDate(item.last_date)} {item.last_date.slice(0, 4)}</Text>
            </View>
            <Text style={{ color: item.total > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(item.total)}</Text>
          </Pressable>
        )} />
      {edit && (
        <Sheet title="Merchant" onClose={() => setEdit(null)} footer={<Button title={merging ? `Merge into ${merging.merchant}` : 'Save name'} onPress={save} busy={busy} disabled={!target} />}>
          <Field t={t} label="Name" hint={merging ? `“${merging.merchant}” already exists: these ${edit.txns} transactions will join its ${merging.txns}.` : 'Renames it on every transaction and on new ones from the bank.'}>
            <TextInput value={name} onChangeText={setName} autoCapitalize="words" style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.bg }]} />
          </Field>
          {similar.length > 0 && (
            <Field t={t} label="Similar names" hint="Tap one to merge into it.">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {similar.map((s) => (
                  <Pressable key={s.merchant} onPress={() => setName(s.merchant)} style={[styles.chip, { borderColor: name === s.merchant ? t.accent : t.line }]}>
                    <Text style={{ color: t.text, fontSize: TYPE.small }}>{s.merchant} · {s.txns}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
          )}
          {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
          <Button title={`See its ${edit.txns} transactions`} kind="plain" onPress={() => showTxns({ title: edit.merchant, from: '1900-01-01', to: today(), merchant: edit.merchant })} />
        </Sheet>
      )}
      {txnSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { padding: 12, gap: 8, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  list: { paddingHorizontal: 12, paddingBottom: 48, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
});
