// Budget tab (BUD-1, 2, 4, 5, 6): this month's budget, past months in a collapsed archive by year,
// comparisons with other months or years, and a year view of budget vs actual by month.
import {
  actualFor, addMonths, budgetKey, buildBudgetMonth, carryInto, compareTotals, formatMoney, monthEnd, monthName,
  suggestBudget, todayIn, type BudgetLine, type Month,
} from '@budget-app/core';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Field, Sheet } from '@/components/Forms';
import { TopBar } from '@/components/TopBar';
import { Button, Card, Chip, Empty, Segmented, Stepper } from '@/components/ui';
import {
  loadBudgets, loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, totalsFor,
  type Budget, type Category, type CategoryMonth, type MonthSummary,
} from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';

type View_ = 'month' | 'compare' | 'year';
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export default function BudgetTab() {
  const t = useTheme();
  const [view, setView] = useState<View_>('month');
  const [month, setMonth] = useState<Month>(thisMonth());
  const [cats, setCats] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [rows, setRows] = useState<CategoryMonth[]>([]);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, b, s] = await Promise.all([loadCategories(), loadBudgets(), loadMonthSummaries()]);
      const now = thisMonth();
      const first = [...s.map((x) => x.month), ...b.map((x) => x.month), addMonths(now, -12)].sort()[0];
      setCats(c); setBudgets(b); setSummaries(s);
      setRows(await loadCategoryMonths(first, now > month ? now : month));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const data = { t, cats, budgets, rows, summaries, month, setMonth, reload: load, setError, setView };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    <TopBar>
      <View style={{ flex: 1 }}>
        <Segmented<View_> value={view} onChange={setView}
          options={[{ value: 'month', label: 'Month' }, { value: 'compare', label: 'Compare' }, { value: 'year', label: 'Year' }]} />
      </View>
    </TopBar>
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {view === 'month' && <MonthView {...data} />}
      {view === 'compare' && <CompareView {...data} />}
      {view === 'year' && <YearView {...data} />}
    </ScrollView>
    </View>
  );
}

interface Data {
  t: Theme; cats: Category[]; budgets: Budget[]; rows: CategoryMonth[]; summaries: MonthSummary[];
  month: Month; setMonth: (m: Month) => void; reload: () => void; setError: (e: string) => void; setView: (v: View_) => void;
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
  const q = new URLSearchParams({ from, to, title: line.label });
  if (line.categoryId) q.set('category', line.categoryId);
  else if (line.groupName) q.set('group', line.groupName);
  else q.set('category', 'none');
  router.push(`/report?${q.toString()}` as any);
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
  const pace = month === current ? Number(todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone).slice(8, 10)) / daysIn : month < current ? 1 : 0;
  const pastMonths = d.summaries.filter((s) => s.month < current && s.month !== month);
  const tot = view.totals;
  const toggle = (g: string) => setCollapsed((c) => { const n = new Set(c); n.has(g) ? n.delete(g) : n.add(g); return n; });

  return (
    <>
      <Stepper label={monthName(month)} onPrev={() => d.setMonth(addMonths(month, -1))} onNext={() => d.setMonth(addMonths(month, 1))} nextDisabled={month >= current} />

      <View style={styles.tiles}>
        <Tile t={t} label="Spent" value={money0(tot.actualExpenses)} sub={tot.budgetedExpenses ? `of ${money0(tot.budgetedExpenses)}` : 'no budget'} />
        <Tile t={t} label={tot.actualExpenses > tot.budgetedExpenses && tot.budgetedExpenses ? 'Over' : 'Left'} warn={tot.actualExpenses > tot.budgetedExpenses && tot.budgetedExpenses > 0}
          value={money0(Math.abs(tot.budgetedExpenses - tot.actualExpenses))} sub={pace > 0 && pace < 1 ? `${Math.round(pace * 100)}% of month` : ''} />
        <Tile t={t} label="Money in" value={money0(tot.actualIncome)} sub={tot.budgetedIncome ? `of ${money0(tot.budgetedIncome)}` : ''} />
        <Tile t={t} label="Unbudgeted" value={money0(tot.budgetedIncome - tot.budgetedExpenses)} sub="income − budget" />
      </View>
      {tot.unbudgetedExpenses > 0 && <Text style={{ color: t.muted, fontSize: 12 }}>{formatMoney(tot.unbudgetedExpenses)} spent outside the budget (listed at the bottom).</Text>}

      {!monthBudgets.length && (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>No budget for {monthName(month, false)} yet</Text>
          {previous && <Button title={`Copy ${monthName(previous)}'s budget`} onPress={() => copyFrom(previous)} busy={busy} />}
          <Button title="Suggest one from the last 3 months" kind={previous ? 'plain' : 'primary'} onPress={suggestAll} busy={busy} />
        </Card>
      )}

      {groupedExpenses.length > 0 && (
        <Card style={{ padding: 0 }}>
          <ColumnHead t={t} />
          {groupedExpenses.map((g) => {
            const open = !collapsed.has(g.group);
            const single = g.lines.length === 1 && g.lines[0].groupName;
            return (
              <View key={g.group}>
                <Pressable onPress={() => (single ? setEditing(g.lines[0]) : toggle(g.group))} style={[styles.groupRow, { backgroundColor: t.bg, borderColor: t.line }]}>
                  {!single && <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={t.muted} />}
                  <Line t={t} label={g.group} actual={g.actual} available={g.available} pace={pace} bold />
                </Pressable>
                {!single && open && g.lines.map((l) => (
                  <Pressable key={l.key} onPress={() => setEditing(l)} style={({ pressed }) => [styles.lineRow, pressed && { backgroundColor: t.line }]}>
                    <Line t={t} label={l.label + (l.groupName ? ' (whole group)' : '')} actual={l.actual} available={l.available} pace={pace} carry={l.carryIn} />
                  </Pressable>
                ))}
              </View>
            );
          })}
        </Card>
      )}

      {view.income.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Text style={[styles.cardHead, { color: t.muted }]}>MONEY IN</Text>
          {[...view.income].sort((a, b) => b.actual - a.actual || b.available - a.available).map((l) => (
            <Pressable key={l.key} onPress={() => setEditing(l)} style={styles.lineRow}>
              <Line t={t} label={l.label} actual={l.actual} available={l.available} pace={pace} income />
            </Pressable>
          ))}
        </Card>
      )}

      {view.unbudgeted.length > 0 && (
        <Card style={{ padding: 0 }}>
          <Text style={[styles.cardHead, { color: t.muted }]}>NOT BUDGETED</Text>
          {view.unbudgeted.map((l) => (
            <View key={l.key} style={[styles.lineRow, { gap: 8 }]}>
              <Pressable style={{ flex: 1 }} onPress={() => drill(d, l, month, monthEnd(month))}>
                <Text style={{ color: t.text, fontSize: 13 }} numberOfLines={1}>{l.label}</Text>
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

      {monthBudgets.length > 0 && <Button title={adding ? 'Close' : 'Add a budget'} kind="plain" onPress={() => setAdding(!adding)} />}
      {adding && <AddBudget d={d} monthBudgets={monthBudgets} onAdd={(r) => { add([r]); setAdding(false); }} suggestion={suggestion} />}

      <Archive d={d} months={pastMonths} />
      {editing && <BudgetEditor d={d} line={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ColumnHead({ t }: { t: Theme }) {
  return (
    <View style={[styles.lineRow, { paddingVertical: 6 }]}>
      <Text style={[styles.colLabel, { color: t.muted }]}>CATEGORY</Text>
      <Text style={[styles.colBar, { color: t.muted, fontSize: 10 }]}>│ = pace</Text>
      <Text style={[styles.colNum, { color: t.muted, fontSize: 10 }]}>SPENT / BUDGET</Text>
      <Text style={[styles.colLeft, { color: t.muted, fontSize: 10 }]}>LEFT</Text>
    </View>
  );
}

/** One budget line: label · bar (with pace tick) · spent / budget · left (or over). */
function Line({ t, label, actual, available, pace, bold, income, carry }: {
  t: Theme; label: string; actual: number; available: number; pace: number; bold?: boolean; income?: boolean; carry?: number;
}) {
  const left = income ? actual - available : available - actual;
  const over = !income && left < 0;
  const ahead = !income && available > 0 && pace > 0 && pace < 1 && actual / available > pace + 0.1 && !over;
  const fill = available > 0 ? Math.min(1, actual / available) : actual > 0 ? 1 : 0;
  return (
    <>
      <Text style={[styles.colLabel, { color: t.text, fontWeight: bold ? '700' : '400', fontSize: bold ? 14 : 13 }]} numberOfLines={1}>
        {label}{carry ? <Text style={{ color: t.muted, fontSize: 11 }}>{` ${carry > 0 ? '+' : '−'}${money0(Math.abs(carry))}`}</Text> : null}
      </Text>
      <View style={styles.colBar}>
        <View style={{ height: bold ? 8 : 6, borderRadius: 4, backgroundColor: t.track, overflow: 'hidden' }}>
          <View style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 4, backgroundColor: over ? t.danger : income ? t.series1 : ahead ? t.series2 : t.accent }} />
        </View>
        {pace > 0 && pace < 1 && !income && <View style={{ position: 'absolute', left: `${pace * 100}%`, top: -2, bottom: -2, width: 1.5, backgroundColor: t.text, opacity: 0.45 }} />}
      </View>
      <Text style={[styles.colNum, { color: t.text, fontWeight: bold ? '600' : '400' }]} numberOfLines={1}>
        {money0(actual)}<Text style={{ color: t.muted }}>{` / ${money0(available)}`}</Text>
      </Text>
      <Text style={[styles.colLeft, { color: over ? t.danger : t.muted, fontWeight: over ? '700' : '400' }]} numberOfLines={1}>
        {over ? `−${money0(-left)}` : money0(left)}
      </Text>
    </>
  );
}

function Tile({ t, label, value, sub, warn }: { t: Theme; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: warn ? t.danger : t.line }]}>
      <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: warn ? t.danger : t.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

/** Pop-up to change one budget: amount, rollover, see its transactions, remove. */
function BudgetEditor({ d, line, onClose }: { d: Data; line: BudgetLine; onClose: () => void }) {
  const { t, month } = d;
  const budget = d.budgets.find((b) => b.month === month && budgetKey(b) === line.key);
  const [amount, setAmount] = useState(String(line.budgeted));
  const [rollover, setRollover] = useState(line.rollover);
  const income = line.kind === 'income';
  const last3 = [1, 2, 3].map((n) => actualOfKey(d, line.key, addMonths(month, -n)));
  const save = async () => {
    const v = Number(amount.replace(/[$,\s]/g, ''));
    if (!budget || isNaN(v)) return;
    const { error } = await supabase.from('budgets').update({ amount: v, rollover }).eq('id', budget.id);
    if (error) d.setError(error.message); else { onClose(); d.reload(); }
  };
  const remove = async () => {
    if (!budget) return;
    const { error } = await supabase.from('budgets').delete().eq('id', budget.id);
    if (error) d.setError(error.message); else { onClose(); d.reload(); }
  };
  return (
    <Sheet title={`${line.label} · ${monthName(month)}`} onClose={onClose}
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
      <Button title="See this month's transactions" kind="plain" onPress={() => { onClose(); drill(d, line, month, monthEnd(month)); }} />
    </Sheet>
  );
}

function AddBudget({ d, monthBudgets, onAdd, suggestion }: {
  d: Data; monthBudgets: Budget[]; onAdd: (r: { category_id?: string; group_name?: string; amount: number }) => void; suggestion: (key: string) => number;
}) {
  const { t } = d;
  const taken = new Set(monthBudgets.map(budgetKey));
  const visible = d.cats.filter((c) => !c.hidden && c.kind !== 'transfer');
  const groups = [...new Set(visible.filter((c) => c.kind === 'expense').map((c) => c.group))].filter((g) => !taken.has(`g:${g}`));
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ color: t.muted }}>A whole group…</Text>
      <View style={styles.chips}>{groups.map((g) => <Chip key={g} label={g} onPress={() => onAdd({ group_name: g, amount: suggestion(`g:${g}`) })} />)}</View>
      <Text style={{ color: t.muted }}>…or one category</Text>
      <View style={styles.chips}>
        {visible.filter((c) => !taken.has(`c:${c.id}`)).map((c) => (
          <Chip key={c.id} label={c.name} onPress={() => onAdd({ category_id: c.id, amount: suggestion(`c:${c.id}`) })} />
        ))}
      </View>
      <Text style={{ color: t.muted, fontSize: 13 }}>Starts at your 3-month average; tap the new line to change it.</Text>
    </Card>
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
  const { t, month } = d;
  const [against, setAgainst] = useState<Against>('prev');
  const [picked, setPicked] = useState<Month>(addMonths(month, -2));
  const [scope, setScope] = useState<'month' | 'ytd'>('month');

  const other = against === 'prev' ? addMonths(month, -1) : against === 'lastYear' ? addMonths(month, -12) : picked;
  const span = (end: Month): Month[] => {
    if (scope === 'month') return [end];
    const out: Month[] = [];
    for (let m = end.slice(0, 4) + '-01-01'; m <= end; m = addMonths(m, 1)) out.push(m);
    return out;
  };
  const aMonths = span(month), bMonths = span(scope === 'ytd' ? addMonths(month, -12) : other);
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

  return (
    <>
      <Stepper label={monthName(month)} onPrev={() => d.setMonth(addMonths(month, -1))} onNext={() => d.setMonth(addMonths(month, 1))} nextDisabled={month >= thisMonth()} />
      <Segmented value={scope} onChange={setScope} options={[{ value: 'month', label: 'One month' }, { value: 'ytd', label: 'Year to date' }]} />
      {scope === 'month' && (
        <View style={styles.chips}>
          <Chip label="Last month" on={against === 'prev'} onPress={() => setAgainst('prev')} />
          <Chip label="Same month last year" on={against === 'lastYear'} onPress={() => setAgainst('lastYear')} />
          <Chip label="Pick a month" on={against === 'pick'} onPress={() => setAgainst('pick')} />
        </View>
      )}
      {scope === 'month' && against === 'pick' && <Stepper label={monthName(picked)} onPrev={() => setPicked(addMonths(picked, -1))} onNext={() => setPicked(addMonths(picked, 1))} />}

      <Card style={{ paddingVertical: 8 }}>
        <View style={[styles.cmpRow, { borderColor: t.line }]}>
          <Text style={[styles.cmpLabel, { color: t.muted }]} />
          <Text style={[styles.cmpNum, { color: t.text, fontWeight: '600' }]}>{label(aMonths)}</Text>
          <Text style={[styles.cmpNum, { color: t.muted }]}>{label(bMonths)}</Text>
          <Text style={[styles.cmpNum, { color: t.muted }]}>Change</Text>
        </View>
        <CmpRow t={t} label="Spent" a={totalA} b={totalB} bold />
        <CmpRow t={t} label="Budgeted" a={budgeted(aMonths)} b={budgeted(bMonths)} />
        <CmpRow t={t} label="Money in" a={sumIn(aMonths)} b={sumIn(bMonths)} />
      </Card>
      <Text style={[styles.h, { color: t.muted }]}>By category, biggest change first</Text>
      <Card style={{ paddingVertical: 8 }}>
        {rows.length ? rows.map((r) => <CmpRow key={r.key} t={t} label={r.label} a={r.a} b={r.b} />) : <Empty text="No spending in either period." />}
      </Card>
    </>
  );
}

function CmpRow({ t, label, a, b, bold }: { t: Theme; label: string; a: number; b: number; bold?: boolean }) {
  const change = a - b;
  const pct = b ? Math.round((change / Math.abs(b)) * 100) : null;
  return (
    <View style={[styles.cmpRow, { borderColor: t.line }]}>
      <Text style={[styles.cmpLabel, { color: t.text, fontWeight: bold ? '600' : '400' }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.cmpNum, { color: t.text }]}>{money0(a)}</Text>
      <Text style={[styles.cmpNum, { color: t.muted }]}>{money0(b)}</Text>
      <Text style={[styles.cmpNum, { color: t.text }]}>
        {change === 0 ? '—' : `${change > 0 ? '▲' : '▼'} ${money0(Math.abs(change))}`}
        {pct !== null && change !== 0 ? <Text style={{ color: t.muted }}>{` ${Math.abs(pct)}%`}</Text> : null}
      </Text>
    </View>
  );
}

// ───────────────────────── Year (BUD-6) ─────────────────────────
function YearView(d: Data) {
  const { t } = d;
  const [year, setYear] = useState(Number(d.month.slice(0, 4)));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
  const totals = months.map((m) => totalsFor(d.rows, m));
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
      <Stepper label={String(year)} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} nextDisabled={year >= Number(thisMonth().slice(0, 4))} />
      <Text style={{ color: t.muted, fontSize: 13 }}>Spending per month. Where a budget was set, it shows underneath; red means over. Scroll sideways for all 12 months.</Text>
      {!lines.length ? <Empty text={`No spending in ${year}.`} /> : (
        <Card style={{ padding: 0 }}>
          <ScrollView horizontal>
            <View>
              <View style={[styles.yRow, { borderColor: t.line }]}>
                <Text style={[styles.yLabel, { color: t.muted }]}>Category</Text>
                {months.map((m) => <Text key={m} style={[styles.yCell, { color: t.muted }]}>{monthName(m, false).slice(0, 3)}</Text>)}
                <Text style={[styles.yCell, { color: t.muted, fontWeight: '600' }]}>Total</Text>
              </View>
              {lines.map((l) => (
                <View key={l.key} style={[styles.yRow, { borderColor: t.line }, l.group && { backgroundColor: t.bg }]}>
                  <Text style={[styles.yLabel, { color: t.text, fontWeight: l.group ? '600' : '400', paddingLeft: l.group ? 8 : 18 }]} numberOfLines={1}>{l.label}</Text>
                  {l.values.map((v, i) => {
                    const b = budgetFor(l.key, months[i]);
                    const over = b !== undefined && v > b;
                    return (
                      <View key={i} style={styles.yCellBox}>
                        <Text style={{ color: over ? t.danger : v ? t.text : t.muted, textAlign: 'right', fontSize: 13 }}>{v ? money0(v) : '–'}</Text>
                        {b !== undefined && <Text style={{ color: t.muted, textAlign: 'right', fontSize: 11 }}>{over ? '! ' : ''}of {money0(b)}</Text>}
                      </View>
                    );
                  })}
                  <Text style={[styles.yCell, { color: t.text, fontWeight: '600' }]}>{money0(l.values.reduce((s, v) => s + v, 0))}</Text>
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
  page: { paddingHorizontal: 12, paddingTop: 4, gap: 8, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { flexGrow: 1, flexBasis: '22%', minWidth: 78, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 30, paddingRight: 10, paddingVertical: 6 },
  cardHead: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  colLabel: { flex: 1.6 },
  colBar: { flex: 1.2, justifyContent: 'center' },
  colNum: { width: 104, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] },
  colLeft: { width: 52, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] },
  h: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unb: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  child: { flexDirection: 'row', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 8, padding: 8, width: 120, textAlign: 'right' },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  cmpLabel: { flex: 1.4 },
  cmpNum: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  yRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 40 },
  yLabel: { width: 170, paddingRight: 8 },
  yCell: { width: 74, textAlign: 'right', paddingRight: 10, fontVariant: ['tabular-nums'] },
  yCellBox: { width: 74, paddingRight: 10 },
});
