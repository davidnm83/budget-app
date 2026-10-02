// Merchants: every merchant name on your transactions, with how often it appears. Rename one
// (or merge it into another by giving it that name) and the change is remembered as a rule, so
// future transactions from the bank get the same name.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ROW } from '@/lib/layout';
import { EmptyState, RowsSkeleton } from '@/components/States';
import { ALL_TIME, DateRangeButton, type Range } from '@/components/DateRange';
import { toast } from '@/lib/toast';
import { useConfirm } from '@/components/Confirm';
import { usePullRefresh } from '@/lib/pullRefresh';
import { customPicture, fillsCircle, merchantLogo, movePicture, savePicture, setPictureFill, useLogoVersion } from '@/lib/logos';
import { PICTURE_HINT, pickPicture } from '@/lib/imageUpload';
import { Logo } from '@/components/Logo';
import { UNDER_BAR } from '@/lib/layout';
import { addMonths, formatMoney, monthEnd, monthOf, shortDate } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { Field, Sheet } from '@/components/Forms';
import { MultiPicker } from '@/components/Picker';
import { useTxnSheet } from '@/components/TxnSheet';
import { Button, Chip, Segmented } from '@/components/ui';
import { PAGE_MAX, TYPE } from '@/lib/layout';
import { loadAccounts, today } from '@/lib/plan';
import type { Account } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';

interface M { merchant: string; txns: number; total: number; last_date: string }

export default function Merchants() {
  const t = useTheme();
  const [rows, setRows] = useState<M[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'count' | 'name' | 'recent'>('count');
  const [edit, setEdit] = useState<M | null>(null);
  const [name, setName] = useState('');
  const lv = useLogoVersion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showTxns, txnSheet] = useTxnSheet();
  const [confirm, confirmSheet] = useConfirm();
  // Filters: a date range (empty = all time) and accounts (empty = all).
  const [range, setRange] = useState<Range>(ALL_TIME);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pick, setPick] = useState<'date' | 'accounts' | null>(null);
  useEffect(() => { loadAccounts().then(setAccounts).catch(() => {}); }, []);
  const now = today(), m0 = monthOf(now);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('merchant_list', { p_from: range.from || null, p_to: range.to || null, p_accounts: accountIds.length ? accountIds : null });
    if (error) setError(error.message);
    setLoaded(true);
    if (!error) setError(''), setRows(((data ?? []) as any[]).map((r) => ({ merchant: r.merchant, txns: Number(r.txns), total: Number(r.total), last_date: r.last_date })));
  }, [range.from, range.to, accountIds.join(',')]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

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

  const save = () => {
    if (!edit || !target || target === edit.merchant) { setEdit(null); return; }
    if (merging) confirm({ title: 'Merge merchants', action: 'Merge', message: `Move all ${edit.txns} transactions from “${edit.merchant}” into “${merging.merchant}”? New transactions from the bank will get that name too.`, run: apply });
    else apply();
  };
  const apply = async () => {
    if (!edit) return;
    const old = edit.merchant;
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
      await movePicture(edit.merchant, to).catch(() => {});
      // A plain rename can be put back; a merge was confirmed first.
      toast(merging ? `Merged into ${to}` : `Renamed to ${to}`, merging ? {} : { undo: async () => {
        await supabase.from('transactions').update({ merchant: old }).eq('merchant', to);
        await supabase.from('merchant_rules').delete().eq('match', old).eq('merchant', to);
        await movePicture(to, old).catch(() => {});
      } });
      setEdit(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.head}>
        <View style={styles.filters}>
          <View style={[styles.search, { flexGrow: 1, flexBasis: 220, backgroundColor: t.card, borderColor: t.line }]}>
            <Ionicons name="search" size={16} color={t.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder={`Search ${rows.length} merchants`} placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: TYPE.body, paddingVertical: 8 }} />
          </View>
          <DateRangeButton value={range} onChange={setRange} />
          <FilterButton t={t} icon="wallet-outline" label={accountIds.length ? (accountIds.length === 1 ? accounts.find((a) => a.id === accountIds[0])?.name ?? '1 account' : `${accountIds.length} accounts`) : 'All accounts'} on={accountIds.length > 0} onPress={() => setPick('accounts')} />
        </View>
        <Segmented value={sort} onChange={setSort} options={[{ value: 'count', label: 'Most used' }, { value: 'recent', label: 'Recent' }, { value: 'name', label: 'A–Z' }]} />
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      </View>
      <FlatList data={shown} keyExtractor={(r) => r.merchant} contentContainerStyle={styles.list}
        ListEmptyComponent={loaded ? <EmptyState icon="storefront-outline" title={q.trim() ? 'No merchants match' : 'No merchants yet'} text={q.trim() ? 'Try a shorter search or a wider date range.' : 'They appear here once you have transactions.'} /> : <RowsSkeleton />}
        renderItem={({ item }) => (
          <Pressable onPress={() => { setEdit(item); setName(item.merchant); setError(''); }}
            style={({ pressed, hovered }: any) => [styles.row, { borderColor: t.line, backgroundColor: pressed || hovered ? t.line : t.card }]}>
            <Logo size={34} name={item.merchant} uri={merchantLogo(item.merchant, lv)} />
            <View style={{ flex: 1 }}>
              <Text style={[ROW.title, { color: t.text }]} numberOfLines={1}>{item.merchant}</Text>
              <Text style={{ color: t.muted, fontSize: TYPE.label }}>{item.txns} transaction{item.txns === 1 ? '' : 's'} · last {shortDate(item.last_date)} {item.last_date.slice(0, 4)}</Text>
            </View>
            <Text style={[ROW.amount, { color: item.total > 0 ? t.positive : t.text }]}>{formatMoney(item.total)}</Text>
          </Pressable>
        )} />
      {edit && (
        <Sheet title="Merchant" onClose={() => setEdit(null)} footer={<Button title={merging ? `Merge into ${merging.merchant}` : 'Save name'} onPress={save} busy={busy} disabled={!target} />}>
          <Field t={t} label="Name" hint={merging ? `“${merging.merchant}” already exists: these ${edit.txns} transactions will join its ${merging.txns}.` : 'Renames it on every transaction (not only the ones in the filter) and on new ones from the bank.'}>
            <TextInput value={name} onChangeText={setName} autoCapitalize="words" style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.bg }]} />
          </Field>
          <Field t={t} label="Picture" hint={PICTURE_HINT}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Logo size={44} name={edit.merchant} uri={merchantLogo(edit.merchant, lv)} />
              <Button kind="plain" title={customPicture(edit.merchant, lv) ? 'Replace picture' : 'Upload a picture'} style={{ flex: 1 }}
                onPress={async () => { try { const img = await pickPicture(); if (img) await savePicture(edit.merchant, img); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} />
              {!!customPicture(edit.merchant, lv) && <Button kind="danger" title="Remove" onPress={() => savePicture(edit.merchant, null).catch((e) => setError(String(e?.message ?? e)))} />}
            </View>
            {!!customPicture(edit.merchant, lv) && (
            <Pressable onPress={() => setPictureFill(edit.merchant, !fillsCircle(customPicture(edit.merchant, lv)!, lv)).catch(() => {})} accessibilityRole="checkbox" accessibilityState={{ checked: fillsCircle(customPicture(edit.merchant, lv)!, lv) }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
              <Ionicons name={fillsCircle(customPicture(edit.merchant, lv)!, lv) ? 'checkbox' : 'square-outline'} size={22} color={fillsCircle(customPicture(edit.merchant, lv)!, lv) ? t.accent : t.muted} />
              <Text style={{ color: t.text }}>Fill the circle</Text>
              <Text style={{ color: t.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>off shows the whole picture</Text>
            </Pressable>
          )}
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
          <Button title={`See its ${edit.txns} transactions`} kind="plain" onPress={() => showTxns({ title: edit.merchant, from: range.from || '1900-01-01', to: range.to || today(), merchant: edit.merchant, accountIds: accountIds.length ? accountIds : undefined })} />
        </Sheet>
      )}
      <MultiPicker visible={pick === 'accounts'} title="Accounts" onClose={() => setPick(null)} selected={accountIds} onChange={setAccountIds}
        items={accounts.map((a) => ({ id: a.id, label: `${a.icon ?? ''} ${a.name}${a.mask ? ` ••${a.mask}` : ''}`.trim(), group: a.type ?? undefined }))} />
      {confirmSheet}
      {txnSheet}
    </View>
  );
}

function FilterButton({ t, icon, label, on, onPress }: { t: Theme; icon: keyof typeof Ionicons.glyphMap; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={`Filter: ${label}`} style={({ hovered }: any) => [styles.filter, { borderColor: on ? t.accent : t.line, backgroundColor: hovered ? t.line : t.card }]}>
      <Ionicons name={icon} size={16} color={on ? t.accent : t.muted} />
      <Text style={{ color: on ? t.accent : t.text, fontSize: TYPE.small, fontWeight: '600' }} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={14} color={t.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minHeight: 38, maxWidth: 220 },
  head: { padding: 12, gap: 8, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  list: { paddingHorizontal: 12, paddingBottom: UNDER_BAR, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
});
