// Planner tab (PLN): Monday-to-Sunday week of planned bills, income and one-offs against what
// actually posted, with a running balance and a warning before an account dips below its buffer.
import { PAGE_MAX } from '@/lib/layout';
import { ROW } from '@/lib/layout';
import { EmptyState, PageSkeleton } from '@/components/States';
import { usePullRefresh } from '@/lib/pullRefresh';
import { UNDER_BAR } from '@/lib/layout';
import { seedTxn } from '@/lib/txnCache';
import { Tile } from '@/components/Tile';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, addMonths, formatMoney, monthName, monthOf, shortDate, weekStart as mondayOf, type WeekRow , instalmentsBetween } from '@budget-app/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BillForm, PlanEntryForm, Sheet } from '@/components/Forms';
import { TransactionEditor } from '@/components/TransactionEditor';
import { refreshPlannerBadge, setPlannerBadge } from '@/lib/badges';
import { supabase } from '@/lib/supabase';
import { loadPlans, type CardPlan } from '@/lib/paymentPlans';
import { IconButton, TopBar } from '@/components/TopBar';
import { Card, Chip, Empty, Segmented } from '@/components/ui';
import Bills from './bills';
import { loadWeek, today, type PlannerData } from '@/lib/plan';
import { useTheme, type Theme } from '@/lib/theme';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export default function Planner() {
  const t = useTheme();
  const [week, setWeek] = useState(mondayOf(today()));
  const [only, setOnly] = useState<string | null>(null);
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any | null>(null);
  const [txnOpen, setTxnOpen] = useState<string | null>(null);
  const [view, setView] = useState<'week' | 'month' | 'all'>('week');
  const [month, setMonth] = useState(monthOf(today()));
  // One + in the same place for every view: a one-off in Week, a repeating bill in Month and All bills.
  const [newBill, setNewBill] = useState(false);
  const [cats, setCats] = useState<any[]>([]);
  const [billsKey, setBillsKey] = useState(0);
  const addBill = async () => {
    if (!cats.length) setCats((await supabase.from('categories').select('id, name, group_name, icon').eq('is_hidden', false).order('sort')).data ?? []);
    setNewBill(true);
  };
  // Links elsewhere (the bills calendar) open straight on Bills & income.
  const params = useLocalSearchParams<{ view?: string }>();
  useEffect(() => { if (params.view === 'bills') { setView('month'); router.setParams({ view: undefined } as any); } }, [params.view]);

  const [cardPlans, setCardPlans] = useState<CardPlan[]>([]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const d = await loadWeek(week, only); setData(d); loadPlans().then(setCardPlans).catch(() => {}); if (week === mondayOf(today()) && !only) setPlannerBadge(d.view?.summary.overdue ?? 0); else refreshPlannerBadge(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [week, only]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

  const now = today();
  const thisWeek = mondayOf(now);
  const planAccounts = data?.accounts.filter((a) => a.plan_include) ?? [];
  const name = (id: string | null) => data?.accounts.find((a) => a.id === id)?.name ?? '';
  const v = data?.view;
  const label = `${shortDate(week)} – ${shortDate(addDays(week, 6))}`;

  // Unplanned transactions can be tucked away to leave just the plan; they still count in every balance.
  const [hideUnplanned, setHideUnplanned] = useState(() => { try { return globalThis.localStorage?.getItem('budget.planner.hideUnplanned') === '1'; } catch { return false; } });
  const toggleUnplanned = () => setHideUnplanned((h) => { try { globalThis.localStorage?.setItem('budget.planner.hideUnplanned', h ? '0' : '1'); } catch { /* lasts until reload */ } return !h; });
  const unplanned = v ? v.days.reduce((n, d) => n + d.rows.filter((r) => r.kind === 'actual').length, 0) : 0;

  const openRow = (r: WeekRow) => {
    if (r.kind === 'actual' && r.txn) { seedTxn({ ...r.txn, account_name: name((r.txn as any).account_id ?? null) || undefined }); setTxnOpen(r.txn.id); return; }
    const p = r.item!;
    setForm({
      id: p.entryId, date: p.date, description: p.description, amount: p.amount, account_id: p.accountId,
      recurring_id: p.recurringId, occurrence_date: p.occurrenceDate, to_account_id: null,
      matched: r.txn ? { id: r.txn.id, date: r.txn.date, amount: r.txn.amount, name: r.txn.merchant || r.txn.name } : null,
      manualMatch: !!p.matchedTxnId,
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar>
        <Pressable onPress={() => (view === 'week' ? setWeek(addDays(week, -7)) : setMonth(addMonths(month, -1)))} disabled={view === 'all'} style={{ opacity: view === 'all' ? 0 : 1 }} hitSlop={10} accessibilityLabel={view === 'week' ? 'Previous week' : 'Previous month'}><Ionicons name="chevron-back" size={22} color={t.accent} /></Pressable>
        <Pressable onPress={() => (view === 'week' ? setWeek(thisWeek) : setMonth(monthOf(now)))} disabled={view === 'all'} style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{view === 'week' ? label : view === 'month' ? monthName(month) : 'All bills & income'}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{view === 'week' ? (week === thisWeek ? 'This week' : week < thisWeek ? 'Past week · tap for this week' : 'Ahead · tap for this week')
            : view === 'month' ? (month === monthOf(now) ? 'This month' : 'Tap for this month') : 'Everything that repeats'}</Text>
        </Pressable>
        <Pressable onPress={() => (view === 'week' ? setWeek(addDays(week, 7)) : setMonth(addMonths(month, 1)))} disabled={view === 'all'} style={{ opacity: view === 'all' ? 0 : 1 }} hitSlop={10} accessibilityLabel={view === 'week' ? 'Next week' : 'Next month'}><Ionicons name="chevron-forward" size={22} color={t.accent} /></Pressable>
        <IconButton icon="add" label={view === 'week' ? 'Plan a one-off' : 'Add a bill or income'} onPress={() => (view === 'week' ? setForm({ date: week > now ? week : now, description: '', amount: null, account_id: planAccounts[0]?.id ?? null }) : addBill())} />
      </TopBar>
      <View style={styles.viewSwitch}>
        <Segmented value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'all', label: 'All bills' }]} />
      </View>
      {view !== 'week' ? <Bills key={billsKey} mode={view} month={month} embedded /> : (

      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {planAccounts.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip label="Combined" on={!only} onPress={() => setOnly(null)} />
            {planAccounts.map((a) => <Chip key={a.id} label={a.name} on={only === a.id} onPress={() => setOnly(a.id)} />)}
          </ScrollView>
        )}
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {data && !planAccounts.length && (
          <Card><Text style={{ color: t.text }}>Choose the accounts that pay your bills: tap one on the Accounts tab (or Settings → Planner) and turn on “Plan bills from this account”.</Text></Card>
        )}

        {v && planAccounts.length > 0 && (
          <>
            <View style={styles.tiles}>
              <Tile t={t} label="Start" value={money0(v.startBalance)} />
              <Tile t={t} label={addDays(week, 6) < now ? 'End' : 'Projected end'} value={money0(v.endBalance)} strong warn={v.warnings.length > 0} />
              <Tile t={t} label="Money in" value={money0(v.summary.actualIn)} sub={`of ${money0(v.summary.plannedIn)} planned`} />
              <Tile t={t} label="Money out" value={money0(v.summary.actualOut)} sub={`of ${money0(v.summary.plannedOut)} planned`} />
            </View>
            {/* The look-ahead reads as week tabs: a tinted strip, the open week filled in. */}
            <View style={[styles.ahead, { backgroundColor: t.line }]}>
              {data!.ahead.map((a) => {
                const on = a.week === week;
                const bad = !!a.warning || a.end < 0;
                return (
                  <Pressable key={a.week} onPress={() => setWeek(a.week)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                    style={[styles.aheadCell, on && { backgroundColor: t.accent }]}>
                    <Text style={{ color: on ? '#ffffffcc' : t.muted, fontSize: 10, fontWeight: '600' }}>{a.week === thisWeek ? 'THIS WEEK' : `WK OF ${shortDate(a.week).toUpperCase()}`}</Text>
                    <Text style={{ color: on ? '#fff' : bad ? t.danger : t.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{bad && !on ? '⚠ ' : ''}{money0(a.end)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {v.warnings.map((w) => (
              <View key={w.accountId} style={[styles.warn, { borderColor: t.danger }]}>
                <Ionicons name="warning" size={18} color={t.danger} />
                <Text style={{ color: t.text, flex: 1, fontSize: 13 }}>
                  <Text style={{ fontWeight: '700' }}>{name(w.accountId)}</Text> drops to {formatMoney(w.balance)} on {DAYS[(new Date(w.date + 'T00:00:00Z').getUTCDay() + 6) % 7]} {shortDate(w.date)}
                  {' '}(below {formatMoney(w.buffer)}) after “{w.cause}”.
                </Text>
              </View>
            ))}
            {v.summary.overdue > 0 && (
              <Text style={{ color: t.danger, fontSize: 13 }}>{v.summary.overdue} planned {v.summary.overdue === 1 ? 'entry hasn’t' : 'entries haven’t'} posted yet. Tap one to move it or skip it.</Text>
            )}

            {unplanned > 0 && (
              <Pressable onPress={toggleUnplanned} accessibilityRole="switch" accessibilityState={{ checked: hideUnplanned }} style={styles.hideRow}>
                <Ionicons name={hideUnplanned ? 'eye-off-outline' : 'eye-outline'} size={16} color={t.accent} />
                <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>
                  {hideUnplanned ? `Show ${unplanned} unplanned transaction${unplanned === 1 ? '' : 's'}` : `Hide ${unplanned} unplanned transaction${unplanned === 1 ? '' : 's'}`}
                </Text>
                {hideUnplanned && <Text style={{ color: t.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>· still counted in the balances</Text>}
              </Pressable>
            )}
            <Card style={{ padding: 0 }}>
              {v.days.map((d, i) => (
                <View key={d.date} style={i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
                  <View style={[styles.day, { backgroundColor: d.date === now ? t.track : 'transparent' }]}>
                    <Text style={{ color: t.text, fontWeight: '700', width: 40 }}>{DAYS[i]}</Text>
                    <Text style={{ color: t.muted, flex: 1 }}>{shortDate(d.date)}{d.date === now ? ' · today' : ''}</Text>
                    <Text style={{ color: d.endBalance < 0 ? t.danger : t.muted, fontVariant: ['tabular-nums'], fontSize: 13 }}>{formatMoney(d.endBalance)}</Text>
                  </View>
                  {d.rows.filter((r) => !(hideUnplanned && r.kind === 'actual')).map((r) => <Row key={r.key} t={t} r={r} account={only ? '' : name(r.accountId)} onPress={() => openRow(r)} />)}
                </View>
              ))}
            </Card>
            <Text style={{ color: t.muted, fontSize: 12 }}>
              Planned entries come from Bills & income (the switch above) and the + button. A posted transaction replaces its planned amount; ones nobody planned show as “unplanned”.
            </Text>
          </>
        )}
        {/* Card payment plans: listed apart from the cash accounts. The money leaves when the card itself is paid, so these don't move the balances above. */}
        {v && (() => {
          const due = instalmentsBetween(cardPlans, week, addDays(week, 6));
          if (!due.length) return null;
          return (
            <>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 6 }}>CARD PAYMENT PLANS THIS WEEK</Text>
              <Card style={{ padding: 0 }}>
                {due.map(({ plan, inst, count }, i) => (
                  <Pressable key={plan.id + inst.n} onPress={() => router.navigate('/credit' as any)} style={({ pressed, hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
                    <Text style={{ color: t.muted, width: 52, fontSize: 13 }}>{shortDate(inst.date)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text }} numberOfLines={1}>{plan.description} · {inst.n} of {count}</Text>
                      <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>on {name(plan.accountId) || 'a card'}{plan.payingAccountId ? ` · paid from ${name(plan.payingAccountId)}` : ''}</Text>
                    </View>
                    <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(inst.total)}</Text>
                  </Pressable>
                ))}
              </Card>
              <Text style={{ color: t.muted, fontSize: 12 }}>These are added to that card’s bill, not taken from an account on their date, so they aren’t in the balances above. The card’s payment in the plan includes them.</Text>
            </>
          );
        })()}
        {!data && loading && <PageSkeleton tiles={2} cards={2} />}
        {v && planAccounts.length > 0 && v.days.every((d) => !d.rows.length) && <EmptyState icon="calendar-outline" title="Nothing this week" text="Nothing is planned or posted for these seven days." action="Plan a one-off" onAction={() => setForm({ date: week > now ? week : now, description: '', amount: null, account_id: planAccounts[0]?.id ?? null })} />}
      </ScrollView>
      )}

      {newBill && data && <BillForm initial={{ kind: 'bill', frequency: 'monthly', start_date: now }} accounts={data.accounts} categories={cats} onClose={() => setNewBill(false)} onSaved={() => { load(); setBillsKey((k) => k + 1); }} />}
      {txnOpen && (
        <Sheet title="Transaction" scroll={false} onClose={() => setTxnOpen(null)}>
          <TransactionEditor key={txnOpen} id={txnOpen} onOpen={setTxnOpen} onDone={() => { setTxnOpen(null); load(); }} />
        </Sheet>
      )}
      {form && data && <PlanEntryForm initial={form} accounts={data.accounts} onClose={() => setForm(null)} onSaved={load} />}
    </View>
  );
}

function Row({ t, r, account, onPress }: { t: Theme; r: WeekRow; account: string; onPress: () => void }) {
  const matched = r.kind === 'planned' && r.actual != null;
  const icon = r.kind === 'actual' ? 'flash-outline' : matched ? 'checkmark-circle' : r.overdue ? 'alert-circle' : 'time-outline';
  const color = r.kind === 'actual' ? t.muted : matched ? t.accent : r.overdue ? t.danger : t.muted;
  return (
    <Pressable onPress={onPress} style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && { backgroundColor: t.line }]}>
      <Ionicons name={icon} size={17} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[ROW.title, { color: t.text, fontWeight: r.kind === 'actual' ? '500' : '600' }]} numberOfLines={1}>{r.description}</Text>
        <Text style={{ color: r.overdue ? t.danger : t.muted, fontSize: 12 }} numberOfLines={1}>
          {r.kind === 'actual' ? 'unplanned' : matched ? `planned ${formatMoney(r.planned!)}` : r.overdue ? 'not posted yet' : 'planned'}{account ? ` · ${account}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: r.counted > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'], fontWeight: matched || r.kind === 'actual' ? '600' : '400' }}>{formatMoney(r.counted)}</Text>
        <Text style={{ color: r.balanceAfter < 0 ? t.danger : t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatMoney(r.balanceAfter)}</Text>
      </View>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  hideRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  viewSwitch: { paddingHorizontal: 12, paddingBottom: 6, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ahead: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 10 },
  aheadCell: { flex: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 5, alignItems: 'center' },
  tile: { flexGrow: 1, flexBasis: '22%', minWidth: 80, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 10 },
  day: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 12, paddingVertical: 9 },
});
