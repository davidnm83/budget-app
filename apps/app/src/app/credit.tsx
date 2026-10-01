// Credit cards (VIEW-1): every card's balance, limit and utilisation, what's left on each
// statement and the interest it would cost if unpaid, plus total card debt and utilisation over
// the past year. Tap a card for its full page.
import { addDays, balanceHistory, cardCycle, cardStatus, formatMoney, shortDate, utilization } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AccountSheet, BalanceChart } from '@/components/AccountSheet';
import { Bar, Card } from '@/components/ui';
import { loadAccounts, today } from '@/lib/plan';
import { loadTxnsFor, type Row } from '@/lib/accountTxns';
import { Tile } from '@/components/Tile';
import { useTheme } from '@/lib/theme';
import { signedBalance, type Account } from '@/lib/types';

const money0 = (n: number) => formatMoney(n).replace(/\.\d\d$/, '');

export default function Credit() {
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Row[]>([]);
  const [open, setOpen] = useState<Account | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const all = await loadAccounts();
      const cards = all.filter((a) => a.type === 'credit');
      setAccounts(all);
      setTxns(await loadTxnsFor(cards.map((c) => c.id), addDays(today(), -400)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const now = today();
  const cards = accounts.filter((a) => a.type === 'credit');
  const owedOf = (a: Account) => Math.max(0, -signedBalance(a));
  const totalOwed = cards.reduce((s, a) => s + owedOf(a), 0);
  const withLimit = cards.filter((a) => a.credit_limit);
  const totalLimit = withLimit.reduce((s, a) => s + Number(a.credit_limit), 0);
  const util = totalLimit ? withLimit.reduce((s, a) => s + owedOf(a), 0) / totalLimit : null;

  const perCard = useMemo(() => cards.map((a) => {
    const mine = txns.filter((x) => x.account_id === a.id);
    const owed = owedOf(a);
    const cycle = a.statement_day && a.due_day ? cardCycle(now, a.statement_day, a.due_day) : null;
    const st = cycle ? cardStatus(owed, mine, cycle.lastClose, cycle.cycleDays, a.apr ?? null) : null;
    return { a, owed, u: utilization(owed, a.credit_limit), cycle, st, history: balanceHistory(signedBalance(a), mine, now, 53, 7) };
  }).sort((x, y) => y.owed - x.owed), [cards, txns, now]);

  // Total card debt, weekly for the past year (as a positive amount owed).
  const debtTrend = useMemo(() => {
    if (!perCard.length) return [];
    return perCard[0].history.map((p, i) => ({ date: p.date, balance: Math.round(perCard.reduce((s, c) => s + Math.max(0, -(c.history[i]?.balance ?? 0)), 0) * 100) / 100 }));
  }, [perCard]);
  // Utilisation at each month end (cards with a limit only).
  const utilTrend = useMemo(() => {
    if (!totalLimit || !perCard.length) return [];
    const pts = perCard[0].history.map((p, i) => ({ date: p.date, i }));
    const monthEnds = pts.filter((p, k) => k === pts.length - 1 || pts[k + 1].date.slice(0, 7) !== p.date.slice(0, 7)).slice(-12);
    return monthEnds.map(({ date, i }) => ({
      date, u: perCard.filter((c) => c.a.credit_limit).reduce((s, c) => s + Math.max(0, -(c.history[i]?.balance ?? 0)), 0) / totalLimit,
    }));
  }, [perCard, totalLimit]);
  const interestDue = perCard.reduce((s, c) => s + (c.st && c.st.leftToPay > 0 ? c.st.interestIfUnpaid ?? 0 : 0), 0);
  const nextDue = perCard.filter((c) => c.st && c.st.leftToPay > 0 && c.cycle).sort((x, y) => x.cycle!.due.localeCompare(y.cycle!.due))[0];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <View style={styles.tiles}>
        <Tile t={t} label="Total owing" value={money0(totalOwed)} sub={`${cards.length} cards`} />
        <Tile t={t} label="Utilisation" value={util != null ? `${Math.round(util * 100)}%` : '–'} sub={totalLimit ? `of ${money0(totalLimit)} limit` : 'add limits'}
          color={util == null ? undefined : util > 0.7 ? t.danger : util > 0.3 ? t.series2 : t.accent} />
        <Tile t={t} label="Next due" value={nextDue ? formatMoney(nextDue.st!.leftToPay) : '–'} sub={nextDue ? `${nextDue.a.name} · ${shortDate(nextDue.cycle!.due)}` : 'nothing owing'} />
        <Tile t={t} label="Interest if unpaid" value={formatMoney(interestDue)} sub="this cycle, est." color={interestDue > 0 ? t.series2 : undefined} />
      </View>

      <Card style={{ padding: 0 }}>
        {perCard.map((c, i) => (
          <Pressable key={c.a.id} onPress={() => setOpen(c.a)} style={({ pressed }) => [styles.card, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, pressed && { backgroundColor: t.line }]}>
            <View style={styles.between}>
              <Text style={{ color: t.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{c.a.icon ?? '💳'}  {c.a.name}{c.a.mask ? ` ••${c.a.mask}` : ''}</Text>
              <Text style={{ color: t.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(c.owed)}</Text>
            </View>
            {c.u != null && (
              <>
                <Bar value={c.owed} max={Number(c.a.credit_limit)} color={c.u > 0.7 ? t.danger : c.u > 0.3 ? t.series2 : t.accent} />
                <Text style={{ color: t.muted, fontSize: 12 }}>{Math.round(c.u * 100)}% of {money0(Number(c.a.credit_limit))}</Text>
              </>
            )}
            <Text style={{ color: c.st && c.st.leftToPay > 0 && c.cycle!.daysToDue <= 3 ? t.danger : t.muted, fontSize: 12 }}>
              {!c.cycle ? 'Set the closing and due days on the card to see what’s due.'
                : c.st!.leftToPay > 0
                  ? `${formatMoney(c.st!.leftToPay)} left on the statement, due ${shortDate(c.cycle.due)}${c.st!.interestIfUnpaid != null ? ` · ≈ ${formatMoney(c.st!.interestIfUnpaid)} interest if unpaid` : ''}`
                  : `Statement paid · ${formatMoney(c.st!.spentThisCycle)} this cycle, closes ${shortDate(c.cycle.nextClose)}`}
            </Text>
          </Pressable>
        ))}
        {!cards.length && <Text style={{ color: t.muted, padding: 12 }}>No credit cards yet.</Text>}
      </Card>

      {debtTrend.length > 1 && <Card><BalanceChart t={t} points={debtTrend} title="TOTAL CARD DEBT, PAST YEAR" /></Card>}

      {utilTrend.length > 1 && (
        <Card style={{ gap: 6 }}>
          <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>UTILISATION AT MONTH END</Text>
          <View style={styles.utilChart}>
            {utilTrend.map((p) => (
              <View key={p.date} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Text style={{ color: t.muted, fontSize: 9 }}>{Math.round(p.u * 100)}%</Text>
                <View style={{ flex: 1, width: '70%', justifyContent: 'flex-end' }}>
                  <View style={{ height: `${Math.min(100, p.u * 100)}%`, backgroundColor: p.u > 0.7 ? t.danger : p.u > 0.3 ? t.series2 : t.accent, borderRadius: 2 }} />
                </View>
                <Text style={{ color: t.muted, fontSize: 9 }}>{new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' })}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: t.muted, fontSize: 11 }}>Under 30% is generally better for your credit score. Uses today’s limits.</Text>
        </Card>
      )}
      <AccountSheet account={open} accounts={accounts} onClose={() => setOpen(null)} onChanged={load} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  card: { gap: 5, paddingHorizontal: 12, paddingVertical: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  utilChart: { height: 110, flexDirection: 'row', gap: 3 },
});
