import { formatMoney } from '@budget-app/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Chip, Empty } from '@/components/ui';
import { mergeAccounts } from '@/lib/mergeAccounts';
import { callFunction, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Account } from '@/lib/types';

// Plaid reports what you owe on cards and loans as a positive balance; show it as negative.
const signed = (a: Account) => (a.type === 'credit' || a.type === 'loan' ? -1 : 1) * Number(a.current_balance ?? 0);

const GROUPS: Record<string, string> = { depository: 'Cash', credit: 'Credit cards', loan: 'Loans', investment: 'Investments' };

export default function Accounts() {
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [balance, setBalance] = useState('');
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const merge = async (from: Account) => {
    if (!mergeTarget) return;
    setMerging(true);
    try {
      const r = await mergeAccounts(from.id, mergeTarget);
      setMsg(`Merged ${from.name}: ${r.linked} matched bank transactions, ${r.split} rebuilt as splits, ${r.moved} older ones moved over.`);
      setEditing(null); setMergeTarget(null);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  };

  // Manual accounts (CSV or Fina) have no bank feed: type today's balance once and the app works
  // out a start balance; from then on balance = start + transactions, like Fina's auto balance.
  const saveBalance = async (a: Account) => {
    const v = Number(balance.replace(/[$,\s]/g, ''));
    if (balance.trim() && !isNaN(v)) {
      // What you owe on a card or loan is negative in the app's sign, whichever way you type it.
      const today = a.type === 'credit' || a.type === 'loan' ? -Math.abs(v) : v;
      const { error } = await supabase.rpc('set_balance_today', { p_account: a.id, p_balance: today });
      if (error) setMsg(error.message);
    }
    setEditing(null);
    load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    // account_balances = accounts with manual balances worked out (start balance + transactions).
    const { data, error } = await supabase.from('account_balances').select('*').eq('is_hidden', false).order('name');
    setLoading(false);
    if (error) setMsg(error.message);
    else setAccounts((data ?? []).map((a: any) => ({ ...a, current_balance: a.balance, balance_updated_at: a.balance_as_of })) as Account[]);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const syncNow = async () => {
    setSyncing(true);
    setMsg('');
    try {
      const r = await callFunction<{ added: number; results: { institution: string; status: string }[] }>('plaid-sync');
      const problems = r.results.filter((x) => x.status !== 'ok').map((x) => `${x.institution}: ${x.status.replace('_', ' ')}`);
      setMsg(`${r.added} new transaction(s).` + (problems.length ? ' ' + problems.join(', ') : ''));
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const sections = Object.entries(
    accounts.reduce<Record<string, Account[]>>((acc, a) => {
      const g = GROUPS[a.type ?? ''] ?? 'Other';
      (acc[g] ??= []).push(a);
      return acc;
    }, {}),
  ).map(([title, data]) => ({ title, data, total: data.reduce((s, a) => s + signed(a), 0) }));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Sync now" onPress={syncNow} busy={syncing} style={{ flex: 1 }} />
          <Button title="Import CSV" kind="plain" onPress={() => router.push('/import')} style={{ flex: 1 }} />
        </View>
        {!!msg && <Text style={{ color: t.muted }}>{msg}</Text>}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Empty text="No accounts yet. Link a bank in Settings, or import a CSV." />}
        renderSectionHeader={({ section }) => (
          <View style={styles.header}>
            <Text style={{ color: t.muted, fontWeight: '600' }}>{section.title}</Text>
            <Text style={{ color: t.muted }}>{formatMoney(section.total)}</Text>
          </View>
        )}
        renderItem={({ item }) => editing === item.id ? (
          <View style={[styles.row, { backgroundColor: t.card, borderColor: t.line, flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{item.name}</Text>
              <TextInput autoFocus value={balance} onChangeText={setBalance} keyboardType="decimal-pad" onSubmitEditing={() => saveBalance(item)}
                placeholder={item.type === 'credit' || item.type === 'loan' ? 'Amount owing' : 'Balance'} placeholderTextColor={t.muted}
                style={{ color: t.text, borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 8, width: 130 }} />
              <Button title="Save" onPress={() => saveBalance(item)} />
            </View>
            {accounts.some((a) => a.kind === 'plaid') && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: t.muted, fontSize: 13 }}>Now connected to the bank? Merge this account's history into the connected one:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {accounts.filter((a) => a.kind === 'plaid').sort((a, b) => Number(b.type === item.type) - Number(a.type === item.type)).map((a) => (
                    <Chip key={a.id} label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`} on={mergeTarget === a.id} onPress={() => setMergeTarget(mergeTarget === a.id ? null : a.id)} />
                  ))}
                </View>
                {mergeTarget && (
                  <Button kind="danger" busy={merging} onPress={() => merge(item)}
                    title={`Merge into ${accounts.find((a) => a.id === mergeTarget)?.name} (can't be undone)`} />
                )}
              </View>
            )}
            <Button title="Close" kind="plain" onPress={() => { setEditing(null); setMergeTarget(null); }} />
          </View>
        ) : (
          <Pressable disabled={item.kind !== 'manual'} onPress={() => { setEditing(item.id); setBalance(item.current_balance == null ? '' : String(Math.abs(Number(item.current_balance)))); }}
            style={[styles.row, { backgroundColor: t.card, borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 16 }} numberOfLines={1}>{item.name}{item.mask ? ` ••${item.mask}` : ''}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {item.kind === 'manual' ? (item.current_balance == null ? 'Manual · tap to set the balance' : 'Manual · auto balance · tap to correct') : item.balance_updated_at ? `Updated ${new Date(item.balance_updated_at).toLocaleString()}` : ''}
              </Text>
            </View>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
              {item.current_balance == null ? (item.kind === 'manual' ? 'Set balance' : '—') : formatMoney(signed(item))}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginHorizontal: 12, marginBottom: 6, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
});
