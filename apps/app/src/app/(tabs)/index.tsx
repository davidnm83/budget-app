// Home: the morning check in one screen (BUD-3).
//   1. To review: how many new transactions are waiting
//   2. This week: cash in the bill-paying accounts, projected end of week, any warning, what's next
//   3. Budget pace: spent vs where you'd expect to be by today, and the categories running ahead
//   4. Net worth: today and the change since the 1st
// Each card is a block that can move onto custom pages later.
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDays, buildBudgetMonth, formatMoney, monthEnd, monthName, shortDate, weekStart as mondayOf,
  type BudgetLine,
} from '@budget-app/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/TopBar';
import { Bar } from '@/components/ui';
import { loadWeek, today, type PlannerData } from '@/lib/plan';
import { loadBudgets, loadCategories, loadCategoryMonths, thisMonth, totalsFor } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { signedBalance } from '@/lib/types';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface HomeData {
  toReview: number;
  week: PlannerData;
  budget: { spent: number; budgeted: number; pace: number; ahead: (BudgetLine & { gap: number })[]; hasBudget: boolean };
  net: { now: number; change: number; assets: number; debts: number };
}

export default function Home() {
  const t = useTheme();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const now = today();
      const month = thisMonth();
      const [review, week, cats, budgets, rows] = await Promise.all([
        supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('reviewed', false),
        loadWeek(mondayOf(now), null),
        loadCategories(), loadBudgets(), loadCategoryMonths(month, month),
      ]);

      // Budget pace: how far through the month we are vs how much of the budget is spent.
      const view = buildBudgetMonth(cats, budgets.filter((b) => b.month === month), totalsFor(rows, month));
      const pace = Number(now.slice(8, 10)) / Number(monthEnd(month).slice(8, 10));
      const ahead = view.expenses
        .map((l) => ({ ...l, gap: l.actual - l.available * pace }))
        .filter((l) => l.gap > 1).sort((a, b) => b.gap - a.gap).slice(0, 3);

      // Net worth now, and on the 1st (today's balances minus what posted since).
      const visible = week.accounts.filter((a) => !a.is_hidden);
      const ids = visible.map((a) => a.id);
      const since: { account_id: string; amount: number }[] = [];
      for (let p = 0; ; p += 1000) {
        const { data } = await supabase.from('transactions').select('account_id, amount').in('account_id', ids).gte('date', month).range(p, p + 999);
        since.push(...(data ?? []).map((r) => ({ account_id: r.account_id, amount: Number(r.amount) })));
        if (!data || data.length < 1000) break;
      }
      const nowTotal = visible.reduce((s, a) => s + signedBalance(a), 0);
      const changed = since.reduce((s, r) => s + r.amount, 0);
      setData({
        toReview: review.count ?? 0,
        week,
        budget: { spent: view.totals.actualExpenses, budgeted: view.totals.budgetedExpenses, pace, ahead, hasBudget: view.expenses.length > 0 },
        net: {
          now: nowTotal, change: changed,
          assets: visible.filter((a) => signedBalance(a) > 0).reduce((s, a) => s + signedBalance(a), 0),
          debts: visible.filter((a) => signedBalance(a) < 0).reduce((s, a) => s - signedBalance(a), 0),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const now = today();
  const d = new Date(now + 'T00:00:00Z');
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar>
        <View>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{DAYS[d.getUTCDay()]}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{monthName(now.slice(0, 7) + '-01', false)} {d.getUTCDate()}</Text>
        </View>
      </TopBar>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {data && (
          <>
            <ReviewCard t={t} n={data.toReview} />
            <WeekCard t={t} data={data.week} now={now} />
            <BudgetCard t={t} b={data.budget} />
            <NetWorthCard t={t} n={data.net} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CardShell({ t, title, link, onPress, children }: { t: Theme; title: string; link?: string; onPress?: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.between}>
        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>{title.toUpperCase()}</Text>
        {link && <Text style={{ color: t.accent, fontSize: 12 }}>{link} ›</Text>}
      </View>
      {children}
    </Pressable>
  );
}

function ReviewCard({ t, n }: { t: Theme; n: number }) {
  return (
    <CardShell t={t} title="To review" link={n ? 'Review' : undefined} onPress={() => router.navigate('/transactions?mode=review' as any)}>
      {n ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>{n}</Text>
          <Text style={{ color: t.muted }}>new transaction{n === 1 ? '' : 's'} to check</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="checkmark-circle" size={22} color={t.accent} />
          <Text style={{ color: t.text }}>All caught up</Text>
        </View>
      )}
    </CardShell>
  );
}

function WeekCard({ t, data, now }: { t: Theme; data: PlannerData; now: string }) {
  const v = data.view;
  const plan = data.accounts.filter((a) => a.plan_include);
  if (!plan.length) {
    return (
      <CardShell t={t} title="This week" link="Planner" onPress={() => router.navigate('/planner')}>
        <Text style={{ color: t.muted }}>Turn on “Plan bills from this account” for your chequing accounts to see the week here.</Text>
      </CardShell>
    );
  }
  const cash = plan.reduce((s, a) => s + signedBalance(a), 0);
  const next = v.days.flatMap((d) => d.rows).filter((r) => r.kind === 'planned' && r.actual == null && r.date >= now).slice(0, 3);
  const w = v.warnings[0];
  const name = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  return (
    <CardShell t={t} title="This week" link="Planner" onPress={() => router.navigate('/planner')}>
      <View style={styles.tiles}>
        <Mini t={t} label="Cash now" value={money0(cash)} sub={plan.length > 1 ? `${plan.length} accounts` : plan[0].name} />
        <Mini t={t} label={`By ${shortDate(addDays(mondayOf(now), 6))}`} value={money0(v.endBalance)} sub="projected" warn={!!w} />
      </View>
      {w && (
        <View style={styles.row}>
          <Ionicons name="warning" size={16} color={t.danger} />
          <Text style={{ color: t.danger, fontSize: 13, flex: 1 }}>{name(w.accountId)} drops to {formatMoney(w.balance)} on {shortDate(w.date)} after “{w.cause}”.</Text>
        </View>
      )}
      {next.length ? next.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={{ color: t.muted, width: 48, fontSize: 13 }}>{r.date === now ? 'Today' : shortDate(r.date)}</Text>
          <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{r.description}</Text>
          <Text style={{ color: r.counted > 0 ? t.positive : t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{formatMoney(r.counted)}</Text>
        </View>
      )) : <Text style={{ color: t.muted, fontSize: 13 }}>Nothing else planned this week.</Text>}
    </CardShell>
  );
}

function BudgetCard({ t, b }: { t: Theme; b: HomeData['budget'] }) {
  if (!b.hasBudget) {
    return (
      <CardShell t={t} title="Budget" link="Set one up" onPress={() => router.navigate('/budget')}>
        <Text style={{ color: t.muted }}>No budget this month yet.</Text>
      </CardShell>
    );
  }
  const expected = b.budgeted * b.pace;
  const diff = b.spent - expected;
  return (
    <CardShell t={t} title={`Budget · ${monthName(thisMonth(), false)}`} link="Budget" onPress={() => router.navigate('/budget')}>
      <View style={styles.between}>
        <Text style={{ color: t.text }}><Text style={{ fontSize: 20, fontWeight: '700' }}>{money0(b.spent)}</Text><Text style={{ color: t.muted }}> of {money0(b.budgeted)}</Text></Text>
        <Text style={{ color: diff > 0 ? t.danger : t.positive, fontSize: 13, fontWeight: '600' }}>
          {Math.abs(diff) < 5 ? 'on pace' : diff > 0 ? `${money0(diff)} ahead of pace` : `${money0(-diff)} under pace`}
        </Text>
      </View>
      <View>
        <Bar value={b.spent} max={b.budgeted} color={b.spent > b.budgeted ? t.danger : diff > 0 ? t.series2 : t.accent} overColor={t.danger} />
        <View style={{ position: 'absolute', left: `${Math.min(1, b.pace) * 100}%`, top: -3, bottom: -3, width: 2, backgroundColor: t.text, opacity: 0.5 }} />
      </View>
      <Text style={{ color: t.muted, fontSize: 11 }}>{Math.round(b.pace * 100)}% of the month gone · the tick shows where spending would be at an even pace</Text>
      {b.ahead.length > 0 && (
        <View style={{ gap: 4 }}>
          {b.ahead.map((l) => (
            <View key={l.key} style={styles.row}>
              <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{l.label}</Text>
              <Text style={{ color: l.actual > l.available ? t.danger : t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                {money0(l.actual)} / {money0(l.available)}{l.actual > l.available ? ' · over' : ` · +${money0(l.gap)}`}
              </Text>
            </View>
          ))}
        </View>
      )}
    </CardShell>
  );
}

function NetWorthCard({ t, n }: { t: Theme; n: HomeData['net'] }) {
  return (
    <CardShell t={t} title="Net worth" link="Accounts" onPress={() => router.navigate('/accounts')}>
      <View style={styles.between}>
        <Text style={{ color: n.now < 0 ? t.danger : t.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(n.now)}</Text>
        <Text style={{ color: n.change < 0 ? t.danger : t.positive, fontSize: 13, fontWeight: '600' }}>
          {n.change < 0 ? '▼' : '▲'} {money0(Math.abs(n.change))} this month
        </Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>Assets {money0(n.assets)} · Debts {money0(n.debts)}</Text>
    </CardShell>
  );
}

function Mini({ t, label, value, sub, warn }: { t: Theme; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <View style={[styles.mini, { borderColor: warn ? t.danger : t.line }]}>
      <Text style={{ color: t.muted, fontSize: 10 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: warn ? t.danger : t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 40, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  mini: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
});
