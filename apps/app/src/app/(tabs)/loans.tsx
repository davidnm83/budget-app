// Loans (car loan, student loan): balance, payoff estimate, interest and payments to date, the
// balance over the past year, and the payments and interest entries themselves.
import { PAGE_MAX } from '@/lib/layout';
import { addDays, balanceHistory, formatMoney, isInterestRow, shortDate } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AccountSheet, BalanceChart, LoanBlock } from '@/components/AccountSheet';
import { PageBoard } from '@/components/PageBoard';
import { makeEntry } from '@/components/Widgets';
import { useTxnSheet } from '@/components/TxnSheet';
import { Button, Card, Segmented } from '@/components/ui';
import { loadTxnsFor, type Row } from '@/lib/accountTxns';
import { loadAccounts, today } from '@/lib/plan';
import { useTheme, type Theme } from '@/lib/theme';
import { signedBalance, type Account } from '@/lib/types';

const LOANS_DEFAULT = [makeEntry('loan:summary', { w: 'full' }), makeEntry('loan:chart', { w: 'full' }), 'loan:payments', 'loan:interest'];

export default function Loans() {
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Row[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [showTxns, txnSheet] = useTxnSheet();

  const load = useCallback(async () => {
    try {
      const all = await loadAccounts();
      const loans = all.filter((a) => a.type === 'loan');
      setAccounts(all);
      setTxns(await loadTxnsFor(loans.map((l) => l.id), '1900-01-01'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); setRefresh((r) => r + 1); }, [load]));

  // Car loans first: that's what this page is mostly for.
  const loans = accounts.filter((a) => a.type === 'loan')
    .sort((a, b) => Number(/auto|car|escape|vehicle/i.test(b.name)) - Number(/auto|car|escape|vehicle/i.test(a.name)) || a.name.localeCompare(b.name));
  const loan = loans.find((l) => l.id === pick) ?? loans[0];
  const mine = useMemo(() => (loan ? txns.filter((x) => x.account_id === loan.id).map((x) => ({ date: x.date, amount: x.amount, name: x.name ?? '' })) : []), [loan, txns]);
  const now = today();

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {loans.length > 1 && <Segmented value={loan?.id ?? ''} onChange={setPick} options={loans.map((l) => ({ value: l.id, label: l.name }))} />}
      {!loan && <Card><Text style={{ color: t.muted }}>No loan accounts yet.</Text></Card>}
      {loan && (
        <>
          <PageBoard page="loans" refresh={refresh} defaults={LOANS_DEFAULT} blocks={[
            { key: 'loan:summary', title: 'Loan summary', about: 'What’s owing, the payoff estimate, interest and payments so far', render: () => (
              <View style={{ gap: 10 }}>
                <Pressable onPress={() => setOpen(loan)}>
                  <Text style={{ color: t.muted, fontSize: 12 }}>OWING · {loan.name}{loan.mask ? ` ••${loan.mask}` : ''}</Text>
                  <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(Math.abs(signedBalance(loan)))}</Text>
                  <Text style={{ color: t.accent, fontSize: 12 }}>Account details and payment settings ›</Text>
                </Pressable>
                <LoanBlock t={t} a={loan} txns={mine} />
              </View>
            ) },
            { key: 'loan:chart', title: 'Balance, past year', about: 'The loan balance week by week', render: () => (mine.length > 0 ? (
              <Card><BalanceChart t={t} points={balanceHistory(signedBalance(loan), mine.filter((x) => x.date >= addDays(now, -371)), now, 53, 7)}
                onPick={(from, to) => showTxns({ title: `${loan.name} · week of ${shortDate(from)}`, from, to, accountIds: [loan.id] })} /></Card>
            ) : null) },
            { key: 'loan:payments', title: 'Payments', about: 'Every payment made on the loan', render: () => <List t={t} title="Payments" rows={mine.filter((x) => x.amount > 0)} /> },
            { key: 'loan:interest', title: 'Interest', about: 'Interest charged on the loan', render: () => <List t={t} title="Interest" rows={mine.filter((x) => x.amount < 0 && isInterestRow(x.name))} /> },
          ]} />
        </>
      )}
      {txnSheet}
      <AccountSheet account={open} accounts={accounts} onClose={() => setOpen(null)} onChanged={load} />
    </ScrollView>
  );
}

function List({ t, title, rows }: { t: Theme; title: string; rows: { date: string; amount: number; name: string }[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Card style={{ padding: 0 }}>
      <View style={[styles.head, { borderColor: t.line }]}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, flex: 1 }}>{title.toUpperCase()} · {rows.length}</Text>
        <Text style={{ color: t.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(Math.abs(total))}</Text>
      </View>
      {(all ? sorted : sorted.slice(0, 8)).map((r, i) => (
        <View key={i} style={[styles.row, { borderColor: t.line }]}>
          <Text style={{ color: t.muted, width: 84, fontSize: 13 }}>{shortDate(r.date)} {r.date.slice(0, 4)}</Text>
          <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{r.name}</Text>
          <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{formatMoney(Math.abs(r.amount))}</Text>
        </View>
      ))}
      {!rows.length && <Text style={{ color: t.muted, padding: 12 }}>None yet.</Text>}
      {sorted.length > 8 && <Button title={all ? 'Show fewer' : `Show all ${sorted.length}`} kind="plain" onPress={() => setAll(!all)} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 12, paddingBottom: 48, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
