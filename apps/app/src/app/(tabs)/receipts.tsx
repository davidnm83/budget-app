// Receipts (TXN-13): the inbox of receipt photos waiting for their transaction, with the matches
// the app suggests once it syncs, and the receipts already attached.
import { formatMoney, shortDate } from '@budget-app/core';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ReceiptForm, ReceiptPhoto } from '@/components/Receipts';
import { EmptyState, PageSkeleton } from '@/components/States';
import { Button, Card, Fab } from '@/components/ui';
import { useFocusLoad } from '@/lib/focusLoad';
import { PAGE_MAX, UNDER_BAR } from '@/lib/layout';
import { usePullRefresh } from '@/lib/pullRefresh';
import { attachReceipt, loadInbox, loadReceipts, updateReceipt, type InboxItem, type Receipt } from '@/lib/receipts';
import { useTheme, type Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';

export default function Receipts() {
  const t = useTheme();
  const [all, setAll] = useState<Receipt[] | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Receipt | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try { const r = await loadReceipts(); setAll(r); setInbox(await loadInbox(r)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setAll([]); }
  }, []);
  useFocusLoad(load);
  usePullRefresh(load);
  const attach = async (r: Receipt, txnId: string) => {
    try { const m = await attachReceipt(r, txnId); toast(m, /rewards/.test(m) ? undefined : { undo: () => updateReceipt(r.id, { transaction_id: null }) }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const attached = (all ?? []).filter((r) => r.transaction_id).slice(0, 40);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {all == null ? <PageSkeleton tiles={0} cards={2} /> : !all.length && !error ? (
          <EmptyState icon="receipt-outline" title="No receipts yet"
            text="Snap a receipt when you pay. Once its transaction syncs, the app suggests the match, so you can categorise or split it with the receipt in front of you."
            action="Add a receipt" onAction={() => setAdding(true)} />
        ) : null}
        {inbox.length > 0 && <Text style={[styles.h, { color: t.muted }]}>Waiting for a transaction · {inbox.length}</Text>}
        {inbox.map(({ receipt: r, matches }) => (
          <Card key={r.id} style={{ gap: 10 }}>
            <Pressable onPress={() => setOpen(r)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <ReceiptPhoto path={r.path} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{r.merchant || 'Receipt'}{r.amount != null ? ` · ${formatMoney(r.amount)}` : ''}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{r.taken_on ? shortDate(r.taken_on) : 'No date'}{r.note ? ` · ${r.note}` : ''}</Text>
              </View>
            </Pressable>
            {matches.length ? matches.map((m) => (
              <View key={m.txnId} style={[styles.match, { borderColor: m.sure ? t.accent : t.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 13 }} numberOfLines={1}>{shortDate(m.txn.date)} · {m.txn.display_name} · {formatMoney(m.txn.amount)}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{m.why}{m.txn.account_name ? ` · ${m.txn.account_name}` : ''}</Text>
                </View>
                <Button title="Attach" kind={m.sure ? 'primary' : 'plain'} onPress={() => attach(r, m.txnId)} />
              </View>
            )) : <Text style={{ color: t.muted, fontSize: 12 }}>{r.amount == null && !r.merchant ? 'Add the total or the store to have it matched.' : 'No matching transaction yet; it usually arrives within a few days.'}</Text>}
          </Card>
        ))}
        {attached.length > 0 && <Text style={[styles.h, { color: t.muted }]}>Attached</Text>}
        {attached.length > 0 && (
          <View style={styles.grid}>
            {attached.map((r) => (
              <Pressable key={r.id} onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: r.transaction_id! } })} style={{ width: 84, gap: 4 }}>
                <ReceiptPhoto path={r.path} size={84} />
                <Text style={{ color: t.muted, fontSize: 11 }} numberOfLines={1}>{r.merchant || (r.taken_on ? shortDate(r.taken_on) : '')}{r.amount != null ? ` ${formatMoney(r.amount)}` : ''}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      <Fab label="Add a receipt" icon="camera-outline" onPress={() => setAdding(true)} />
      {open && <ReceiptForm initial={open} onClose={() => setOpen(null)} onSaved={load} />}
      {adding && <ReceiptForm onClose={() => setAdding(false)} onSaved={load} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: UNDER_BAR + 60, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  h: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  match: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
