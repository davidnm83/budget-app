// Review inbox: new transactions arrive here already categorised and unchecked.
// Tick the circle to mark one reviewed, or tap the row to change it first.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMoney, shortDate } from '@budget-app/core';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Empty } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Txn } from '@/lib/types';

const SOURCE_LABEL: Record<string, string> = { rule: 'rule', learned: 'learned', plaid: 'bank', manual: 'you' };

export default function Review() {
  const t = useTheme();
  const [rows, setRows] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('transactions')
      .select('id, account_id, date, amount, currency, name, merchant, category_id, category_source, reviewed, notes, is_transfer, accounts(name, mask), categories(name)')
      .eq('reviewed', false)
      .order('date', { ascending: false })
      .limit(300);
    setLoading(false);
    if (error) setError(error.message);
    else { setError(''); setRows((data ?? []) as unknown as Txn[]); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markReviewed = async (ids: string[]) => {
    setRows((r) => r.filter((x) => !ids.includes(x.id)));
    const { error } = await supabase.from('transactions')
      .update({ reviewed: true, reviewed_at: new Date().toISOString() }).in('id', ids);
    if (error) { setError(error.message); load(); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: rows.length ? `Review (${rows.length})` : 'Review' }} />
      {!!error && <Text style={{ color: t.danger, padding: 12 }}>{error}</Text>}
      {rows.length > 1 && (
        <Pressable onPress={() => markReviewed(rows.map((r) => r.id))} style={styles.checkAll}>
          <Text style={{ color: t.accent, fontWeight: '600' }}>Mark all {rows.length} as reviewed</Text>
        </Pressable>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? null : <Empty text="All caught up. New transactions show up here after each sync." />}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: 56 }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.line : t.card }]}>
            <Pressable accessibilityLabel="Mark reviewed" hitSlop={10} onPress={() => markReviewed([item.id])} style={styles.check}>
              <Ionicons name="ellipse-outline" size={26} color={t.muted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>{item.merchant || item.name}</Text>
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>
                {shortDate(item.date)} · {item.accounts?.name ?? 'Account'}{item.accounts?.mask ? ` ••${item.accounts.mask}` : ''}
              </Text>
              <Text numberOfLines={1} style={{ color: item.category_id ? t.text : t.danger, fontSize: 13, marginTop: 2 }}>
                {item.categories?.name ?? 'Uncategorised'}
                {item.category_source ? <Text style={{ color: t.muted }}>{`  (${SOURCE_LABEL[item.category_source]})`}</Text> : null}
              </Text>
            </View>
            <Text style={[styles.amount, { color: item.amount > 0 ? t.positive : t.text }]}>
              {item.amount > 0 ? '+' : ''}{formatMoney(item.amount, item.currency)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 16 },
  check: { width: 56, alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  amount: { fontSize: 16, fontWeight: '600', marginLeft: 8, fontVariant: ['tabular-nums'] },
  checkAll: { padding: 12, alignItems: 'flex-end' },
});
