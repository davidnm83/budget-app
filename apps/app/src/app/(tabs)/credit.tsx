// Credit cards (VIEW-1): every card's balance, limit and utilisation, what's left on each
// statement and the interest it would cost if unpaid. Tap a card for its full page.
import { TransfersCard } from '@/components/BalanceTransfers';
import { linkTransfers, loadTransfers, type CardTransfer } from '@/lib/balanceTransfers';
import { PAGE_MAX } from '@/lib/layout';
import { EmptyState } from '@/components/States';
import { usePullRefresh } from '@/lib/pullRefresh';
import { bankLogo, customPicture, useLogoVersion } from '@/lib/logos';
import { Logo } from '@/components/Logo';
import { UNDER_BAR } from '@/lib/layout';
import { addDays, cardCycle, cardStatement, transfersOnStatement, formatMoney, shortDate, utilization } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AccountSheet } from '@/components/AccountSheet';
import { PageBoard } from '@/components/PageBoard';
import { PlansCard } from '@/components/PaymentPlans';
import { CreditScoreCard } from '@/components/CreditScore';
import { loadPlans, syncPlans, type CardPlan } from '@/lib/paymentPlans';
import { loadMinimums, ruleFor, type CardMinimum } from '@/lib/cardMinimums';
import { makeEntry } from '@/components/Widgets';
import { Bar, Card } from '@/components/ui';
import { loadAccounts, today } from '@/lib/plan';
import { loadTxnsFor, type Row } from '@/lib/accountTxns';
import { Tile } from '@/components/Tile';
import { useTheme } from '@/lib/theme';
import { bankBalance, signedBalance, type Account } from '@/lib/types';

// Card debt and utilisation over time are Chart widgets now (Card debt; Card utilisation), added from Edit layout.
const CREDIT_DEFAULT = [makeEntry('credit:tiles', { w: 'full' }), makeEntry('credit:cards', { w: 'full' })];
const money0 = (n: number) => formatMoney(n).replace(/\.\d\d$/, '');

export default function Credit() {
  const t = useTheme();
  const lv = useLogoVersion();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Row[]>([]);
  const [open, setOpen] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  const [plans, setPlans] = useState<CardPlan[]>([]);
  const [minimums, setMinimums] = useState<Map<string, CardMinimum>>(new Map());
  const [transfers, setTransfers] = useState<CardTransfer[]>([]);
  const load = useCallback(async () => {
    try {
      const all = await loadAccounts();
      const cards = all.filter((a) => a.type === 'credit');
      setAccounts(all);
      // Payment plans: write any instalment that has come due since last time, then read the cards' transactions.
      const ps = await loadPlans();
      setPlans(ps);
      await syncPlans(ps).catch(() => 0);
      // Balance transfers: link the transactions the banks have listed since last time.
      const bt = await loadTransfers();
      await linkTransfers(bt).catch(() => false);
      setTransfers([...bt]);
      loadMinimums().then(setMinimums);
      setTxns(await loadTxnsFor(cards.map((c) => c.id), addDays(today(), -400)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); setRefresh((r) => r + 1); }, [load]));
  usePullRefresh(load);

  const now = today();
  const cards = accounts.filter((a) => a.type === 'credit');
  const owedOf = (a: Account) => Math.max(0, -signedBalance(a));
  // Owed in all: each card's balance already includes plans the bank shows apart from it.
  const onPlans = cards.reduce((s, a) => s + (a.off_balance ?? 0), 0);
  const totalOwed = cards.reduce((s, a) => s + owedOf(a), 0);
  const withLimit = cards.filter((a) => a.credit_limit);
  const totalLimit = withLimit.reduce((s, a) => s + Number(a.credit_limit), 0);
  const util = totalLimit ? withLimit.reduce((s, a) => s + owedOf(a), 0) / totalLimit : null;

  const perCard = useMemo(() => cards.map((a) => {
    const mine = txns.filter((x) => x.account_id === a.id);
    const owed = owedOf(a), bankOwed = Math.max(0, -bankBalance(a));
    const cycle = a.statement_day && a.due_day ? cardCycle(now, a.statement_day, a.due_day) : null;
    // The part of the balance on payment plans that isn't billed yet isn't part of what the statement asks for.
    // The statement: from the bank's own balance, leaving out plans and promo balance transfers not billed yet.
    const st = cycle ? cardStatement(bankOwed, mine, cycle.lastClose, cycle.cycleDays, a.apr ?? null, plans.filter((p) => p.accountId === a.id),
      transfersOnStatement(transfers.filter((x) => x.toAccountId === a.id && !x.closedOn), owed, cycle.lastClose, now), ruleFor(minimums, a.id)) : null;
    return { a, owed, u: utilization(owed, a.credit_limit), cycle, st };
  }).sort((x, y) => y.owed - x.owed), [cards, txns, now, plans, transfers, minimums]);

  const interestDue = perCard.reduce((s, c) => s + (c.st && c.st.leftToPay > 0 ? c.st.interestIfUnpaid ?? 0 : 0), 0);
  const nextDue = perCard.filter((c) => c.st && c.st.leftToPay > 0 && c.cycle).sort((x, y) => x.cycle!.due.localeCompare(y.cycle!.due))[0];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <PageBoard page="credit" refresh={refresh} defaults={CREDIT_DEFAULT} blocks={[
        { key: 'credit:tiles', title: 'Card totals', about: 'Total owing, utilisation, next due and interest', render: () => (
          <View style={styles.tiles}>
        <Tile t={t} label="Total owing" value={money0(totalOwed)} sub={onPlans > 0 ? `${cards.length} cards · ${money0(onPlans)} on plans` : `${cards.length} cards`} />
        <Tile t={t} label="Utilisation" value={util != null ? `${Math.round(util * 100)}%` : '–'} sub={totalLimit ? `of ${money0(totalLimit)} limit` : 'add limits'}
          color={util == null ? undefined : util > 0.7 ? t.danger : util > 0.3 ? t.series2 : t.accent} />
        <Tile t={t} label="Next due" value={nextDue ? formatMoney(nextDue.st!.leftToPay) : '–'} sub={nextDue ? `${nextDue.a.name} · ${shortDate(nextDue.cycle!.due)}` : 'nothing owing'} />
        <Tile t={t} label="Interest if unpaid" value={formatMoney(interestDue)} sub="this cycle, est." color={interestDue > 0 ? t.series2 : undefined} />
      </View>
        ) },
        { key: 'credit:cards', title: 'Your cards', about: 'Each card’s balance, limit and statement', render: () => (
          <Card style={{ padding: 0 }}>
        {perCard.map((c, i) => (
          <Pressable key={c.a.id} onPress={() => setOpen(c.a)} style={({ pressed, hovered }: any) => [styles.card, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
            <View style={styles.between}>
              <Logo size={26} name={c.a.name} uri={customPicture(`account:${c.a.id}`, lv) ?? (c.a.icon ? null : bankLogo(c.a.name, lv))} emoji={c.a.icon ?? '💳'} />
              <Text style={{ color: t.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{c.a.name}{c.a.mask ? ` ••${c.a.mask}` : ''}</Text>
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
                  : c.st!.minimumLeft
                    ? `Minimum ≈ ${formatMoney(c.st!.minimumLeft)} due ${shortDate(c.cycle.due)} (the statement is on a balance transfer) · ${formatMoney(c.st!.spentThisCycle)} this cycle`
                    : `Statement paid · ${formatMoney(c.st!.spentThisCycle)} this cycle, closes ${shortDate(c.cycle.nextClose)}`}
            </Text>
          </Pressable>
        ))}
        {!cards.length && <EmptyState icon="card-outline" title="No credit cards yet" text="Cards you link or add show their balance, limit and statement here." />}
      </Card>
        ) },
      ]} />
      <PlansCard t={t} plans={plans} accounts={accounts} onChanged={load} />
      <TransfersCard t={t} transfers={transfers} accounts={accounts} onChanged={load} />
      <CreditScoreCard refresh={refresh} />
      <AccountSheet account={open} accounts={accounts} onClose={() => setOpen(null)} onChanged={load} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { gap: 5, paddingHorizontal: 12, paddingVertical: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
