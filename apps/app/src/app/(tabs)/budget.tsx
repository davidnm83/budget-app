// Budget tab (BUD-1, 2, 4, 5, 6): this month's budget, past months in a collapsed archive by year,
// comparisons with other months or years, and a year view of budget vs actual by month.
import {
  actualFor, addMonths, budgetKey, buildBudgetMonth, carryInto, compareTotals, formatMoney, monthEnd, monthName,
  suggestBudget, type BudgetLine, type Month,
} from '@budget-app/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Bar, Button, Card, Chip, Empty, Segmented, Stepper } from '@/components/ui';
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
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Segmented<View_> value={view} onChange={setView}
        options={[{ value: 'month', label: 'Month' }, { value: 'compare', label: 'Compare' }, { value: 'year', label: 'Year' }]} />
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {view === 'month' && <MonthView {...data} />}
      {view === 'compare' && <CompareView {...data} />}
      {view === 'year' && <YearView {...data} />}
    </ScrollView>
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
function MonthView(d: Data) {
  const { t, month } = d;
  const current = thisMonth();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

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

  // Category budgets sit under their group with a subtotal, as in Fina.
  const groupedExpenses = useMemo(() => {
    const groupOf = (l: BudgetLine) => l.groupName ?? d.cats.find((c) => c.id === l.categoryId)?.group ?? 'Other';
    const sortOf = (l: BudgetLine) => (l.groupName ? -1 : d.cats.find((c) => c.id === l.categoryId)?.sort ?? 0);
    const order: string[] = [];
    const m = new Map<string, BudgetLine[]>();
    for (const l of [...view.expenses].sort((a, b) => sortOf(a) - sortOf(b))) {
      const g = groupOf(l);
      if (!m.has(g)) { m.set(g, []); order.push(g); }
      m.get(g)!.push(l);
    }
    const firstSort = (g: string) => Math.min(...m.get(g)!.map((l) => (l.groupName ? Math.min(...d.cats.filter((c) => c.group === g && !c.hidden).map((c) => c.sort), 1e9) : sortOf(l))));
    return order.sort((a, b) => firstSort(a) - firstSort(b)).map((group) => {
      const lines = m.get(group)!;
      return { group, lines, available: lines.reduce((x, l) => x + l.available, 0), actual: lines.reduce((x, l) => x + l.actual, 0) };
    });
  }, [view, d.cats]);

  const pastMonths = d.summaries.filter((s) => s.month < current && s.month !== month);
  const tot = view.totals;
  const spentPct = tot.budgetedExpenses ? tot.actualExpenses / tot.budgetedExpenses : 0;

  return (
    <>
      <Stepper label={monthName(month)} onPrev={() => d.setMonth(addMonths(month, -1))} onNext={() => d.setMonth(addMonths(month, 1))} nextDisabled={month >= current} />

      <Card style={{ gap: 10 }}>
        <View style={styles.between}>
          <Text style={{ color: t.muted }}>Spent</Text>
          <Text style={{ color: t.text }}>
            <Text style={{ fontWeight: '700', fontSize: 18 }}>{formatMoney(tot.actualExpenses)}</Text>
            {tot.budgetedExpenses ? <Text style={{ color: t.muted }}> of {formatMoney(tot.budgetedExpenses)}</Text> : null}
          </Text>
        </View>
        {tot.budgetedExpenses > 0 && <Bar value={tot.actualExpenses} max={tot.budgetedExpenses} color={t.accent} overColor={t.danger} />}
        <View style={styles.between}>
          <Text style={{ color: t.muted }}>Money in</Text>
          <Text style={{ color: t.text }}>{formatMoney(tot.actualIncome)}{tot.budgetedIncome ? <Text style={{ color: t.muted }}> of {formatMoney(tot.budgetedIncome)} expected</Text> : null}</Text>
        </View>
        {tot.budgetedIncome > 0 && tot.budgetedExpenses > 0 && (
          <Text style={{ color: t.muted }}>
            Plan: {formatMoney(tot.budgetedIncome)} in − {formatMoney(tot.budgetedExpenses)} budgeted = {' '}
            <Text style={{ color: tot.budgetedIncome < tot.budgetedExpenses ? t.danger : t.text, fontWeight: '600' }}>{formatMoney(tot.budgetedIncome - tot.budgetedExpenses)} unbudgeted</Text>
          </Text>
        )}
        {tot.budgetedExpenses > 0 && (
          <Text style={{ color: spentPct > 1 ? t.danger : t.muted }}>
            {spentPct > 1 ? `Over budget by ${formatMoney(tot.actualExpenses - tot.budgetedExpenses)}` : `${formatMoney(tot.budgetedExpenses - tot.actualExpenses)} left to spend`}
            {tot.unbudgetedExpenses ? ` · ${formatMoney(tot.unbudgetedExpenses)} not budgeted` : ''}
          </Text>
        )}
      </Card>

      {!monthBudgets.length && (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>No budget for {monthName(month, false)} yet</Text>
          {previous && <Button title={`Copy ${monthName(previous)}'s budget`} onPress={() => copyFrom(previous)} busy={busy} />}
          <Button title="Suggest one from the last 3 months" kind={previous ? 'plain' : 'primary'} onPress={suggestAll} busy={busy} />
          <Text style={{ color: t.muted, fontSize: 13 }}>The suggestion sets one budget per group at your average spending, rounded up to $5. Change any of them after.</Text>
        </Card>
      )}

      {groupedExpenses.map((g) => (
        <View key={g.group} style={{ gap: 8 }}>
          <View style={[styles.between, { marginTop: 8 }]}>
            <Text style={[styles.h, { color: t.muted, marginTop: 0 }]}>{g.group}</Text>
            <Text style={{ color: g.actual > g.available ? t.danger : t.muted, fontSize: 13 }}>{money0(g.actual)} of {money0(g.available)}</Text>
          </View>
          {g.lines.map((l) => (
            <BudgetLineRow key={l.key} d={d} line={l} editing={editing === l.key} onEdit={() => setEditing(editing === l.key ? null : l.key)} />
          ))}
        </View>
      ))}

      {view.income.length > 0 && <Text style={[styles.h, { color: t.muted }]}>Money in</Text>}
      {view.income.map((l) => (
        <BudgetLineRow key={l.key} d={d} line={l} editing={editing === l.key} onEdit={() => setEditing(editing === l.key ? null : l.key)} />
      ))}

      {view.unbudgeted.length > 0 && <Text style={[styles.h, { color: t.muted }]}>Not budgeted</Text>}
      {view.unbudgeted.length > 0 && (
        <Card style={{ paddingVertical: 4 }}>
          {view.unbudgeted.map((l) => (
            <View key={l.key} style={[styles.unb, { borderColor: t.line }]}>
              <Pressable style={{ flex: 1 }} onPress={() => drill(d, l, month, monthEnd(month))}>
                <Text style={{ color: t.text }}>{l.label}</Text>
              </Pressable>
              <Text style={{ color: t.text, marginRight: 10 }}>{l.kind === 'income' ? '+' : ''}{formatMoney(l.actual)}</Text>
              {l.categoryId && (
                <Pressable onPress={() => add([{ category_id: l.categoryId!, amount: suggestion(l.key) || Math.ceil(l.actual / 5) * 5 }])} hitSlop={8}>
                  <Text style={{ color: t.accent }}>+ Budget</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      )}

      {monthBudgets.length > 0 && <Button title={adding ? 'Close' : 'Add a budget'} kind="plain" onPress={() => setAdding(!adding)} />}
      {adding && <AddBudget d={d} monthBudgets={monthBudgets} onAdd={(r) => { add([r]); setAdding(false); }} suggestion={suggestion} />}

      <Archive d={d} months={pastMonths} />
    </>
  );
}

function BudgetLineRow({ d, line, editing, onEdit }: { d: Data; line: BudgetLine; editing: boolean; onEdit: () => void }) {
  const { t, month } = d;
  const [amount, setAmount] = useState(String(line.budgeted));
  const [rollover, setRollover] = useState(line.rollover);
  const income = line.kind === 'income';
  const over = !income && line.left < 0;
  const budget = d.budgets.find((b) => b.month === month && budgetKey(b) === line.key);
  useEffect(() => { if (editing) { setAmount(String(line.budgeted)); setRollover(line.rollover); } }, [editing, line.budgeted, line.rollover]);

  const save = async () => {
    const v = Number(amount.replace(/[$,\s]/g, ''));
    if (!budget || isNaN(v)) return;
    const { error } = await supabase.from('budgets').update({ amount: v, rollover }).eq('id', budget.id);
    if (error) d.setError(error.message); else { onEdit(); d.reload(); }
  };
  const remove = async () => {
    if (!budget) return;
    const { error } = await supabase.from('budgets').delete().eq('id', budget.id);
    if (error) d.setError(error.message); else { onEdit(); d.reload(); }
  };

  return (
    <Card style={{ gap: 6, paddingVertical: 12 }}>
      <Pressable onPress={onEdit} style={{ gap: 6 }}>
        <View style={styles.between}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: line.groupName ? '600' : '400', flex: 1 }}>{line.label}</Text>
          <Text style={{ color: t.text }}>{formatMoney(line.actual)}<Text style={{ color: t.muted }}> / {formatMoney(line.available)}</Text></Text>
        </View>
        <Bar value={line.actual} max={line.available} color={income ? t.series1 : t.accent} overColor={income ? t.series1 : t.danger} />
        <Text style={{ color: over ? t.danger : t.muted, fontSize: 13 }}>
          {income
            ? (line.left >= 0 ? `${formatMoney(line.left)} more than expected` : `${formatMoney(-line.left)} still to come`)
            : (over ? `${formatMoney(-line.left)} over` : `${formatMoney(line.left)} left`)}
          {line.carryIn ? ` · includes ${formatMoney(line.carryIn)} ${line.carryIn > 0 ? 'rolled over' : 'overspent last month'}` : ''}
        </Text>
      </Pressable>
      {line.children?.map((c) => (
        <Pressable key={c.key} onPress={() => drill(d, c, month, monthEnd(month))} style={[styles.child, { borderColor: t.line }]}>
          <Text style={{ color: t.muted, flex: 1 }}>{c.label}</Text>
          <Text style={{ color: t.muted }}>{formatMoney(c.actual)}</Text>
        </Pressable>
      ))}
      {editing && (
        <View style={{ gap: 8, marginTop: 6 }}>
          <View style={[styles.between, { gap: 8 }]}>
            <Text style={{ color: t.text }}>{income ? 'Expected' : 'Budget'}</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" onSubmitEditing={save}
              style={[styles.input, { color: t.text, borderColor: t.line }]} />
          </View>
          {!income && (
            <View style={styles.between}>
              <Text style={{ color: t.text, flex: 1 }}>Roll what's left (or overspent) into next month</Text>
              <Switch value={rollover} onValueChange={setRollover} />
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Save" onPress={save} style={{ flex: 1 }} />
            <Button title="See transactions" kind="plain" onPress={() => drill(d, line, month, monthEnd(month))} style={{ flex: 1 }} />
            <Button title="Remove" kind="danger" onPress={remove} />
          </View>
        </View>
      )}
    </Card>
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
  page: { padding: 16, gap: 10, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
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
