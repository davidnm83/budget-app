// Planner tab (PLN): Monday-to-Sunday week of planned bills, income and one-offs against what
// actually posted, with a running balance and a warning before an account dips below its buffer.
import { useFocusLoad } from '@/lib/focusLoad';
import { PAGE_MAX } from '@/lib/layout';
import { ROW } from '@/lib/layout';
import { EmptyState, PageSkeleton } from '@/components/States';
import { usePullRefresh } from '@/lib/pullRefresh';
import { UNDER_BAR } from '@/lib/layout';
import { seedTxn } from '@/lib/txnCache';
import { Tile } from '@/components/Tile';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, formatMoney, monthName, monthOf, shortDate, weekStart as mondayOf, type WeekRow , instalmentsBetween } from '@budget-app/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BillForm, PlanEntryForm, Sheet } from '@/components/Forms';
import { TransactionEditor } from '@/components/TransactionEditor';
import { refreshPlannerBadge, setPlannerBadge } from '@/lib/badges';
import { supabase } from '@/lib/supabase';
import { loadPlans, type CardPlan } from '@/lib/paymentPlans';
import { IconButton, TopBar } from '@/components/TopBar';
import { Card, Chip, Empty, Segmented, Fab } from '@/components/ui';
import Bills from './bills';
import { cachedMonth, loadMonth, loadWeek, today, type MonthData, type PlannerData } from '@/lib/plan';
import { PlannerMonth, PlanRow } from '@/components/PlannerMonth';
import { PeriodStrip, PeriodTitle, useBackToNow, type Period } from '@/components/PeriodStrip';
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
  useBackToNow(() => { setWeek(mondayOf(today())); setMonth(monthOf(today())); });
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
  // The month view: shown at once from the last load of that month, then brought up to date.
  const [mdata, setMdata] = useState<MonthData | null>(() => cachedMonth(monthOf(today()), null));
  const wanted = useRef(''); // the month asked for last: a slower load of an earlier one doesn't replace it
  const load = useCallback(async () => {
    if (view === 'all') return;
    setLoading(true); setError('');
    if (view === 'month') {
      const had = cachedMonth(month, only);
      if (had) setMdata(had);
      const key = `${month}|${only}`; wanted.current = key;
      try { const m = await loadMonth(month, only); if (wanted.current === key) setMdata(m); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
      return;
    }
    try {
      const d = await loadWeek(week, only); setData(d);
      // Get this month ready too, so switching to Month shows it straight away.
      if (!cachedMonth(monthOf(today()), only)) loadMonth(monthOf(today()), only).then((m) => setMdata((x) => x ?? m)).catch(() => {});
      loadPlans().then(setCardPlans).catch(() => {}); if (week === mondayOf(today()) && !only) setPlannerBadge(d.view?.summary.overdue ?? 0); else refreshPlannerBadge(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [week, only, view, month]);
  useFocusLoad(load);
  usePullRefresh(load);

  const now = today();
  const thisWeek = mondayOf(now);
  const planAccounts = data?.accounts.filter((a) => a.plan_include) ?? [];
  const accounts = data?.accounts ?? mdata?.accounts ?? null;
  const name = (id: string | null) => accounts?.find((a) => a.id === id)?.name ?? '';
  const monthStrip: Period[] = (mdata?.strip ?? []).map(({ month: m, net }) => ({
    key: m, label: m === monthOf(now) ? 'THIS MONTH' : new Date(m + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' }).toUpperCase() + (m.slice(0, 4) !== now.slice(0, 4) ? ` ${m.slice(2, 4)}` : ''),
    value: `${net < 0 ? '−' : '+'}${money0(Math.abs(net))}`, bad: net < 0, dim: m < monthOf(now),
  }));
  const v = data?.view;
  const label = `${shortDate(week)} – ${shortDate(addDays(week, 6))}`;
  // Actual against planned: today's real balance (this week) and a past week's real end.
  const todayActual = data?.actual[now] ?? null;
  const todayPlanned = v?.days.find((d) => d.date === now)?.endBalance ?? null;
  const todayGap = todayActual != null && todayPlanned != null ? todayActual - todayPlanned : 0;
  const pastEnd = addDays(week, 6) < now ? data?.actual[addDays(week, 6)] ?? null : null;

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
      {/* Same header as the Budget: the open period and a way back to now, the view switch, then the strip of weeks or months. */}
      <TopBar>
        <PeriodTitle t={t} title={view === 'week' ? label : view === 'month' ? monthName(month) : 'All bills & income'}
          sub={view === 'week' ? (week === thisWeek ? 'This week' : week < thisWeek ? 'Past week' : 'Ahead') : view === 'month' ? (month === monthOf(now) ? 'This month' : month < monthOf(now) ? 'Past month' : 'Ahead') : 'Everything that repeats'}
          away={view === 'week' ? week !== thisWeek : view === 'month' && month !== monthOf(now)} hereText={view === 'week' ? 'This week' : 'This month'}
          onHere={() => (view === 'week' ? setWeek(thisWeek) : setMonth(monthOf(now)))} />
      </TopBar>
      <View style={styles.viewSwitch}>
        <Segmented value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'all', label: 'All bills' }]} />
        {view === 'week' && data && (
          <PeriodStrip t={t} selected={week} current={thisWeek} onSelect={setWeek}
            items={data.strip.map((a) => ({ key: a.week, label: a.week === thisWeek ? 'THIS WEEK' : `WK OF ${shortDate(a.week).toUpperCase()}`, value: money0(a.end), bad: !a.past && (!!a.warning || a.end < 0), dim: a.past }))} />
        )}
        {view === 'month' && <PeriodStrip t={t} selected={month} current={monthOf(now)} onSelect={setMonth} items={monthStrip} />}
      </View>
      {view === 'all' ? <Bills key={billsKey} mode="all" embedded /> : view === 'month' ? (
        <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
          {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
          {mdata ? (
            mdata.accounts.some((a) => a.plan_include)
              ? <View style={{ gap: 10, opacity: mdata.month === month ? 1 : 0.45 }} pointerEvents={mdata.month === month ? 'auto' : 'none'}><PlannerMonth t={t} d={mdata} now={now} only={only} setOnly={setOnly} onRow={openRow} onChanged={() => { load(); setBillsKey((k) => k + 1); }}
                  onAdd={(date) => setForm({ date, description: '', amount: null, account_id: (only ?? mdata.accounts.find((a) => a.plan_include)?.id) ?? null })} /></View>
              : <Card><Text style={{ color: t.text }}>Choose the accounts that pay your bills: tap one on the Accounts tab (or Settings → Planner) and turn on “Plan bills from this account”.</Text></Card>
          ) : <PageSkeleton tiles={3} cards={1} />}
        </ScrollView>
      ) : (

      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {planAccounts.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip label="Combined" on={!only} onPress={() => setOnly(null)} />
            {planAccounts.map((a) => <Chip key={a.id} label={a.name} on={only === a.id} onPress={() => setOnly(a.id)} />)}
          </ScrollView>
        )}
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {planAccounts.length > 0 && week === thisWeek && <NotListedYet t={t} accounts={planAccounts.filter((a) => !only || a.id === only)} refresh={data} done={(data?.view.days ?? []).flatMap((d) => d.rows).filter((r) => r.unlisted)} />}
        {data && !planAccounts.length && (
          <Card><Text style={{ color: t.text }}>Choose the accounts that pay your bills: tap one on the Accounts tab (or Settings → Planner) and turn on “Plan bills from this account”.</Text></Card>
        )}

        {v && planAccounts.length > 0 && (
          <>
            <View style={styles.tiles}>
              <Tile t={t} label="Start" value={money0(v.startBalance)} three={todayActual != null} />
              {/* The real balance today against where the plan expected it to be by now. */}
              {todayActual != null && (
                <Tile t={t} label="Today" value={money0(todayActual)} three
                  sub={Math.abs(todayGap) < 1 ? 'on plan' : `${money0(Math.abs(todayGap))} ${todayGap < 0 ? 'under' : 'over'} plan`}
                  color={Math.abs(todayGap) < 1 ? undefined : todayGap < 0 ? t.danger : t.positive} />
              )}
              <Tile t={t} label={addDays(week, 6) < now ? 'End' : todayActual != null ? 'Projected' : 'Projected end'} value={money0(v.endBalance)} strong warn={v.warnings.length > 0} three={todayActual != null}
                sub={pastEnd != null && Math.abs(pastEnd - v.endBalance) >= 1 ? `actual ${money0(pastEnd)}` : undefined} />
            </View>
            <View style={styles.tiles}>
              <Tile t={t} label="Money in" value={money0(v.summary.actualIn)} sub={`of ${money0(v.summary.plannedIn)} planned`} />
              <Tile t={t} label="Money out" value={money0(v.summary.actualOut)} sub={`of ${money0(v.summary.plannedOut)} planned`} />
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
                    {(() => {
                      // Up to today, the real end-of-day balance shows beside the plan's when the two differ.
                      const real = data!.actual[d.date];
                      const differs = real != null && Math.abs(real - d.endBalance) >= 1;
                      return (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: d.endBalance < 0 ? t.danger : t.muted, fontVariant: ['tabular-nums'], fontSize: 13 }}>{differs ? 'plan ' : ''}{formatMoney(d.endBalance)}</Text>
                          {differs && <Text style={{ color: real < 0 ? t.danger : t.text, fontVariant: ['tabular-nums'], fontSize: 12, fontWeight: '600' }}>actual {formatMoney(real)}</Text>}
                        </View>
                      );
                    })()}
                  </View>
                  {d.rows.filter((r) => !(hideUnplanned && r.kind === 'actual')).map((r) => <PlanRow key={r.key} t={t} r={r} account={only ? '' : name(r.accountId)} onPress={() => openRow(r)} />)}
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

      {/* The same round + as every other page: a one-off in Week, a bill or income in Month and All bills. */}
      <Fab label={view === 'week' ? 'Plan a one-off' : 'Add a bill or income'} onPress={() => (view === 'week' ? setForm({ date: week > now ? week : now, description: '', amount: null, account_id: planAccounts[0]?.id ?? null }) : addBill())} />
      {newBill && accounts && <BillForm initial={{ kind: 'bill', frequency: 'monthly', start_date: now }} accounts={accounts} categories={cats} onClose={() => setNewBill(false)} onSaved={() => { load(); setBillsKey((k) => k + 1); }} />}
      {txnOpen && (
        <Sheet title="Transaction" scroll={false} onClose={() => setTxnOpen(null)}>
          <TransactionEditor key={txnOpen} id={txnOpen} onOpen={setTxnOpen} onDone={() => { setTxnOpen(null); load(); }} />
        </Sheet>
      )}
      {form && accounts && <PlanEntryForm initial={form} accounts={accounts} onClose={() => setForm(null)} onSaved={load} />}
    </View>
  );
}

const styles = StyleSheet.create({
  today: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 10 },
  hideRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  viewSwitch: { paddingHorizontal: 12, paddingBottom: 6, gap: 8, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ahead: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 10 },
  aheadCell: { flex: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 5, alignItems: 'center' },
  tile: { flexGrow: 1, flexBasis: '22%', minWidth: 80, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 10 },
  day: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 12, paddingVertical: 9 },
});

/**
 * What the balances already include but the week's list doesn't count yet: pending transactions,
 * and money the bank has moved without listing it (the balance gap the sync keeps track of).
 */
function NotListedYet({ t, accounts, refresh, done: doneRows }: { t: Theme; accounts: { id: string; name: string }[]; refresh: unknown; done: WeekRow[] }) {
  const [lines, setLines] = useState<{ id: string; name: string; pending: number; count: number; gap: number }[]>([]);
  const ids = accounts.map((a) => a.id).join(',');
  useEffect(() => {
    if (!accounts.length) return;
    let live = true;
    Promise.all([
      supabase.from('transaction_list').select('account_id, amount').in('account_id', accounts.map((a) => a.id)).eq('pending', true).limit(500),
      supabase.from('accounts').select('id, balance_gap').in('id', accounts.map((a) => a.id)),
    ]).then(([p, g]) => {
      if (!live || p.error || g.error) return; // before the newest database update: nothing to say
      setLines(accounts.map((a) => {
        const mine = ((p.data ?? []) as any[]).filter((r) => r.account_id === a.id);
        const gap = Number(((g.data ?? []) as any[]).find((r) => r.id === a.id)?.balance_gap ?? 0);
        return { id: a.id, name: a.name, pending: mine.reduce((x, r) => x + Number(r.amount), 0), count: mine.length, gap };
      }).filter((l) => l.count > 0 || Math.abs(l.gap) >= 1));
    });
    return () => { live = false; };
  }, [ids, refresh]);
  if (!lines.length) return null;
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatMoney(Math.abs(n))}`;
  return (
    <View style={{ gap: 2, paddingHorizontal: 4 }}>
      {lines.map((l) => ({ ...l, done: doneRows.filter((r) => r.accountId === l.id).map((r) => r.description) })).map((l) => (
        <Text key={l.name} style={{ color: t.muted, fontSize: 12 }}>
          ⏳ {l.name}: {[l.count ? `${signed(l.pending)} pending (${l.count})` : '', Math.abs(l.gap) >= 1 ? `${signed(l.gap)} the bank has counted but not listed yet${l.done.length ? ` (${l.done.join(', ')})` : ''}` : ''].filter(Boolean).join(' · ')}.{l.done.length ? ' Already in the balance; they show as ⏳ below.' : ' Not in this week’s list until it posts.'}
        </Text>
      ))}
    </View>
  );
}
