import { formatMoney } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Button, Empty } from '@/components/ui';
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('accounts').select('*').eq('is_hidden', false).order('name');
    setLoading(false);
    if (error) setMsg(error.message);
    else setAccounts((data ?? []) as Account[]);
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
        <Button title="Sync now" onPress={syncNow} busy={syncing} />
        {!!msg && <Text style={{ color: t.muted }}>{msg}</Text>}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Empty text="No accounts yet. Link a bank in Settings." />}
        renderSectionHeader={({ section }) => (
          <View style={styles.header}>
            <Text style={{ color: t.muted, fontWeight: '600' }}>{section.title}</Text>
            <Text style={{ color: t.muted }}>{formatMoney(section.total)}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.row, { backgroundColor: t.card, borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 16 }} numberOfLines={1}>{item.name}{item.mask ? ` ••${item.mask}` : ''}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {item.kind === 'manual' ? 'Manual' : item.balance_updated_at ? `Updated ${new Date(item.balance_updated_at).toLocaleString()}` : ''}
              </Text>
            </View>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
              {item.current_balance == null ? '—' : formatMoney(signed(item))}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginHorizontal: 12, marginBottom: 6, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
});
