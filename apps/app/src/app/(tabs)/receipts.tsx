// Receipts (TXN-13): the inbox of receipt photos waiting for their transaction, with the matches
// the app suggests once it syncs, and the receipts already attached.
import { formatMoney, monthName, shortDate } from '@budget-app/core';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const attached = (all ?? []).filter((r) => r.transaction_id);

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
        {attached.length > 0 && <Archive t={t} receipts={attached} />}
      </ScrollView>
      <Fab label="Add a receipt" icon="camera-outline" onPress={() => setAdding(true)} />
      {open && <ReceiptForm initial={open} onClose={() => setOpen(null)} onSaved={load} />}
      {adding && <ReceiptForm onClose={() => setAdding(false)} onSaved={load} />}
    </View>
  );
}

/**
 * Receipts already attached, newest first, a month at a time: store, date and amount, with a small photo. Search by
 * store, note, amount or date; more load as you go. Tapping one opens its transaction.
 */
function Archive({ t, receipts }: { t: Theme; receipts: Receipt[] }) {
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const when = (r: Receipt) => r.taken_on ?? r.created_at.slice(0, 10);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r: Receipt) => [r.merchant, r.note, r.amount != null ? formatMoney(r.amount) : '', r.amount != null ? r.amount.toFixed(2) : '', when(r), shortDate(when(r)), monthName(when(r).slice(0, 8) + '01')]
    .filter(Boolean).join(' ').toLowerCase().replace(/,/g, '');
  const found = receipts.filter((r) => words.every((w) => hay(r).includes(w.replace(/,/g, '')))).sort((a, b) => when(b).localeCompare(when(a)));
  const page = found.slice(0, shown);
  const months: { month: string; list: Receipt[] }[] = [];
  for (const r of page) {
    const m = when(r).slice(0, 7);
    if (months[months.length - 1]?.month !== m) months.push({ month: m, list: [] });
    months[months.length - 1].list.push(r);
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.h, { color: t.muted }]}>Archive · {receipts.length}</Text>
      <TextInput value={q} onChangeText={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search by store, amount, date or note" placeholderTextColor={t.muted}
        style={[styles.search, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} accessibilityLabel="Search receipts" />
      {!found.length && <Text style={{ color: t.muted }}>No receipts match “{q.trim()}”.</Text>}
      {months.map(({ month, list }) => (
        <Card key={month} style={{ padding: 0 }}>
          <View style={[styles.monthHead, { borderColor: t.line }]}>
            <Text style={{ color: t.text, fontWeight: '600' }}>{monthName(month + '-01')}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{list.length} · {formatMoney(list.reduce((s, r) => s + (r.amount ?? 0), 0))}</Text>
          </View>
          {list.map((r) => (
            <Pressable key={r.id} onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: r.transaction_id! } })}
              style={({ hovered, pressed }: any) => [styles.archiveRow, { borderColor: t.line }, (hovered || pressed) && { backgroundColor: t.line }]}>
              <ReceiptPhoto path={r.path} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }} numberOfLines={1}>{r.merchant || 'Receipt'}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{shortDate(when(r))}{r.note ? ` · ${r.note}` : ''}</Text>
              </View>
              <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{r.amount != null ? formatMoney(r.amount) : ''}</Text>
            </Pressable>
          ))}
        </Card>
      ))}
      {found.length > shown && <Button title={`Show more (${found.length - shown} older)`} kind="plain" onPress={() => setShown((n) => n + PAGE)} />}
    </View>
  );
}
const PAGE = 30;

const styles = StyleSheet.create({
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  monthHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  page: { padding: 16, gap: 12, paddingBottom: UNDER_BAR + 60, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  h: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  match: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
});
