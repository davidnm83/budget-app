// Budget tab (BUD-1, 2, 4, 5, 6): this month's budget, past months in a collapsed archive by year,
// comparisons with other months or years, and a year view of budget vs actual by month.
import { useFocusLoad } from '@/lib/focusLoad';
import { today } from '@/lib/plan';
import { PAGE_MAX } from '@/lib/layout';
import { PageSkeleton } from '@/components/States';
import { ROW } from '@/lib/layout';
import { deleteWithUndo } from '@/lib/toast';
import { usePullRefresh } from '@/lib/pullRefresh';
import { UNDER_BAR } from '@/lib/layout';
import { seedTxn } from '@/lib/txnCache';
import { Tile } from '@/components/Tile';
import {
  actualFor, addMonths, budgetKey, buildBudgetMonth, carryInto, compareTotals, formatMoney, monthEnd, monthName,
  categoryIcon, groupIcon, instalmentsBetween, shortDate, suggestBudget, type BudgetLine, type Month,
} from '@budget-app/core';
import { loadPlans, setInstalment, type CardPlan } from '@/lib/paymentPlans';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { openReview } from '@/components/MonthlyReview';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { PeriodStrip, PeriodTitle, useBackToNow, type Period } from '@/components/PeriodStrip';
import { SinglePicker } from '@/components/Picker';
import { TopBar } from '@/components/TopBar';
import { Button, Card, Chip, Empty, Segmented, Stepper } from '@/components/ui';
import {
  loadBudgets, loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, totalsFor,
  type Budget, type Category, type CategoryMonth, type MonthSummary,
} from '@/lib/reports';
import { loadGroupIcons } from '@/lib/categories';
import { DEFAULT_BUDGET } from '@/components/Widgets';
import { useTxnSheet, type TxnQuery } from '@/components/TxnSheet';
import { loadPrefs, savePrefs } from '@/lib/prefs';
import { TransactionEditor } from '@/components/TransactionEditor';
import { afterClose } from '@/lib/useBackToClose';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';

type View_ = 'month' | 'compare' | 'year';
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export default function BudgetTab() {
  const t = useTheme();
  const [view, setView] = useState<View_>('month');
  const [month, setMonth] = useState<Month>(thisMonth());
  // Compare: what the open month is set against. In Compare the strip picks this baseline.
  const [against, setAgainst] = useState<Against>('prev');
  const [picked, setPicked] = useState<Month>(addMonths(thisMonth(), -2));
  // Which of the two months a tap on the strip sets: the one being looked at, or the one it's set against.
  const [picking, setPicking] = useState<'month' | 'base'>('base');
  useBackToNow(() => { setMonth(thisMonth()); setAgainst('prev'); });
  // Opened at a month (from the monthly review): go there once.
  const asked = useLocalSearchParams<{ month?: string }>().month;
  useEffect(() => { if (asked && /^\d{4}-\d{2}-01$/.test(asked)) { setMonth(asked as Month); setView('month'); router.setParams({ month: undefined } as any); } }, [asked]);
  const [cats, setCats] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [rows, setRows] = useState<CategoryMonth[]>([]);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [groupIcons, setGroupIcons] = useState<Record<string, string>>({});
  const [widgets, setWidgets] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRefresh((r) => r + 1);
      const [c, b, s, gi, prefs] = await Promise.all([loadCategories(), loadBudgets(), loadMonthSummaries(), loadGroupIcons(), loadPrefs()]);
      setWidgets(prefs.budget_widgets ?? DEFAULT_BUDGET);
      const now = thisMonth();
      const first = [...s.map((x) => x.month), ...b.map((x) => x.month), addMonths(now, -12)].sort()[0];
      setCats(c); setBudgets(b); setSummaries(s); setGroupIcons(gi);
      const monthRows = await loadCategoryMonths(first, now > month ? now : month);
      setRows(monthRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useFocusLoad(load);
  usePullRefresh(load);

  const [showTxns, txnSheet] = useTxnSheet();
  const current = thisMonth();
  // The strip: every month with a budget or spending, back to a year ago, and 12 months ahead. Under each,
  // what's left to spend (red when over), or the budget for months still to come.
  const strip = useMemo(() => {
    const incomeCats = new Set(cats.filter((c) => c.kind === 'income').map((c) => c.id));
    const first = [...summaries.map((x) => x.month), ...budgets.map((b) => b.month), addMonths(current, -12)].sort()[0];
    const out: Period[] = [];
    for (let m = first; m <= addMonths(current, 12); m = addMonths(m, 1)) {
      const budgeted = budgets.filter((b) => b.month === m && !(b.categoryId && incomeCats.has(b.categoryId))).reduce((x, b) => x + b.amount, 0);
      const spent = -(summaries.find((x) => x.month === m)?.spending ?? 0);
      const yr = m.slice(0, 4) !== current.slice(0, 4) ? ` ${m.slice(2, 4)}` : '';
      const label = m === current ? 'THIS MONTH' : new Date(m + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' }).toUpperCase() + yr;
      out.push(m > current ? { key: m, label, value: budgeted ? money0(budgeted) : '–', dim: true }
        : budgeted ? { key: m, label, value: `${budgeted - spent < 0 ? '−' : ''}${money0(Math.abs(budgeted - spent))}`, bad: budgeted - spent < 0 }
        : { key: m, label, value: spent ? money0(spent) : '–', dim: true });
    }
    return out;
  }, [budgets, summaries, cats, current]);
  const base: Month = against === 'prev' ? addMonths(month, -1) : against === 'lastYear' ? addMonths(month, -12) : picked;
  const compare = view === 'compare';
  const pickBase = (m: Month) => {
    if (picking === 'month') { if (m === base) return; const keep = base; setMonth(m); setPicked(keep); setAgainst('pick'); return; }
    if (m === month) return;
    if (m === addMonths(month, -1)) setAgainst('prev'); else if (m === addMonths(month, -12)) setAgainst('lastYear'); else { setPicked(m); setAgainst('pick'); }
  };
  const data = { t, cats, groupIcons, widgets, setWidgets, refresh, showTxns, budgets, rows, summaries, month, setMonth, reload: load, setError, setView,
    against, setAgainst, base };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    {/* Same header as the Planner: the open period and a way back to now, the view switch, then the strip of months. */}
    <TopBar>
      <PeriodTitle t={t} title={view === 'year' ? 'Year by month' : compare ? `${monthName(month, false)} vs ${monthName(base, base.slice(0, 4) !== month.slice(0, 4))}` : monthName(month)} away={view !== 'year' && month !== current} hereText="This month" onHere={() => setMonth(current)}
        sub={view === 'year' ? undefined : compare ? `Tap a month to change ${picking === 'month' ? 'the month you’re looking at' : 'the one it’s compared with'}` : month === current ? 'This month' : month > current ? 'Planning ahead · spending shows once the month starts' : 'Past month'} />
    </TopBar>
    <View style={styles.viewSwitch}>
      <Segmented<View_> value={view} onChange={setView}
        options={[{ value: 'month', label: 'Month' }, { value: 'compare', label: 'Compare' }, { value: 'year', label: 'Year' }]} />
      {view === 'month' && <PeriodStrip t={t} items={strip} selected={month} current={current} onSelect={setMonth} />}
      {compare && <PeriodStrip t={t} items={strip} selected={month} second={base} focus={picking === 'base' ? base : month} current={current}
        onSelect={(k) => pickBase(k as Month)} />}
      {compare && (
        <View style={styles.pickRow}>
          {([['month', month, t.accent], ['base', base, t.series2]] as const).map(([k, m, color], i) => (
            <Fragment key={k}>
              <Pressable onPress={() => setPicking(k)} accessibilityRole="button" accessibilityState={{ selected: picking === k }}
                style={[styles.pick, { borderColor: picking === k ? color : t.line, backgroundColor: picking === k ? color + '1f' : t.card }]}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={{ color: t.text, fontSize: 13, fontWeight: picking === k ? '700' : '400' }} numberOfLines={1}>{monthName(m)}</Text>
              </Pressable>
            </Fragment>
          ))}
        </View>
      )}
      {view === 'month' && month < current && (
        <Pressable onPress={() => openReview(month)} hitSlop={6} accessibilityRole="button">
          <Text style={{ color: t.accent, fontSize: 13 }}>📋 {monthName(month, false)} in review ›</Text>
        </Pressable>
      )}
    </View>
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {!cats.length && loading ? <PageSkeleton tiles={3} cards={2} /> : null}
      {view === 'month' && (cats.length > 0 || !loading) && <MonthView {...data} />}
      {view === 'compare' && <CompareView {...data} />}
      {view === 'year' && <YearView {...data} />}
    </ScrollView>
    {txnSheet}
    </View>
  );
}

interface Data {
  t: Theme; cats: Category[]; groupIcons: Record<string, string>; widgets: string[]; setWidgets: (w: string[]) => void; refresh: number; showTxns: (q: TxnQuery) => void; budgets: Budget[]; rows: CategoryMonth[]; summaries: MonthSummary[];
  month: Month; setMonth: (m: Month) => void; reload: () => void; setError: (e: string) => void; setView: (v: View_) => void;
  against: Against; setAgainst: (a: Against) => void; base: Month;
}

/** What a budget line (category or group) added up to in a given month. */
function actualOfKey(d: Data, key: string, m: Month): number {
  const totals = totalsFor(d.rows, m);
  if (key.startsWith('c:')) {
    const c = d.cats.find((x) => x.id === key.slice(2));
    return c ? actualFor(c.kind, totals.get(c.id) ?? 0) : 0;
  }
  const group = key.slice(2);
  const own = new Set(d.budgets.filter((b) => b.month === m && b.categoryId).map((b) => b.categoryId));
  return d.cats.filter((c) => c.group === group && c.kind === 'expense' && !own.has(c.id))
    .reduce((s, c) => s + actualFor('expense', totals.get(c.id) ?? 0), 0);
}

function drill(d: Data, line: { categoryId: string | null; groupName: string | null; label: string }, from: string, to: string) {
  d.showTxns({
    title: `${line.label} · ${monthName(from.slice(0, 7) + '-01')}`, from, to, noTransfers: true,
    ...(line.categoryId ? { category: line.categoryId } : line.groupName ? { group: line.groupName } : { category: 'none' }),
  });
}

// ───────────────────────── Month ─────────────────────────
// Dense layout: one line per budget (name, bar with a "pace" tick for how far through the month
// we are, spent / budget, what's left), grouped under collapsible group rows with subtotals.
function MonthView(d: Data) {
  const { t, month } = d;
  const current = thisMonth();
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [incomeOpen, setIncomeOpen] = useState(true);

  const monthBudgets = d.budgets.filter((b) => b.month === month);
  const view = useMemo(() => {
    const carry = new Map<string, number>();
    for (const b of monthBudgets.filter((x) => x.rollover)) {
      const key = budgetKey(b);
      const history = d.budgets.filter((x) => budgetKey(x) === key && x.month < month)
        .map((x) => ({ month: x.month, budgeted: x.amount, rollover: x.rollover, actual: actualOfKey(d, key, x.month) }));
      carry.set(key, carryInto(month, history));
    }
    return buildBudgetMonth(d.cats, monthBudgets, totalsFor(d.rows, month), carry);
  }, [d.cats, d.budgets, d.rows, month]);

  /** Average of the last 3 full months, rounded up to $5. */
  const suggestion = (key: string) => suggestBudget([1, 2, 3].map((n) => actualOfKey(d, key, addMonths(month, -n))));

  const add = async (rows: { category_id?: string; group_name?: string; amount: number; rollover?: boolean }[]) => {
    if (!rows.length) return;
    setBusy(true);
    const { error } = await supabase.from('budgets').insert(rows.map((r) => ({ month, rollover: false, ...r })));
    setBusy(false);
    if (error) d.setError(error.message); else d.reload();
  };
  const previous = [...new Set(d.budgets.map((b) => b.month))].filter((m) => m < month).sort().pop();
  const copyFrom = (m: Month) => add(d.budgets.filter((b) => b.month === m).map((b) => ({
    ...(b.categoryId ? { category_id: b.categoryId } : { group_name: b.groupName! }), amount: b.amount, rollover: b.rollover,
  })));
  const suggestAll = () => {
    const groups = [...new Set(d.cats.filter((c) => c.kind === 'expense').map((c) => c.group))];
    add(groups.map((g) => ({ group_name: g, amount: suggestion(`g:${g}`) })).filter((r) => r.amount > 0));
  };

  // Category budgets sit under their group with a subtotal. Biggest spending first: groups by
  // what they've spent this month, and the lines inside each group the same way.
  const groupedExpenses = useMemo(() => {
    const groupOf = (l: BudgetLine) => l.groupName ?? d.cats.find((c) => c.id === l.categoryId)?.group ?? 'Other';
    const m = new Map<string, BudgetLine[]>();
    for (const l of view.expenses) {
      const g = groupOf(l);
      (m.get(g) ?? m.set(g, []).get(g)!).push(l);
    }
    return [...m.entries()].map(([group, lines]) => ({
      group,
      lines: [...lines].sort((a, b) => b.actual - a.actual || b.available - a.available || a.label.localeCompare(b.label)),
      available: lines.reduce((x, l) => x + l.available, 0),
      actual: lines.reduce((x, l) => x + l.actual, 0),
    })).sort((a, b) => b.actual - a.actual || b.available - a.available || a.group.localeCompare(b.group));
  }, [view, d.cats]);

  // How far through the month we are (for the pace tick), only for the current month.
  const daysIn = Number(monthEnd(month).slice(8, 10));
  const pace = month === current ? Number(today().slice(8, 10)) / daysIn : month < current ? 1 : 0;
  const pastMonths = d.summaries.filter((s) => s.month < current && s.month !== month);
  const future = month > current;
  const [copying, setCopying] = useState(false);
  const tot = view.totals;
  const toggle = (g: string) => setCollapsed((c) => { const n = new Set(c); n.has(g) ? n.delete(g) : n.add(g); return n; });
  const catIcon = (id: string | null) => { const c = d.cats.find((x) => x.id === id); return c ? categoryIcon(c.name, c.icon) : '•'; };

  return (
    <>

      {/* Top: how the month stands. Left to spend (coloured by pace), actual net so far, and the plan's net. */}
      {(() => {
        const left = tot.budgetedExpenses - tot.actualExpenses;
        const st = paceState(tot.actualExpenses, tot.budgetedExpenses, pace);
        const net = tot.actualIncome - tot.actualExpenses;
        const planNet = tot.budgetedIncome - tot.budgetedExpenses;
        const tone = (n: number) => (n >= 0 ? t.accent : t.danger);
        if (future) return (
          <View style={styles.tiles}>
            <Tile t={t} label="Budgeted" value={money0(tot.budgetedExpenses)} sub="to spend" />
            <Tile t={t} label="Expected in" value={money0(tot.budgetedIncome)} />
            <Tile t={t} label="Planned net" value={`${planNet < 0 ? '−' : '+'}${money0(Math.abs(planNet))}`} color={tone(planNet)} sub="expected in − budget" />
          </View>
        );
        return (
          <View style={styles.tiles}>
            <Tile t={t} label={left < 0 ? 'Over budget' : 'Left to spend'} value={money0(Math.abs(left))} color={stateColor(t, st)}
              sub={pace > 0 && pace < 1 ? `${Math.round(pace * 100)}% of month gone` : tot.budgetedExpenses ? `of ${money0(tot.budgetedExpenses)}` : 'no budget'} />
            <Tile t={t} label="Net so far" value={`${net < 0 ? '−' : '+'}${money0(Math.abs(net))}`} color={tone(net)} sub="money in − spent" />
            <Tile t={t} label="Planned net" value={`${planNet < 0 ? '−' : '+'}${money0(Math.abs(planNet))}`} color={tone(planNet)} sub="expected in − budget" />
          </View>
        );
      })()}
      {tot.unbudgetedExpenses > 0 && <Text style={{ color: t.muted, fontSize: 12 }}>{formatMoney(tot.unbudgetedExpenses)} spent outside the budget (listed at the bottom).</Text>}

      <PlanSuggestions d={d} monthBudgets={monthBudgets} />
      {!monthBudgets.length && (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>No budget for {monthName(month, false)} yet</Text>
          {previous && <Button title={`Copy ${monthName(previous)}'s budget`} onPress={() => copyFrom(previous)} busy={busy} />}
          <Button title="Suggest one from the last 3 months" kind={previous ? 'plain' : 'primary'} onPress={suggestAll} busy={busy} />
        </Card>
      )}

      {groupedExpenses.length > 0 && (
        <Card style={{ padding: 0 }}>
          {(() => {
            const multi = groupedExpenses.filter((g) => !(g.lines.length === 1 && g.lines[0].groupName));
            const allClosed = multi.length > 0 && multi.every((g) => collapsed.has(g.group));
            return (
              <SectionHead t={t} title="SPENDING" open={!allClosed}
                onToggle={() => setCollapsed(allClosed ? new Set() : new Set(multi.map((g) => g.group)))} />
            );
          })()}
          {groupedExpenses.map((g) => {
            const open = !collapsed.has(g.group);
            const single = g.lines.length === 1 && g.lines[0].groupName;
            return (
              <View key={g.group}>
                <Pressable onPress={() => (single ? setEditing(g.lines[0]) : toggle(g.group))} style={[styles.groupRow, { backgroundColor: t.bg, borderColor: t.line }]}>
                  <Ionicons name={single ? 'ellipse' : open ? 'chevron-down' : 'chevron-forward'} size={single ? 4 : 14} color={t.muted} />
                  <Line t={t} icon={groupIcon(g.group, d.groupIcons[g.group])} label={g.group} actual={g.actual} available={g.available} pace={pace} bold />
                </Pressable>
                {!single && open && g.lines.map((l) => (
                  <Pressable key={l.key} onPress={() => setEditing(l)} style={({ pressed, hovered }: any) => [styles.lineRow, (pressed || hovered) && { backgroundColor: t.line }]}>
                    <Line t={t} icon={l.groupName ? groupIcon(l.groupName, d.groupIcons[l.groupName]) : catIcon(l.categoryId)} label={l.label + (l.groupName ? ' (whole group)' : '')} actual={l.actual} available={l.available} pace={pace} carry={l.carryIn} />
                  </Pressable>
                ))}
              </View>
            );
          })}
          <TotalRow t={t} label="Spent" actual={tot.actualExpenses} available={tot.budgetedExpenses} pace={pace} />
        </Card>
      )}

      {view.income.length > 0 && (
        <Card style={{ padding: 0 }}>
          <SectionHead t={t} title="MONEY IN" open={incomeOpen} onToggle={() => setIncomeOpen(!incomeOpen)} />
          {incomeOpen && [...view.income].sort((a, b) => b.actual - a.actual || b.available - a.available).map((l) => (
            <Pressable key={l.key} onPress={() => setEditing(l)} style={styles.lineRow}>
              <Line t={t} icon={catIcon(l.categoryId)} label={l.label} actual={l.actual} available={l.available} pace={pace} income />
            </Pressable>
          ))}
          <TotalRow t={t} label="Money in" actual={tot.actualIncome} available={tot.budgetedIncome} pace={pace} income />
        </Card>
      )}

      {view.unbudgeted.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Text style={[styles.cardHead, { color: t.muted }]}>NOT BUDGETED</Text>
          {view.unbudgeted.map((l) => (
            <View key={l.key} style={[styles.lineRow, { gap: 8 }]}>
              <Text style={styles.icon}>{catIcon(l.categoryId)}</Text>
              <Pressable style={{ flex: 1 }} onPress={() => drill(d, l, month, monthEnd(month))}>
                <Text style={{ color: t.text, fontSize: 14 }} numberOfLines={1}>{l.label}</Text>
              </Pressable>
              <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{l.kind === 'income' ? '+' : ''}{formatMoney(l.actual)}</Text>
              {l.categoryId ? (
                <Pressable onPress={() => add([{ category_id: l.categoryId!, amount: suggestion(l.key) || Math.ceil(l.actual / 5) * 5 }])} hitSlop={8} accessibilityLabel={`Budget ${l.label}`}>
                  <Ionicons name="add-circle-outline" size={20} color={t.accent} />
                </Pressable>
              ) : <View style={{ width: 20 }} />}
            </View>
          ))}
        </Card>
      )}

      {monthBudgets.length > 0 && <Button title="Add a budget" kind="plain" onPress={() => setAdding(true)} />}
      {monthBudgets.length > 0 && month >= current && <Button title="Copy this budget to the following months" kind="plain" onPress={() => setCopying(true)} />}
      {copying && <CopyAhead d={d} monthBudgets={monthBudgets} onClose={() => setCopying(false)} />}
      {adding && <AddBudget d={d} monthBudgets={monthBudgets} onClose={() => setAdding(false)} onAdd={(r) => { add([r]); setAdding(false); }} suggestion={suggestion} />}

      <Archive d={d} months={pastMonths} />
      {editing && <BudgetEditor d={d} line={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * One budget line, two rows: icon · name · spent / budget, then the bar underneath with a tick
 * at the month's pace. Colour says it all: green on track, orange ahead of pace, red over.
 */
function Line({ t, icon, label, actual, available, pace, bold, income, carry }: {
  t: Theme; icon: string; label: string; actual: number; available: number; pace: number; bold?: boolean; income?: boolean; carry?: number;
}) {
  const st = income ? 'income' : paceState(actual, available, pace);
  const over = st === 'over';
  const fill = available > 0 ? Math.min(1, actual / available) : actual > 0 ? 1 : 0;
  const color = stateColor(t, st);
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={[ROW.title, { flex: 1, color: t.text, fontWeight: bold ? '700' : '500' }]} numberOfLines={1}>
          {label}{carry ? <Text style={{ color: t.muted, fontSize: 12 }}>{`  ${carry > 0 ? '+' : '−'}${money0(Math.abs(carry))} rolled over`}</Text> : null}
        </Text>
        <Text style={{ color: over ? t.danger : t.text, fontWeight: bold || over ? '700' : '500', fontSize: 14, fontVariant: ['tabular-nums'] }}>
          {money0(actual)}<Text style={{ color: t.muted, fontWeight: '400' }}>{` / ${money0(available)}`}</Text>
        </Text>
      </View>
      <View style={{ marginLeft: 30 }}>
        <View style={{ height: bold ? 6 : 5, borderRadius: 3, backgroundColor: t.track, overflow: 'hidden' }}>
          <View style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 3, backgroundColor: color }} />
        </View>
        {pace > 0 && pace < 1 && !income && <View style={{ position: 'absolute', left: `${pace * 100}%`, top: -2, bottom: -2, width: 1.5, backgroundColor: t.text, opacity: 0.4 }} />}
      </View>
    </View>
  );
}

/** A card's heading with a Collapse all / Expand all switch on the right. */
function SectionHead({ t, title, open, onToggle }: { t: Theme; title: string; open: boolean; onToggle: () => void }) {
  return (
    <View style={[styles.between, { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 }]}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{title}</Text>
      <Pressable onPress={onToggle} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        accessibilityLabel={open ? `Collapse all ${title.toLowerCase()}` : `Expand all ${title.toLowerCase()}`}>
        <Ionicons name={open ? 'contract-outline' : 'expand-outline'} size={14} color={t.accent} />
        <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>{open ? 'Collapse all' : 'Expand all'}</Text>
      </Pressable>
    </View>
  );
}

type PaceState = 'over' | 'ahead' | 'ok' | 'income';
/** Over budget, spending ahead of the month's pace (by 10 points or more), or on track. */
function paceState(actual: number, available: number, pace: number): PaceState {
  if (actual > available + 0.005) return 'over';
  if (available > 0 && pace > 0 && pace < 1 && actual / available > pace + 0.1) return 'ahead';
  return 'ok';
}
const stateColor = (t: Theme, s: PaceState) => (s === 'over' ? t.danger : s === 'ahead' ? t.series2 : s === 'income' ? t.series1 : t.accent);

/** Section total at the bottom of a card: tinted, with a thick bar, coloured like the lines. */
function TotalRow({ t, label, actual, available, pace, income }: { t: Theme; label: string; actual: number; available: number; pace: number; income?: boolean }) {
  const st = income ? (actual >= available ? 'ok' : 'income') : paceState(actual, available, pace);
  const color = stateColor(t, st);
  const fill = available > 0 ? Math.min(1, actual / available) : actual > 0 ? 1 : 0;
  const diff = available - actual;
  const note = income
    ? (diff > 0 ? `${money0(diff)} still to come` : `${money0(-diff)} more than expected`)
    : (diff >= 0 ? `${money0(diff)} left` : `${money0(-diff)} over`);
  return (
    <View style={[styles.total, { backgroundColor: color + '1f', borderLeftColor: color }]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ color: t.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{label}</Text>
        <Text style={{ color, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] }}>{money0(actual)}</Text>
        <Text style={{ color: t.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>/ {money0(available)}</Text>
      </View>
      <View>
        <View style={{ height: 9, borderRadius: 5, backgroundColor: t.track, overflow: 'hidden' }}>
          <View style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 5, backgroundColor: color }} />
        </View>
        {pace > 0 && pace < 1 && !income && <View style={{ position: 'absolute', left: `${pace * 100}%`, top: -3, bottom: -3, width: 2, backgroundColor: t.text, opacity: 0.5 }} />}
      </View>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{note}</Text>
    </View>
  );
}


/** The month's transactions for a budget line, listed right in its pop-up. */
function MonthTxns({ d, line, reload, onOpen, onAll }: { d: Data; line: BudgetLine; reload: number; onOpen: (id: string) => void; onAll: () => void }) {
  const { t, month } = d;
  const [rows, setRows] = useState<{ transaction_id: string; date: string; amount: number; merchant: string }[] | null>(null);
  useEffect(() => {
    (async () => {
      let q = supabase.from('transaction_lines').select('transaction_id, date, amount, merchant, kind')
        .gte('date', month).lte('date', monthEnd(month)).order('date', { ascending: false }).limit(60);
      if (line.categoryId) q = q.eq('category_id', line.categoryId);
      else if (line.groupName) {
        const ids = d.cats.filter((c) => c.group === line.groupName && c.kind === 'expense').map((c) => c.id);
        q = q.in('category_id', ids).eq('kind', 'expense');
      }
      const { data } = await q;
      setRows(((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount) })));
    })();
  }, [line.key, month, reload]);
  return (
    <View style={{ gap: 2 }}>
      <Text style={[styles.h, { color: t.muted }]}>{monthName(month)} transactions{rows ? ` · ${rows.length}${rows.length === 60 ? '+' : ''}` : ''}</Text>
      {rows === null && <Text style={{ color: t.muted }}>Loading…</Text>}
      {rows?.length === 0 && <Text style={{ color: t.muted }}>None yet this month.</Text>}
      {rows?.map((r) => (
        <Pressable key={r.transaction_id + r.amount} onPress={() => { seedTxn({ id: r.transaction_id, date: r.date, amount: r.amount, display_name: (r as any).merchant }); onOpen(r.transaction_id); }} style={({ pressed, hovered }: any) => [styles.txn, { borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
          <Text style={{ color: t.muted, fontSize: 12, width: 48 }}>{shortDate(r.date)}</Text>
          <Text style={{ color: t.text, flex: 1, fontSize: 14 }} numberOfLines={1}>{r.merchant}</Text>
          <Text style={{ color: r.amount > 0 ? t.positive : t.text, fontSize: 14, fontVariant: ['tabular-nums'] }}>{formatMoney(r.amount)}</Text>
        </Pressable>
      ))}
      {rows?.length === 60 && <Button title="See all" kind="plain" onPress={onAll} />}
    </View>
  );
}

/** Pop-up to change one budget: amount, rollover, see its transactions, remove. */
function BudgetEditor({ d, line, onClose }: { d: Data; line: BudgetLine; onClose: () => void }) {
  const { t, month } = d;
  const budget = d.budgets.find((b) => b.month === month && budgetKey(b) === line.key);
  const [amount, setAmount] = useState(String(line.budgeted));
  const [rollover, setRollover] = useState(line.rollover);
  const changed = useChanged([amount, rollover]);
  const income = line.kind === 'income';
  const [txnId, setTxnId] = useState<string | null>(null);
  const [txnKey, setTxnKey] = useState(0);
  const last3 = [1, 2, 3].map((n) => actualOfKey(d, line.key, addMonths(month, -n)));
  const save = async () => {
    const v = Number(amount.replace(/[$,\s]/g, ''));
    if (!budget || isNaN(v)) return;
    const { error } = await supabase.from('budgets').update({ amount: v, rollover }).eq('id', budget.id);
    if (error) d.setError(error.message); else { onClose(); d.reload(); }
  };
  const remove = async () => {
    if (!budget) return;
    const error = await deleteWithUndo('budgets', budget.id, 'Budget removed');
    if (error) d.setError(error); else { onClose(); d.reload(); }
  };
  return (
    <Sheet title={`${line.label} · ${monthName(month)}`} dirty={changed} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Remove" kind="danger" onPress={remove} />
        <Button title="Save" onPress={save} style={{ flex: 1 }} />
      </View>}>
      <View style={styles.tiles}>
        <Tile t={t} label={income ? 'Received' : 'Spent'} value={formatMoney(line.actual)} />
        <Tile t={t} label="Available" value={formatMoney(line.available)} sub={line.carryIn ? `incl. ${formatMoney(line.carryIn)} rolled over` : ''} />
        <Tile t={t} label="3-month average" value={formatMoney(last3.reduce((s, x) => s + x, 0) / 3)} sub={last3.map((x) => money0(x)).reverse().join(' · ')} />
      </View>
      <Field t={t} label={income ? 'Expected' : 'Budget'}>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" onSubmitEditing={save}
          style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
      </Field>
      {!income && (
        <View style={styles.between}>
          <Text style={{ color: t.text, flex: 1 }}>Roll what's left (or overspent) into next month</Text>
          <Switch value={rollover} onValueChange={setRollover} />
        </View>
      )}
      <MonthTxns d={d} line={line} reload={txnKey} onOpen={setTxnId}
        onAll={() => { onClose(); drill(d, line, month, monthEnd(month)); }} />
      {/* The transaction opens on top of this pop-up; closing it comes back here. */}
      {txnId && (
        <Sheet title="Transaction" scroll={false} onClose={() => setTxnId(null)}>
          <TransactionEditor key={txnId} id={txnId} onOpen={setTxnId} onDone={() => { setTxnId(null); setTxnKey((k) => k + 1); d.reload(); }} />
        </Sheet>
      )}
    </Sheet>
  );
}

/** Copy this month's budget into the months after it: fill only the ones not set yet, or replace them too. */
function CopyAhead({ d, monthBudgets, onClose }: { d: Data; monthBudgets: Budget[]; onClose: () => void }) {
  const { t, month } = d;
  const [n, setN] = useState(3);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Payment plan instalments added to this month's budget stay behind: each month is offered its own.
      const plans = await loadPlans().catch(() => [] as CardPlan[]);
      const planned = new Map<string, number>();
      for (const { plan, inst } of instalmentsBetween(plans, month, monthEnd(month))) {
        if (plan.instalments?.[String(inst.n)]?.budget !== 'added') continue;
        const cat = d.cats.find((x) => x.id === plan.categoryId);
        if (!cat) continue;
        const key = monthBudgets.some((b) => b.categoryId === cat.id) ? `c:${cat.id}` : `g:${cat.group}`;
        planned.set(key, (planned.get(key) ?? 0) + inst.principal);
      }
      const amountOf = (b: Budget) => Math.max(0, Math.round((b.amount - (planned.get(budgetKey(b)) ?? 0)) * 100) / 100);
      for (let k = 1; k <= n; k++) {
        const m = addMonths(month, k);
        const have = new Map(d.budgets.filter((b) => b.month === m).map((b) => [budgetKey(b), b]));
        for (const b of monthBudgets) {
          const old = have.get(budgetKey(b));
          if (old && !replace) continue;
          const r = old ? await supabase.from('budgets').update({ amount: amountOf(b), rollover: b.rollover }).eq('id', old.id)
            : await supabase.from('budgets').insert({ month: m, amount: amountOf(b), rollover: b.rollover, ...(b.categoryId ? { category_id: b.categoryId } : { group_name: b.groupName }) });
          if (r.error) throw new Error(r.error.message);
        }
      }
      onClose(); d.reload();
    } catch (e) { d.setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Sheet title="Copy to the following months" onClose={onClose} footer={<Button title={`Copy to ${n} month${n === 1 ? '' : 's'}`} onPress={run} busy={busy} />}>
      <Text style={{ color: t.muted }}>Every budget line of {monthName(month)} goes into the months after it, through {monthName(addMonths(month, n))}. Payment plan instalments you added this month aren’t copied: each month offers its own.</Text>
      <Field t={t} label="How many months">
        <View style={styles.chips}>{[1, 3, 6, 12].map((k) => <Chip key={k} label={String(k)} on={n === k} onPress={() => setN(k)} />)}</View>
      </Field>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text }}>Replace amounts already set</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>Off: a month keeps any line you already set for it, and only the missing lines are added.</Text>
        </View>
        <Switch value={replace} onValueChange={setReplace} />
      </View>
    </Sheet>
  );
}

/**
 * Payment plan instalments due this month, offered as budget changes: each one's part of the
 * purchase goes into its category's budget (or the group's, when the group is what's budgeted)
 * once you say so. Answered ones aren't asked again.
 */
function PlanSuggestions({ d, monthBudgets }: { d: Data; monthBudgets: Budget[] }) {
  const { t, month } = d;
  const [plans, setPlans] = useState<CardPlan[]>([]);
  const [busy, setBusy] = useState('');
  useEffect(() => { loadPlans().then(setPlans).catch(() => setPlans([])); }, [d.refresh]);
  const due = instalmentsBetween(plans, month, monthEnd(month)).filter(({ plan, inst }) => {
    const c = d.cats.find((x) => x.id === plan.categoryId);
    return c && c.kind === 'expense' && inst.principal > 0 && !plan.instalments?.[String(inst.n)]?.budget;
  });
  if (!due.length) return null;
  const answer = async (plan: CardPlan, n: number, amount: number, add: boolean) => {
    setBusy(`${plan.id}:${n}`);
    try {
      if (add) {
        const cat = d.cats.find((x) => x.id === plan.categoryId)!;
        const own = monthBudgets.find((b) => b.categoryId === cat.id), group = monthBudgets.find((b) => b.groupName === cat.group);
        const target = own ?? group;
        const r = target ? await supabase.from('budgets').update({ amount: Math.round((target.amount + amount) * 100) / 100 }).eq('id', target.id)
          : await supabase.from('budgets').insert({ month, category_id: cat.id, amount, rollover: false });
        if (r.error) throw new Error(r.error.message);
      }
      await setInstalment(plan, n, { ...(plan.instalments?.[String(n)] ?? {}), budget: add ? 'added' : 'skipped' });
      d.reload();
    } catch (e) { d.setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>PAYMENT PLANS THIS MONTH</Text>
      {due.map(({ plan, inst, count }) => {
        const cat = d.cats.find((x) => x.id === plan.categoryId)!;
        const where = monthBudgets.some((b) => b.categoryId === cat.id) ? cat.name : monthBudgets.some((b) => b.groupName === cat.group) ? `${cat.group} (group)` : cat.name;
        const key = `${plan.id}:${inst.n}`;
        return (
          <View key={key} style={{ gap: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
            <Text style={{ color: t.text }}>{plan.description} · {inst.n} of {count} · <Text style={{ fontWeight: '700' }}>{formatMoney(inst.principal)}</Text> on {shortDate(inst.date)}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>It counts as spending in {cat.name} this month. Add it to the {where} budget?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Not this month" kind="plain" style={{ flex: 1 }} disabled={!!busy} onPress={() => answer(plan, inst.n, inst.principal, false)} />
              <Button title={`Add ${formatMoney(inst.principal)}`} style={{ flex: 1 }} busy={busy === key} disabled={!!busy && busy !== key} onPress={() => answer(plan, inst.n, inst.principal, true)} />
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function AddBudget({ d, monthBudgets, onAdd, onClose, suggestion }: {
  d: Data; monthBudgets: Budget[]; onAdd: (r: { category_id?: string; group_name?: string; amount: number }) => void; onClose: () => void; suggestion: (key: string) => number;
}) {
  // The same searchable list as a transaction's category: whole groups first, then each category
  // under its group. Lines already budgeted this month are left out.
  const taken = new Set(monthBudgets.map(budgetKey));
  const visible = d.cats.filter((c) => !c.hidden && c.kind !== 'transfer');
  const groups = [...new Set(visible.filter((c) => c.kind === 'expense').map((c) => c.group))].filter((g) => !taken.has(`g:${g}`));
  const items = [
    ...groups.map((g) => ({ id: `g:${g}`, label: `${groupIcon(g, d.groupIcons[g])}  ${g}`, group: 'Whole groups' })),
    ...visible.filter((c) => !taken.has(`c:${c.id}`)).map((c) => ({ id: `c:${c.id}`, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group })),
  ];
  return (
    <SinglePicker visible title="Add a budget" placeholder="Search categories and groups" items={items} selected={null} onClose={onClose}
      onPick={(key) => onAdd(key.startsWith('g:') ? { group_name: key.slice(2), amount: suggestion(key) } : { category_id: key.slice(2), amount: suggestion(key) })} />
  );
}

/** BUD-4: earlier months, grouped by year and collapsed. */
function Archive({ d, months }: { d: Data; months: MonthSummary[] }) {
  const { t } = d;
  const [open, setOpen] = useState<string | null>(null);
  if (!months.length) return null;
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].sort().reverse();
  const budgeted = (m: Month) => d.budgets.filter((b) => b.month === m && !(b.categoryId && d.cats.find((c) => c.id === b.categoryId)?.kind === 'income'))
    .reduce((s, b) => s + b.amount, 0);
  return (
    <>
      <Text style={[styles.h, { color: t.muted }]}>Past months</Text>
      <Card style={{ paddingVertical: 4 }}>
        {years.map((y) => {
          const list = months.filter((m) => m.month.startsWith(y)).sort((a, b) => b.month.localeCompare(a.month));
          const spent = list.reduce((s, m) => s - m.spending, 0);
          return (
            <View key={y}>
              <Pressable onPress={() => setOpen(open === y ? null : y)} style={[styles.unb, { borderColor: t.line }]}>
                <Text style={{ color: t.text, fontWeight: '600', flex: 1 }}>{open === y ? '▾' : '▸'} {y}</Text>
                <Text style={{ color: t.muted }}>{list.length} months · spent {money0(spent)}</Text>
              </Pressable>
              {open === y && list.map((m) => {
                const b = budgeted(m.month);
                return (
                  <Pressable key={m.month} onPress={() => d.setMonth(m.month)} style={[styles.child, { borderColor: t.line, paddingLeft: 20 }]}>
                    <Text style={{ color: t.text, flex: 1 }}>{monthName(m.month, false)}</Text>
                    <Text style={{ color: b && -m.spending > b ? t.danger : t.muted }}>
                      {money0(-m.spending)}{b ? ` of ${money0(b)}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </Card>
    </>
  );
}

// ───────────────────────── Compare (BUD-5) ─────────────────────────
type Against = 'prev' | 'lastYear' | 'pick';
function CompareView(d: Data) {
  const { t, month, against, setAgainst } = d;
  const aMonths = [month], bMonths = [d.base];
  const label = (ms: Month[]) => (ms.length === 1 ? monthName(ms[0]) : `${monthName(ms[0], false).slice(0, 3)}–${monthName(ms[ms.length - 1])}`);

  const spend = (ms: Month[]) => {
    const tot = totalsFor(d.rows, ms);
    const out = new Map<string, number>();
    for (const [id, v] of tot) {
      const c = d.cats.find((x) => x.id === id);
      if (id === null) { if (v < 0) out.set('none', -v); continue; }
      if (c?.kind === 'expense') out.set(id, actualFor('expense', v));
    }
    return out;
  };
  const sumIn = (ms: Month[]) => d.summaries.filter((s) => ms.includes(s.month)).reduce((s, x) => s + x.income, 0);
  const budgeted = (ms: Month[]) => d.budgets.filter((b) => ms.includes(b.month) && !(b.categoryId && d.cats.find((c) => c.id === b.categoryId)?.kind === 'income')).reduce((s, b) => s + b.amount, 0);
  const labels = new Map<string, string>([['none', 'Uncategorized'], ...d.cats.map((c) => [c.id, c.name] as [string, string])]);
  const rows = compareTotals(labels, spend(aMonths), spend(bMonths));
  const totalA = rows.reduce((s, r) => s + r.a, 0), totalB = rows.reduce((s, r) => s + r.b, 0);
  // Grouped like the Month tab: each group with its total, its categories underneath; the biggest change first.
  const groups = (() => {
    const by = new Map<string, typeof rows>();
    for (const r of rows) { const g = r.key === 'none' ? 'Uncategorized' : d.cats.find((c) => c.id === r.key)?.group ?? 'Other'; (by.get(g) ?? by.set(g, []).get(g)!).push(r); }
    return [...by.entries()].map(([group, list]) => ({ group, list, a: list.reduce((s, r) => s + r.a, 0), b: list.reduce((s, r) => s + r.b, 0) }))
      .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b));
  })();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const flip = (g: string) => setClosed((c) => { const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const iconOf = (key: string) => { const c = d.cats.find((x) => x.id === key); return c ? categoryIcon(c.name, c.icon) : '•'; };
  const head = (
    <View style={[styles.cmpHead, { borderColor: t.line }]}>
      <Text style={[styles.cmpLabel, { color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }]}>SPENDING</Text>
      <Text style={[styles.cmpNum, { color: t.text, fontWeight: '600', fontSize: 12 }]} numberOfLines={1}>{label(aMonths)}</Text>
      <Text style={[styles.cmpNum, { color: t.muted, fontSize: 12 }]} numberOfLines={1}>{label(bMonths)}</Text>
      <Text style={[styles.cmpNum, { color: t.muted, fontSize: 12 }]}>Change</Text>
    </View>
  );

  return (
    <>

      <View style={styles.tiles}>
        <CmpTile t={t} label="Spent" a={totalA} b={totalB} moreIsBad />
        <CmpTile t={t} label="Budgeted" a={budgeted(aMonths)} b={budgeted(bMonths)} />
        <CmpTile t={t} label="Money in" a={sumIn(aMonths)} b={sumIn(bMonths)} moreIsGood />
      </View>
      <Card style={{ padding: 0 }}>
        {head}
        {!groups.length && <View style={{ padding: 12 }}><Empty text="No spending in either period." /></View>}
        {groups.map((g) => {
          const single = g.list.length === 1 && g.list[0].label === g.group;
          const open = !closed.has(g.group);
          return (
            <View key={g.group}>
              <Pressable onPress={() => !single && flip(g.group)} style={[styles.groupRow, { backgroundColor: t.bg, borderColor: t.line }]}>
                <Ionicons name={single ? 'ellipse' : open ? 'chevron-down' : 'chevron-forward'} size={single ? 4 : 14} color={t.muted} />
                <CmpRow t={t} icon={g.group === 'Uncategorized' ? '•' : groupIcon(g.group, d.groupIcons[g.group])} label={g.group} a={g.a} b={g.b} bold />
              </Pressable>
              {!single && open && g.list.map((r) => (
                <View key={r.key} style={styles.lineRow}><CmpRow t={t} icon={iconOf(r.key)} label={r.label} a={r.a} b={r.b} /></View>
              ))}
            </View>
          );
        })}
        {groups.length > 0 && (
          <View style={[styles.groupRow, { borderColor: t.line, paddingLeft: 30 }]}><CmpRow t={t} icon="" label="All spending" a={totalA} b={totalB} bold /></View>
        )}
      </Card>
    </>
  );
}

function CmpRow({ t, icon, label, a, b, bold }: { t: Theme; icon: string; label: string; a: number; b: number; bold?: boolean }) {
  const change = a - b;
  const pct = b ? Math.round((change / Math.abs(b)) * 100) : null;
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={[styles.cmpLabel, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        {!!icon && <Text style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{icon}</Text>}
        <Text style={{ color: t.text, fontWeight: bold ? '700' : '400', flex: 1 }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.cmpNum, { color: t.text, fontWeight: bold ? '700' : '400' }]}>{money0(a)}</Text>
      <Text style={[styles.cmpNum, { color: t.muted }]}>{money0(b)}</Text>
      {/* More spent than before reads as a warning, less as good, the way the Month tab colours over and under. */}
      <Text style={[styles.cmpNum, { color: change === 0 ? t.muted : change > 0 ? t.danger : t.accent, fontSize: 13 }]} numberOfLines={1}>
        {change === 0 ? '—' : `${change > 0 ? '▲' : '▼'} ${money0(Math.abs(change))}`}
        {pct !== null && change !== 0 ? <Text style={{ color: t.muted }}>{` ${Math.abs(pct)}%`}</Text> : null}
      </Text>
    </View>
  );
}

/** A summary tile for the comparison: this period's figure, and how it moved against the other. */
function CmpTile({ t, label, a, b, moreIsBad, moreIsGood }: { t: Theme; label: string; a: number; b: number; moreIsBad?: boolean; moreIsGood?: boolean }) {
  const change = a - b;
  const color = change === 0 || (!moreIsBad && !moreIsGood) ? undefined : (change > 0) === !!moreIsBad ? t.danger : t.accent;
  return <Tile t={t} label={label} value={money0(a)} color={color} sub={change === 0 ? `same as ${money0(b)}` : `${change > 0 ? '▲' : '▼'} ${money0(Math.abs(change))} vs ${money0(b)}`} />;
}

// ───────────────────────── Year (BUD-6) ─────────────────────────
function YearView(d: Data) {
  const { t } = d;
  const [year, setYear] = useState(Number(d.month.slice(0, 4)));
  // Against the year before (the old "year to date" compare): the same months of both years.
  const [against, setAgainst] = useState(false);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
  const totals = months.map((m) => totalsFor(d.rows, m));
  const nowYear = Number(thisMonth().slice(0, 4));
  const upto = year === nowYear ? Number(thisMonth().slice(5, 7)) : 12;
  const before = months.slice(0, upto).map((m) => totalsFor(d.rows, addMonths(m, -12)));
  const prevOf = (key: string) => {
    const ids = key.startsWith('g:') ? expense.filter((c) => c.group === key.slice(2)).map((c) => c.id) : [key.slice(2)];
    return before.reduce((s, tt) => s + ids.reduce((x, id) => x + actualFor('expense', tt.get(id) ?? 0), 0), 0);
  };
  const span = upto === 12 ? String(year - 1) : `Jan–${monthName(months[upto - 1], false).slice(0, 3)} ${year - 1}`;
  const budgetFor = (key: string, m: Month) => d.budgets.find((b) => b.month === m && budgetKey(b) === key)?.amount;

  const expense = d.cats.filter((c) => c.kind === 'expense');
  const groups = [...new Set(expense.map((c) => c.group))].sort();
  const lines: { key: string; label: string; group: boolean; values: number[] }[] = [];
  for (const g of groups) {
    const members = expense.filter((c) => c.group === g);
    const per = members.map((c) => ({ c, values: totals.map((tt) => actualFor('expense', tt.get(c.id) ?? 0)) }))
      .filter((x) => x.values.some((v) => v !== 0) || months.some((m) => budgetFor(`c:${x.c.id}`, m) !== undefined));
    if (!per.length && !months.some((m) => budgetFor(`g:${g}`, m) !== undefined)) continue;
    lines.push({ key: `g:${g}`, label: g, group: true, values: months.map((_, i) => per.reduce((s, x) => s + x.values[i], 0)) });
    for (const x of per) lines.push({ key: `c:${x.c.id}`, label: x.c.name, group: false, values: x.values });
  }

  return (
    <>
      <Stepper label={String(year)} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} nextDisabled={year >= Number(thisMonth().slice(0, 4))} here={year === Number(thisMonth().slice(0, 4))} hereText="This year" onToday={() => setYear(Number(thisMonth().slice(0, 4)))} />
      <View style={styles.chips}>
        <Chip label={upto === 12 ? `Against ${year - 1}` : `Against the same months of ${year - 1}`} on={against} onPress={() => setAgainst(!against)} />
      </View>
      {against && lines.length > 0 && (() => {
        const groupsOnly = lines.filter((l) => l.group);
        const now = groupsOnly.reduce((s, l) => s + l.values.slice(0, upto).reduce((a, v) => a + v, 0), 0), was = groupsOnly.reduce((s, l) => s + prevOf(l.key), 0);
        return <Text style={{ color: t.text, fontSize: 13 }}>Spent {money0(now)} {upto === 12 ? `in ${year}` : `so far in ${year}`} against {money0(was)} in {span}: <Text style={{ color: now > was ? t.danger : t.accent, fontWeight: '600' }}>{now > was ? '▲' : '▼'} {money0(Math.abs(now - was))}</Text>.</Text>;
      })()}
      <Text style={{ color: t.muted, fontSize: 13 }}>Spending per month. Where a budget was set, it shows underneath; red means over. Scroll sideways for all 12 months; tap an amount for its transactions.</Text>
      {!lines.length ? <Empty text={`No spending in ${year}.`} /> : (
        <Card style={{ padding: 0 }}>
          <ScrollView horizontal>
            <View>
              <View style={[styles.yRow, { borderColor: t.line }]}>
                <Text style={[styles.yLabel, { color: t.muted }]}>Category</Text>
                {months.map((m) => <Text key={m} style={[styles.yCell, { color: t.muted }]}>{monthName(m, false).slice(0, 3)}</Text>)}
                <Text style={[styles.yCell, { color: t.muted, fontWeight: '600' }]}>Total</Text>
                {against && <Text style={[styles.yCell, { color: t.muted }]} numberOfLines={1}>{upto === 12 ? year - 1 : `${year - 1} YTD`}</Text>}
                {against && <Text style={[styles.yCell, { color: t.muted }]}>Change</Text>}
              </View>
              {lines.map((l) => (
                <View key={l.key} style={[styles.yRow, { borderColor: t.line }, l.group && { backgroundColor: t.bg }]}>
                  <Text style={[styles.yLabel, { color: t.text, fontWeight: l.group ? '600' : '400', paddingLeft: l.group ? 8 : 18 }]} numberOfLines={1}>{l.key.startsWith('g:') ? groupIcon(l.label, d.groupIcons[l.label]) : (() => { const c = d.cats.find((x) => x.id === l.key.slice(2)); return c ? categoryIcon(c.name, c.icon) : '•'; })()}  {l.label}</Text>
                  {l.values.map((v, i) => {
                    const b = budgetFor(l.key, months[i]);
                    const over = b !== undefined && v > b;
                    return (
                      <Pressable key={i} style={styles.yCellBox} disabled={!v}
                        onPress={() => drill(d, l.key.startsWith('g:') ? { categoryId: null, groupName: l.label, label: l.label } : { categoryId: l.key.slice(2), groupName: null, label: l.label }, months[i], monthEnd(months[i]))}>
                        <Text style={{ color: over ? t.danger : v ? t.text : t.muted, textAlign: 'right', fontSize: 13 }}>{v ? money0(v) : '–'}</Text>
                        {b !== undefined && <Text style={{ color: t.muted, textAlign: 'right', fontSize: 12 }}>of {money0(b)}</Text>}
                      </Pressable>
                    );
                  })}
                  <Text style={[styles.yCell, { color: t.text, fontWeight: '600' }]}>{money0(l.values.reduce((s, v) => s + v, 0))}</Text>
                  {against && (() => {
                    const was = prevOf(l.key), now = l.values.slice(0, upto).reduce((s, v) => s + v, 0), ch = now - was;
                    return <>
                      <Text style={[styles.yCell, { color: t.muted }]}>{was ? money0(was) : '–'}</Text>
                      <Text style={[styles.yCell, { color: Math.abs(ch) < 0.5 ? t.muted : ch > 0 ? t.danger : t.accent }]}>{Math.abs(ch) < 0.5 ? '—' : `${ch > 0 ? '▲' : '▼'} ${money0(Math.abs(ch))}`}</Text>
                    </>;
                  })()}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  viewSwitch: { paddingHorizontal: 12, paddingBottom: 6, gap: 8, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  page: { paddingHorizontal: 12, paddingTop: 4, gap: 8, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '22%', minWidth: 78, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 30, paddingRight: 12, paddingVertical: 7 },
  icon: { width: 22, fontSize: 16, textAlign: 'center' },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  total: { gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderLeftWidth: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'transparent' },
  cardHead: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  h: { fontSize: 12, fontWeight: '700', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unb: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  child: { flexDirection: 'row', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 8, padding: 8, width: 120, textAlign: 'right' },
  cmpHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  cmpLabel: { flex: 1.4 },
  cmpNum: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  yRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 40 },
  yLabel: { width: 170, paddingRight: 8 },
  yCell: { width: 74, textAlign: 'right', paddingRight: 10, fontVariant: ['tabular-nums'] },
  yCellBox: { width: 74, paddingRight: 10 },
});
