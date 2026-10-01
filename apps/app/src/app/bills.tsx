// Bills & income (BIL): this month's due dates, paid or upcoming, matched to transactions
// automatically; the list of schedules; and suggestions spotted in your history.
import { PAGE_MAX } from '@/lib/layout';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDays, addMonths, daysBetween, detectRecurring, formatMoney, matchDues, monthEnd, monthName, monthOf, normalizeDescription,
  occurrences, shortDate, type Recurring, type RecurringSuggestion,
} from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BillForm } from '@/components/Forms';
import { Button, Card, Empty, Segmented, Stepper } from '@/components/ui';
import { loadAccounts, loadPosted, loadRecurring, today } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import type { Account } from '@/lib/types';

const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' } as const;

interface Due { key: string; bill: Recurring; date: string; txn: { date: string; amount: number } | null }

export default function Bills() {
  const t = useTheme();
  const [view, setView] = useState<'month' | 'all' | 'suggest'>('month');
  const [month, setMonth] = useState(monthOf(today()));
  const [bills, setBills] = useState<Recurring[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; group_name: string; icon: string | null }[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [suggestions, setSuggestions] = useState<RecurringSuggestion[] | null>(null);
  const [editing, setEditing] = useState<Partial<Recurring> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [b, a, c] = await Promise.all([
        loadRecurring(), loadAccounts(),
        supabase.from('categories').select('id, name, group_name, icon').eq('is_hidden', false).order('sort').then((r) => r.data ?? []),
      ]);
      setBills(b); setAccounts(a); setCats(c);
      // This month's due dates, each matched to the transaction that paid it (BIL-5).
      const end = monthEnd(month);
      const list = b.filter((x) => x.active).flatMap((bill) => occurrences(bill, month, end).map((date) => ({ key: `${bill.id}|${date}`, bill, date })));
      const ids = [...new Set(b.map((x) => x.account_id).filter(Boolean) as string[])];
      const posted = await loadPosted(ids.length ? ids : a.map((x) => x.id), addDays(month, -5), addDays(end, 5));
      const m = matchDues(list.map((d) => ({ key: d.key, date: d.date, amount: d.bill.amount, accountId: d.bill.account_id, matchText: d.bill.match_text, estimated: d.bill.estimated })), posted);
      const byId = new Map(posted.map((p) => [p.id, p]));
      setDues(list.map((d) => ({ ...d, txn: m.has(d.key) ? byId.get(m.get(d.key)!)! : null })).sort((x, y) => x.date.localeCompare(y.date)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // BIL-2: look through the last 6 months for things that repeat and aren't bills yet.
  const findSuggestions = async () => {
    setSuggestions(null); setView('suggest');
    const now = today();
    const rows: any[] = [];
    for (let p = 0; ; p += 1000) {
      const { data } = await supabase.from('transaction_list').select('date, amount, display_name, name, account_id, category_id, is_transfer')
        .gte('date', addMonths(monthOf(now), -6)).order('date').range(p, p + 999);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const known = bills.map((b) => normalizeDescription(b.match_text || b.name));
    const found = detectRecurring(rows.filter((r) => !r.is_transfer || Number(r.amount) < 0)
      .map((r) => ({ date: r.date, amount: Number(r.amount), merchant: r.display_name, name: r.name, account_id: r.account_id, category_id: r.category_id })), now)
      .filter((s) => !known.some((k) => k && (normalizeDescription(s.match_text).includes(k) || k.includes(normalizeDescription(s.match_text)))));
    setSuggestions(found);
  };

  const now = today();
  const billsDue = dues.filter((d) => d.bill.kind === 'bill');
  const incomeDue = dues.filter((d) => d.bill.kind === 'income');
  const toPay = billsDue.filter((d) => !d.txn).reduce((s, d) => s - d.bill.amount, 0);
  const totalBills = billsDue.reduce((s, d) => s - (d.txn ? d.txn.amount : d.bill.amount), 0);
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? 'Any account';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Segmented value={view} onChange={(v) => (v === 'suggest' ? findSuggestions() : setView(v))}
          options={[{ value: 'month', label: 'This month' }, { value: 'all', label: 'All' }, { value: 'suggest', label: 'Suggestions' }]} />
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}

        {view === 'month' && (
          <>
            <Stepper label={monthName(month)} onPrev={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} />
            <View style={styles.tiles}>
              <Tile t={t} label="Still to pay" value={formatMoney(toPay)} strong />
              <Tile t={t} label="Bills this month" value={formatMoney(totalBills)} />
              <Tile t={t} label="Income expected" value={formatMoney(incomeDue.reduce((s, d) => s + (d.txn ? d.txn.amount : d.bill.amount), 0))} />
            </View>
            {!bills.length && (
              <Card style={{ gap: 8 }}>
                <Text style={{ color: t.text }}>No bills yet. Add them one by one, or let the app look through your history for ones that repeat.</Text>
                <Button title="Find recurring bills and income" onPress={findSuggestions} />
              </Card>
            )}
            {billsDue.length > 0 && <Section t={t} title="Bills" dues={billsDue} now={now} accountName={accountName} onEdit={(b) => setEditing(b)} />}
            {incomeDue.length > 0 && <Section t={t} title="Income" dues={incomeDue} now={now} accountName={accountName} onEdit={(b) => setEditing(b)} />}
          </>
        )}

        {view === 'all' && (
          bills.length ? (
            <Card style={{ padding: 0 }}>
              {bills.map((b, i) => (
                <Pressable key={b.id} onPress={() => setEditing(b)} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text }} numberOfLines={1}>{b.name}{!b.active ? ' (paused)' : ''}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>
                      {FREQ_LABEL[b.frequency]} from {shortDate(b.start_date)}{b.end_date ? ` until ${shortDate(b.end_date)} ${b.end_date.slice(0, 4)}` : ''} · {accountName(b.account_id)}
                    </Text>
                  </View>
                  <Text style={{ color: b.amount > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{b.estimated ? '≈ ' : ''}{formatMoney(b.amount)}</Text>
                </Pressable>
              ))}
            </Card>
          ) : <Empty text="No bills or income yet." />
        )}

        {view === 'suggest' && (
          suggestions == null ? <Text style={{ color: t.muted }}>Looking through the last 6 months…</Text>
          : suggestions.length ? (
            <>
              <Text style={{ color: t.muted, fontSize: 13 }}>These repeat at a steady interval. Tap one to check the details and add it.</Text>
              <Card style={{ padding: 0 }}>
                {suggestions.map((s, i) => (
                  <Pressable key={`${s.account_id}|${s.name}|${s.kind}`} onPress={() => setEditing({ ...s, start_date: nextDue(s) })}
                    style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }]}>
                    <Ionicons name="add-circle-outline" size={22} color={t.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text }} numberOfLines={1}>{s.name}</Text>
                      <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{FREQ_LABEL[s.frequency]} · seen {s.seen}× · last {shortDate(s.start_date)} · {accountName(s.account_id)}</Text>
                    </View>
                    <Text style={{ color: s.amount > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{s.estimated ? '≈ ' : ''}{formatMoney(s.amount)}</Text>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : <Empty text="Nothing new found. Everything that repeats is already a bill." />
        )}
      </ScrollView>

      <Pressable onPress={() => setEditing({ kind: 'bill', frequency: 'monthly', start_date: now })} style={[styles.fab, { backgroundColor: t.accent }]} accessibilityLabel="Add a bill or income">
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
      {editing && <BillForm initial={editing} accounts={accounts} categories={cats} onClose={() => setEditing(null)}
        onSaved={() => { load(); if (view === 'suggest') setSuggestions((s) => s?.filter((x) => x.name !== editing.name) ?? null); }} />}
    </View>
  );
}

/** A suggestion's next due date: step its schedule forward from the last time it happened. */
function nextDue(s: RecurringSuggestion): string {
  const next = occurrences({ frequency: s.frequency, start_date: s.start_date, end_date: null }, addDays(today(), 0), addDays(today(), 400))[0];
  return next ?? s.start_date;
}

function Section({ t, title, dues, now, accountName, onEdit }: {
  t: Theme; title: string; dues: Due[]; now: string; accountName: (id: string | null) => string; onEdit: (b: Recurring) => void;
}) {
  return (
    <>
      <Text style={[styles.h, { color: t.muted }]}>{title}</Text>
      <Card style={{ padding: 0 }}>
        {dues.map((d, i) => {
          const days = daysBetween(now, d.date);
          const status = d.txn ? `Paid ${shortDate(d.txn.date)}` : days < 0 ? `Overdue ${-days}d` : days === 0 ? 'Due today' : `In ${days}d`;
          return (
            <Pressable key={d.key} onPress={() => onEdit(d.bill)} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }]}>
              <Ionicons name={d.txn ? 'checkmark-circle' : days < 0 ? 'alert-circle' : 'ellipse-outline'} size={20} color={d.txn ? t.accent : days < 0 ? t.danger : t.muted} />
              <Text style={{ color: t.muted, width: 48, fontSize: 13 }}>{shortDate(d.date)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }} numberOfLines={1}>{d.bill.name}</Text>
                <Text style={{ color: d.txn ? t.muted : days < 0 ? t.danger : t.muted, fontSize: 12 }} numberOfLines={1}>{status} · {accountName(d.bill.account_id)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(d.txn ? d.txn.amount : d.bill.amount)}</Text>
                {d.txn && Math.abs(d.txn.amount - d.bill.amount) >= 0.01 && (
                  <Text style={{ color: t.muted, fontSize: 11 }}>expected {formatMoney(d.bill.amount)}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </Card>
    </>
  );
}

function Tile({ t, label, value, strong }: { t: Theme; label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={{ color: t.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: strong ? 18 : 15, fontWeight: strong ? '700' : '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, paddingBottom: 96, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  h: { fontSize: 12, fontWeight: '600', marginTop: 6, letterSpacing: 0.5, textTransform: 'uppercase' },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
});
