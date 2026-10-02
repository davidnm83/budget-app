// Drill-down from Budget or Reports: the transactions (or split parts) behind one number.
// Params: from, to, title, and one of category (id or 'none'), group, merchant; optional kind.
import { LIST } from '@/lib/layout';
import { formatMoney, shortDate } from '@budget-app/core';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

interface Line { transaction_id: string; date: string; amount: number; merchant: string; kind: string }

export default function Report() {
  const t = useTheme();
  const p = useLocalSearchParams<{ from: string; to: string; title?: string; category?: string; group?: string; merchant?: string; kind?: string }>();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      let q = supabase.from('transaction_lines').select('transaction_id, date, amount, merchant, kind')
        .gte('date', p.from).lte('date', p.to).order('date', { ascending: false }).limit(1000);
      if (p.category === 'none') q = q.is('category_id', null).neq('kind', 'transfer');
      else if (p.category) q = q.eq('category_id', p.category);
      if (p.group) {
        const { data } = await supabase.from('categories').select('id').eq('group_name', p.group).eq('kind', 'expense');
        q = q.in('category_id', (data ?? []).map((c) => c.id));
      }
      if (p.merchant) q = q.eq('merchant', p.merchant);
      if (p.kind || p.merchant || p.group) q = q.eq('kind', p.kind ?? 'expense');
      const { data, error } = await q;
      if (error) setError(error.message);
      setLines(((data ?? []) as Line[]).map((l) => ({ ...l, amount: Number(l.amount) })));
    })();
  }, [p.from, p.to, p.category, p.group, p.merchant, p.kind]);

  const total = (lines ?? []).reduce((s, l) => s + l.amount, 0);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: p.title ?? 'Transactions' }} />
      <View style={{ padding: 16, gap: 2 }}>
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{formatMoney(total)}</Text>
        <Text style={{ color: t.muted }}>{lines?.length ?? '…'} transactions · {shortDate(p.from)} {p.from.slice(0, 4)} – {shortDate(p.to)} {p.to.slice(0, 4)}</Text>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      </View>
      <FlatList {...LIST}
        data={lines ?? []}
        keyExtractor={(l, i) => l.transaction_id + i}
        ListEmptyComponent={lines ? <Empty text="Nothing here." /> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/transaction/${item.transaction_id}` as any)} style={[styles.row, { backgroundColor: t.card, borderColor: t.line }]}>
            <Text style={{ color: t.muted, width: 56 }}>{shortDate(item.date)}</Text>
            <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{item.merchant}</Text>
            <Text style={{ color: item.amount > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(item.amount)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginHorizontal: 12, marginBottom: 4, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
});
