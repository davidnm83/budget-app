// Slide-over list of the transactions behind a number: a month bar, a week, a day, a category in
// a report. Tap one to edit it on top; closing comes back to the list (and the page under it).
//   const [showTxns, txnSheet] = useTxnSheet();
//   showTxns({ title: 'Groceries · Sep', from: '2026-09-01', to: '2026-09-30', categoryIds: [id] });
//   … {txnSheet}
import { formatMoney, shortDate } from '@budget-app/core';
import { seedTxn } from '@/lib/txnCache';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { TransactionEditor } from '@/components/TransactionEditor';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export interface TxnQuery {
  title: string;
  from: string; to: string;
  categoryIds?: string[];
  /** 'none' = uncategorised. */
  category?: string;
  group?: string;
  merchant?: string;
  kind?: 'expense' | 'income' | 'transfer';
  accountIds?: string[];
  /** Leave out transfers between your own accounts (default for category and group views). */
  noTransfers?: boolean;
}

interface Line { transaction_id: string; date: string; amount: number; merchant: string; kind: string }

export function useTxnSheet(): [(q: TxnQuery) => void, ReactElement | null] {
  const [q, setQ] = useState<TxnQuery | null>(null);
  const open = useCallback((x: TxnQuery) => setQ(x), []);
  return [open, q ? <TxnSheet q={q} onClose={() => setQ(null)} /> : null];
}

export function TxnSheet({ q, onClose }: { q: TxnQuery; onClose: () => void }) {
  const t = useTheme();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      let s = supabase.from('transaction_lines').select('transaction_id, date, amount, merchant, kind')
        .gte('date', q.from).lte('date', q.to).order('date', { ascending: false }).limit(1000);
      if (q.category === 'none') s = s.is('category_id', null).neq('kind', 'transfer');
      else if (q.category) s = s.eq('category_id', q.category);
      if (q.categoryIds?.length) s = s.in('category_id', q.categoryIds);
      if (q.group) {
        const { data } = await supabase.from('categories').select('id').eq('group_name', q.group).eq('kind', 'expense');
        s = s.in('category_id', (data ?? []).map((c: any) => c.id));
      }
      if (q.merchant) s = s.eq('merchant', q.merchant);
      if (q.accountIds?.length) s = s.in('account_id', q.accountIds);
      if (q.kind) s = s.eq('kind', q.kind);
      else if (q.noTransfers) s = s.neq('kind', 'transfer');
      const { data, error } = await s;
      if (error) setError(error.message);
      setLines(((data ?? []) as any[]).map((l) => ({ ...l, amount: Number(l.amount) })));
    })();
  }, [q, reload]);

  const money = (lines ?? []).reduce((a, l) => (l.amount < 0 ? { ...a, out: a.out - l.amount } : { ...a, in: a.in + l.amount }), { in: 0, out: 0 });
  return (
    <Sheet title={q.title} onClose={onClose} scroll={false}>
      <View style={[styles.summary, { borderColor: t.line }]}>
        <Text style={{ color: t.muted, fontSize: 12 }}>
          {shortDate(q.from)} {q.from.slice(0, 4)} – {shortDate(q.to)} {q.to.slice(0, 4)} · {lines ? `${lines.length}${lines.length === 1000 ? '+' : ''} transaction${lines.length === 1 ? '' : 's'}` : 'loading…'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {money.out > 0 && <Text style={{ color: t.text, fontWeight: '700' }}>Out {formatMoney(money.out)}</Text>}
          {money.in > 0 && <Text style={{ color: t.positive, fontWeight: '700' }}>In {formatMoney(money.in)}</Text>}
        </View>
      </View>
      {!!error && <Text style={{ color: t.danger, padding: 12 }}>{error}</Text>}
      <FlatList
        data={lines ?? []}
        keyExtractor={(l, i) => `${l.transaction_id}:${i}`}
        ListEmptyComponent={lines ? <Text style={{ color: t.muted, padding: 16 }}>No transactions in this period.</Text> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => { seedTxn({ id: item.transaction_id, date: item.date, amount: item.amount, display_name: item.merchant }); setEditing(item.transaction_id); }} style={({ pressed, hovered }: any) => [styles.row, { borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
            <Text style={{ color: t.muted, width: 52, fontSize: 13 }}>{shortDate(item.date)}</Text>
            <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{item.merchant}</Text>
            <Text style={{ color: item.amount > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(item.amount)}</Text>
          </Pressable>
        )}
      />
      {editing && (
        <Sheet title="Transaction" scroll={false} onClose={() => setEditing(null)}>
          <TransactionEditor key={editing} id={editing} onOpen={setEditing} onDone={() => { setEditing(null); setReload((r) => r + 1); }} />
        </Sheet>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 4, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
});
