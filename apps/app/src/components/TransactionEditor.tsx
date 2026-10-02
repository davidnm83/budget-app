// Edit one transaction: merchant, category (or a split across several), notes, tags, and the date or
// amount. Saving marks it reviewed. "Always use this category" creates a rule so future
// transactions are categorised the same way, and can apply it to unreviewed ones too (TXN-5).
// Bank transactions keep the bank's original date and amount beside your changes (TXN-12).
import { categoryIcon, formatMoney, normalizeDescription, parseMoney, round2, searchPattern, shortDate, toIsoDate } from '@budget-app/core';
import { merchantLogo } from '@/lib/logos';
import { Logo } from '@/components/Logo';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { peekCategories, peekTxn, storeCategories } from '@/lib/txnCache';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SinglePicker } from '@/components/Picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { DateField } from '@/components/DateField';
import type { Category, Txn } from '@/lib/types';

/**
 * The transaction editor. Used as its own page, and inside a pop-up (from a budget line) so
 * closing it lands back where you were. `onOpen` opens another transaction (a transfer's other side).
 */
export function TransactionEditor({ id, onDone, onOpen }: { id: string; onDone: () => void; onOpen?: (id: string) => void }) {
  const t = useTheme();
  // Paint from the list row that was tapped (when there is one) while the full record loads;
  // saving waits for the full record.
  const seed = useMemo(() => peekTxn(id), [id]);
  const [txn, setTxn] = useState<Txn | null>(seed as Txn | null);
  const [ready, setReady] = useState(false);
  const [cats, setCats] = useState<Category[]>(peekCategories);
  const [merchant, setMerchant] = useState(seed?.merchant ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(seed?.category_id ?? null);
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [tags, setTags] = useState((seed?.tags ?? []).join(', '));
  const [date, setDate] = useState(seed?.date ?? '');
  const [amount, setAmount] = useState(seed ? Number(seed.amount).toFixed(2) : '');
  const picked = useRef(false); // a category chosen before the full record arrived is kept
  const [makeRule, setMakeRule] = useState(false);
  const [backfill, setBackfill] = useState(true);
  const [matching, setMatching] = useState<number | null>(null);
  // Split editor (TXN-6): null = not split; otherwise the parts being edited.
  const [parts, setParts] = useState<{ category_id: string | null; amount: string; notes: string }[] | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [pair, setPair] = useState<{ id: string; date: string; amount: number; account: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: tx }, { data: c }] = await Promise.all([
        supabase.from('transactions').select('*, accounts(name, mask), transaction_splits(id, amount, notes, category_id, categories(name))').eq('id', id).single(),
        supabase.from('categories').select('id, name, group_name, kind, sort, icon').eq('is_hidden', false).order('sort'),
      ]);
      if (tx) {
        setTxn(tx as Txn); setReady(true);
        setMerchant(tx.merchant ?? '');
        if (!picked.current) setCategoryId(tx.category_id);
        setNotes(tx.notes ?? '');
        setTags((tx.tags ?? []).join(', '));
        setDate(tx.date);
        setAmount(Number(tx.amount).toFixed(2));
        if (tx.transfer_pair_id) {
          const { data: p } = await supabase.from('transaction_list').select('id, date, amount, account_name').eq('id', tx.transfer_pair_id).maybeSingle();
          if (p) setPair({ id: p.id, date: p.date, amount: Number(p.amount), account: p.account_name });
        }
        const sp = (tx.transaction_splits ?? []) as any[];
        setParts(sp.length ? sp.map((p) => ({ category_id: p.category_id, amount: Number(p.amount).toFixed(2), notes: p.notes ?? '' })) : null);
      }
      setCats((c ?? []) as Category[]); storeCategories((c ?? []) as Category[]);
    })();
  }, [id]);

  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of cats) (m.get(c.group_name) ?? m.set(c.group_name, []).get(c.group_name)!).push(c);
    return [...m.entries()];
  }, [cats]);

  // Suggestions: what this merchant got before, then the categories you've used most recently.
  const who = txn ? txn.merchant || txn.name : '';
  useEffect(() => {
    if (!txn) return;
    const q = (v: string) => `"${String(v).replace(/"/g, '')}"`;
    Promise.all([
      supabase.from('transactions').select('category_id').or(`merchant.eq.${q(who)},name.eq.${q(txn.name)}`).not('category_id', 'is', null).neq('id', txn.id).order('date', { ascending: false }).limit(10),
      supabase.from('transactions').select('category_id').eq('category_source', 'manual').not('category_id', 'is', null).order('date', { ascending: false }).limit(60),
    ]).then(([same, recent]) => setSuggested([...new Set([...(same.data ?? []), ...(recent.data ?? [])].map((r: any) => r.category_id as string))].slice(0, 8)));
  }, [txn?.id, who]);

  // How many unreviewed transactions a new rule would also catch.
  const ruleText = txn ? (merchant.trim() || normalizeDescription(txn.name)) : '';
  useEffect(() => {
    if (!makeRule || !txn) { setMatching(null); return; }
    const p = searchPattern(ruleText);
    if (!p) return;
    supabase.from('transaction_list').select('id', { count: 'exact', head: true }).eq('reviewed', false).neq('id', txn.id)
      .or(`display_name.ilike.${p},name.ilike.${p}`).then(({ count }) => setMatching(count ?? 0));
  }, [makeRule, ruleText, txn?.id]);

  if (!txn) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  const split = !!parts && parts.length > 0;
  const shownSuggested = suggested.filter((x) => cats.some((c) => c.id === x)).slice(0, 5);
  const total = round2(parseMoney(amount));
  const partsSum = round2((parts ?? []).reduce((s2, p) => s2 + (parseMoney(p.amount) || 0), 0));
  const remaining = round2(total - partsSum);
  const catName = (cid: string | null) => { const c = cats.find((x: any) => x.id === cid) as any; return c ? `${categoryIcon(c.name, c.icon)} ${c.name}` : 'Choose category'; };
  const startSplit = () => setParts([
    { category_id: categoryId, amount: amount, notes: '' },
    { category_id: null, amount: '0.00', notes: '' },
  ]);
  const setPart = (i: number, patch: Partial<{ category_id: string | null; amount: string; notes: string }>) =>
    setParts((ps) => ps!.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const resetToBank = async () => {
    setBusy(true);
    const { error } = await supabase.from('transactions').update({
      date: txn.original_date ?? txn.date, amount: txn.original_amount ?? txn.amount, original_date: null, original_amount: null,
    }).eq('id', txn.id);
    setBusy(false);
    if (error) setError(error.message); else onDone();
  };

  const save = async () => {
    setBusy(true);
    setError('');
    const cat = cats.find((c) => c.id === categoryId);
    const changedCategory = categoryId !== txn.category_id;
    const newDate = toIsoDate(date);
    const newAmount = round2(parseMoney(amount));
    if (!newDate || isNaN(newAmount)) { setBusy(false); setError('Check the date and amount.'); return; }
    // First change to a bank transaction's date or amount: keep the bank's value beside it.
    const keep: Record<string, unknown> = {};
    if (txn.source === 'plaid') {
      if (newDate !== txn.date && !txn.original_date) keep.original_date = txn.date;
      if (newAmount !== Number(txn.amount) && txn.original_amount == null) keep.original_amount = txn.amount;
    }
    if (split && (parts!.length < 2 || Math.abs(remaining) > 0.004 || parts!.some((p) => !p.category_id))) {
      setBusy(false); setError(`Each part needs a category, and the parts must add up to ${formatMoney(newAmount)} (${formatMoney(remaining)} left).`); return;
    }
    // Splits: replace the parts (or remove them when the split was undone).
    const hadSplit = (txn.transaction_splits ?? []).length > 0;
    if (split || hadSplit) {
      const del = await supabase.from('transaction_splits').delete().eq('transaction_id', txn.id);
      if (del.error) { setBusy(false); setError(del.error.message); return; }
    }
    if (split) {
      const ins = await supabase.from('transaction_splits').insert(parts!.map((p) => ({ transaction_id: txn.id, category_id: p.category_id, amount: round2(parseMoney(p.amount)), notes: p.notes.trim() || null })));
      if (ins.error) { setBusy(false); setError(ins.error.message); return; }
    }
    const { error } = await supabase.from('transactions').update({
      ...keep,
      date: newDate,
      amount: newAmount,
      merchant: merchant.trim() || null,
      ...(split ? { category_id: null, category_source: 'manual', is_transfer: parts!.every((p) => cats.find((c) => c.id === p.category_id)?.kind === 'transfer') }
        : { category_id: categoryId, category_source: changedCategory || hadSplit ? 'manual' : txn.category_source, is_transfer: cat?.kind === 'transfer' }),
      notes: notes.trim() || null,
      tags: [...new Set(tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))],
      reviewed: true,
      reviewed_at: new Date().toISOString(),
    }).eq('id', txn.id);
    if (!error && makeRule && categoryId && !split) {
      await supabase.from('category_rules').insert({ match_text: ruleText, category_id: categoryId });
      const p = searchPattern(ruleText);
      if (backfill && p) {
        // Apply it to unreviewed transactions with the same text (they stay unreviewed for you to check).
        const { data: hits } = await supabase.from('transaction_list').select('id').eq('reviewed', false).eq('split_count', 0)
          .or(`display_name.ilike.${p},name.ilike.${p}`).limit(1000);
        const ids = (hits ?? []).map((h) => h.id).filter((x) => x !== txn.id);
        for (let i = 0; i < ids.length; i += 200) {
          await supabase.from('transactions').update({ category_id: categoryId, category_source: 'rule', is_transfer: cat?.kind === 'transfer' }).in('id', ids.slice(i, i + 200));
        }
      }
    }
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  };

  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.bg }];
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Logo size={40} name={txn.merchant || txn.name || '?'} uri={merchantLogo(merchant.trim() || txn.merchant || txn.name)} />
          <Text style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>{formatMoney(Number(txn.amount), txn.currency)}</Text>
        </View>
        <Text style={{ color: t.muted }}>{shortDate(txn.date)} · {txn.accounts?.name}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }} selectable>{txn.name}</Text>
      </Card>

      {pair && (
        <Pressable onPress={() => (onOpen ? onOpen(pair.id) : router.push({ pathname: '/transaction/[id]', params: { id: pair.id } }))} style={styles.ruleRow}>
          <Text style={{ color: t.muted, flex: 1, fontSize: 13 }}>🔄 Transfer: the other side is {formatMoney(pair.amount)} in {pair.account} on {shortDate(pair.date)}. Not counted as spending.</Text>
          <Text style={{ color: t.accent }}>Open ›</Text>
        </Pressable>
      )}

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
          <DateField value={date} onChange={setDate} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: t.muted }]}>Amount (money out is negative)</Text>
          <TextInput style={input} value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" />
        </View>
      </View>

      <Text style={[styles.label, { color: t.muted }]}>Merchant</Text>
      <TextInput style={input} value={merchant} onChangeText={setMerchant} placeholder="e.g. Superstore" placeholderTextColor={t.muted} />

      <View style={[styles.ruleRow, { marginTop: 16 }]}>
        <Text style={{ color: t.muted, fontSize: 13, flex: 1 }}>{split ? 'Split across categories' : 'Category'}</Text>
        {split
          ? <Pressable onPress={() => setParts(null)} hitSlop={8}><Text style={{ color: t.accent }}>Undo split</Text></Pressable>
          : <Pressable onPress={startSplit} hitSlop={8}><Text style={{ color: t.accent }}>✂️ Split</Text></Pressable>}
      </View>
      {split && (
        <Card style={{ gap: 8 }}>
          {parts!.map((p, i) => (
            <View key={i} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Pressable onPress={() => setPickFor(i)} style={[styles.input, { flex: 1, borderColor: t.line, paddingVertical: 9 }]}>
                  <Text style={{ color: p.category_id ? t.text : t.muted }} numberOfLines={1}>{catName(p.category_id)}</Text>
                </Pressable>
                <TextInput value={p.amount} onChangeText={(v) => setPart(i, { amount: v })} keyboardType="numbers-and-punctuation"
                  style={[styles.input, { width: 110, textAlign: 'right', color: t.text, borderColor: t.line, paddingVertical: 9 }]} />
                {parts!.length > 2 && <Pressable onPress={() => setParts(parts!.filter((_, j) => j !== i))} hitSlop={8}><Text style={{ color: t.danger, fontSize: 18 }}>×</Text></Pressable>}
              </View>
              <TextInput value={p.notes} onChangeText={(v) => setPart(i, { notes: v })} placeholder="Note for this part (optional)" placeholderTextColor={t.muted}
                style={{ color: t.text, fontSize: 13, paddingHorizontal: 4 }} />
            </View>
          ))}
          <View style={styles.ruleRow}>
            <Pressable onPress={() => setParts([...parts!, { category_id: null, amount: remaining.toFixed(2), notes: '' }])} hitSlop={8}>
              <Text style={{ color: t.accent }}>+ Add a part</Text>
            </Pressable>
            <Text style={{ color: Math.abs(remaining) > 0.004 ? t.danger : t.muted, flex: 1, textAlign: 'right', fontSize: 13 }}>
              {Math.abs(remaining) > 0.004 ? `${formatMoney(remaining)} left to assign` : 'Adds up ✓'}
            </Text>
          </View>
        </Card>
      )}
      {!split && <Card style={{ padding: 0 }}>
        <Pressable onPress={() => setPicking(true)} accessibilityLabel="Choose category" style={({ pressed, hovered }: any) => [styles.catRow, (pressed || hovered) && { backgroundColor: t.line }]}>
          <Text style={{ color: categoryId ? t.text : t.muted, fontSize: 16, fontWeight: '600', flex: 1 }} numberOfLines={1}>{catName(categoryId)}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{(cats.find((c) => c.id === categoryId) as any)?.group_name ?? ''}</Text>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
        {shownSuggested.filter((x) => x !== categoryId).length > 0 && (
          <View style={[styles.chips, { paddingHorizontal: 10, paddingBottom: 10 }]}>
            {shownSuggested.filter((x) => x !== categoryId).slice(0, 4).map((cid) => (
              <Pressable key={cid} onPress={() => { picked.current = true; setCategoryId(cid); }} style={[styles.chip, { borderColor: t.line }]}>
                <Text style={{ color: t.text, fontSize: 13 }}>{catName(cid)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>}

      {!split && <View style={styles.ruleRow}>
        <Text style={{ color: t.text, flex: 1 }}>Always use this category for “{ruleText}”</Text>
        <Switch value={makeRule} onValueChange={setMakeRule} disabled={!categoryId} />
      </View>}
      {!split && makeRule && !!matching && (
        <View style={styles.ruleRow}>
          <Text style={{ color: t.text, flex: 1 }}>Also apply it to {matching} unreviewed transaction{matching === 1 ? '' : 's'} like this</Text>
          <Switch value={backfill} onValueChange={setBackfill} />
        </View>
      )}

      <Text style={[styles.label, { color: t.muted }]}>Notes</Text>
      <TextInput style={[input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} multiline />

      <Text style={[styles.label, { color: t.muted }]}>Tags (comma-separated)</Text>
      <TextInput style={input} value={tags} onChangeText={setTags} placeholder="e.g. trip, reimbursable" placeholderTextColor={t.muted} autoCapitalize="none" />

      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Button title="Save and mark reviewed" onPress={save} busy={busy || !ready} style={{ marginTop: 16 }} />
      <SinglePicker visible={picking || pickFor != null} title="Category" onClose={() => { setPicking(false); setPickFor(null); }}
        selected={pickFor != null ? parts?.[pickFor]?.category_id ?? null : categoryId} suggested={shownSuggested}
        items={cats.map((c: any) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))}
        onPick={(cid) => { if (pickFor != null) setPart(pickFor, { category_id: cid }); else { picked.current = true; setCategoryId(cid); } setPicking(false); setPickFor(null); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12 },
  page: { padding: 16, paddingBottom: 48, gap: 4, maxWidth: 640, width: '100%', alignSelf: 'center' },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
});
