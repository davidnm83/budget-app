// Reports tab (RPT-1, 2, 3): spending by category with drill-down, cash flow by month with income
// by source, and spending by merchant. All for a chosen date range.
import { addMonths, formatMoney, monthEnd, monthName, todayIn } from '@budget-app/core';
// Month totals cover whole months; ranges here always start on the 1st and end today or at a month end.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bar, Card, Chip, Empty, Segmented } from '@/components/ui';
import {
  loadCategories, loadCategoryMonths, loadMerchants, loadMonthSummaries, thisMonth,
  type Category, type CategoryMonth, type MerchantTotal, type MonthSummary,
} from '@/lib/reports';
import { useTheme, type Theme } from '@/lib/theme';

type Tab = 'categories' | 'cashflow' | 'merchants';
type RangeKey = 'month' | 'last' | '3m' | 'year' | '12m' | 'all';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: 'This month' }, { key: 'last', label: 'Last month' }, { key: '3m', label: '3 months' },
  { key: 'year', label: 'This year' }, { key: '12m', label: '12 months' }, { key: 'all', label: 'All time' },
];
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

function rangeOf(k: RangeKey): { from: string; to: string; label: string } {
  const now = thisMonth();
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
  switch (k) {
    case 'month': return { from: now, to: today, label: monthName(now) };
    case 'last': { const m = addMonths(now, -1); return { from: m, to: monthEnd(m), label: monthName(m) }; }
    case '3m': return { from: addMonths(now, -2), to: today, label: `${monthName(addMonths(now, -2), false)} – ${monthName(now)}` };
    case 'year': return { from: now.slice(0, 4) + '-01-01', to: today, label: now.slice(0, 4) };
    case '12m': return { from: addMonths(now, -11), to: today, label: 'Last 12 months' };
    default: return { from: '1900-01-01', to: today, label: 'All time' };
  }
}

export default function Reports() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('categories');
  const [rk, setRk] = useState<RangeKey>('month');
  const [cats, setCats] = useState<Category[]>([]);
  const [rows, setRows] = useState<CategoryMonth[]>([]);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [merchants, setMerchants] = useState<MerchantTotal[]>([]);
  const [sources, setSources] = useState<MerchantTotal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const range = rangeOf(rk);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = rangeOf(rk);
      const [c, s, m, inc] = await Promise.all([
        loadCategories(), loadMonthSummaries(r.from, r.to), loadMerchants(r.from, r.to), loadMerchants(r.from, r.to, 'income'),
      ]);
      setCats(c); setMonths(s); setMerchants(m); setSources(inc);
      // report_months is newest first, so its last row is the oldest month with activity.
      setRows(s.length ? await loadCategoryMonths(s[s.length - 1].month, s[0].month) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [rk]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (q: Record<string, string>) =>
    router.push(`/report?${new URLSearchParams({ from: range.from, to: range.to, ...q }).toString()}` as any);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Segmented<Tab> value={tab} onChange={setTab}
        options={[{ value: 'categories', label: 'Categories' }, { value: 'cashflow', label: 'Cash flow' }, { value: 'merchants', label: 'Merchants' }]} />
      <View style={styles.chips}>{RANGES.map((r) => <Chip key={r.key} label={r.label} on={rk === r.key} onPress={() => setRk(r.key)} />)}</View>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {tab === 'categories' && <ByCategory t={t} cats={cats} rows={rows} open={open} />}
      {tab === 'cashflow' && <CashFlow t={t} months={months} sources={sources} open={open} />}
      {tab === 'merchants' && <ByMerchant t={t} list={merchants} open={open} />}
    </ScrollView>
  );
}

// RPT-1
function ByCategory({ t, cats, rows, open }: { t: Theme; cats: Category[]; rows: CategoryMonth[]; open: (q: Record<string, string>) => void }) {
  const groups = useMemo(() => {
    const byCat = new Map<string | null, number>();
    for (const r of rows) if (r.kind === 'expense') byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) - r.total);
    const m = new Map<string, { total: number; items: { id: string; name: string; total: number }[] }>();
    for (const [id, total] of byCat) {
      if (Math.abs(total) < 0.005) continue;
      const c = cats.find((x) => x.id === id);
      const g = c?.group ?? 'Uncategorized';
      const e = m.get(g) ?? m.set(g, { total: 0, items: [] }).get(g)!;
      e.total += total;
      e.items.push({ id: id ?? 'none', name: c?.name ?? 'Uncategorized', total });
    }
    return [...m.entries()].map(([g, v]) => ({ group: g, ...v, items: v.items.sort((a, b) => b.total - a.total) })).sort((a, b) => b.total - a.total);
  }, [cats, rows]);
  const all = groups.reduce((s, g) => s + g.total, 0);
  const max = Math.max(1, ...groups.flatMap((g) => g.items.map((i) => i.total)));
  if (!groups.length) return <Empty text="No spending in this period." />;
  return (
    <>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{formatMoney(all)} <Text style={{ color: t.muted, fontSize: 15, fontWeight: '400' }}>spent</Text></Text>
      {groups.map((g) => (
        <Card key={g.group} style={{ gap: 8 }}>
          <Pressable onPress={() => open({ group: g.group, title: g.group })} style={styles.between}>
            <Text style={{ color: t.text, fontWeight: '600' }}>{g.group}</Text>
            <Text style={{ color: t.text, fontWeight: '600' }}>{formatMoney(g.total)} <Text style={{ color: t.muted, fontWeight: '400' }}>{Math.round((g.total / all) * 100)}%</Text></Text>
          </Pressable>
          {g.items.map((i) => (
            <Pressable key={i.id} onPress={() => open({ category: i.id, title: i.name })} style={{ gap: 4 }}>
              <View style={styles.between}>
                <Text style={{ color: t.muted }}>{i.name}</Text>
                <Text style={{ color: t.text }}>{formatMoney(i.total)}</Text>
              </View>
              <Bar value={Math.max(0, i.total)} max={max} color={t.series1} height={6} />
            </Pressable>
          ))}
        </Card>
      ))}
    </>
  );
}

// RPT-2
function CashFlow({ t, months, sources, open }: { t: Theme; months: MonthSummary[]; sources: MerchantTotal[]; open: (q: Record<string, string>) => void }) {
  if (!months.length) return <Empty text="Nothing in this period." />;
  const max = Math.max(1, ...months.flatMap((m) => [m.income, -m.spending]));
  const inc = months.reduce((s, m) => s + m.income, 0), out = months.reduce((s, m) => s - m.spending, 0);
  const srcMax = Math.max(1, ...sources.map((s) => s.total));
  return (
    <>
      <Card style={{ gap: 4 }}>
        <View style={styles.between}><Text style={{ color: t.muted }}>Money in</Text><Text style={{ color: t.text, fontWeight: '600' }}>{formatMoney(inc)}</Text></View>
        <View style={styles.between}><Text style={{ color: t.muted }}>Spent</Text><Text style={{ color: t.text, fontWeight: '600' }}>{formatMoney(out)}</Text></View>
        <View style={styles.between}><Text style={{ color: t.muted }}>Net</Text><Text style={{ color: inc - out < 0 ? t.danger : t.text, fontWeight: '700' }}>{inc - out < 0 ? '−' : '+'}{formatMoney(Math.abs(inc - out))}</Text></View>
        <Text style={{ color: t.muted, fontSize: 12 }}>Transfers between your accounts and card payments are left out.</Text>
      </Card>
      <View style={[styles.chips, { alignItems: 'center' }]}>
        <View style={[styles.swatch, { backgroundColor: t.series1 }]} /><Text style={{ color: t.muted, marginRight: 12 }}>Money in</Text>
        <View style={[styles.swatch, { backgroundColor: t.series2 }]} /><Text style={{ color: t.muted }}>Spent</Text>
      </View>
      <Card style={{ gap: 12 }}>
        {months.map((m) => (
          <View key={m.month} style={{ gap: 3 }}>
            <View style={styles.between}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{monthName(m.month)}</Text>
              <Text style={{ color: m.income + m.spending < 0 ? t.danger : t.muted }}>net {m.income + m.spending < 0 ? '−' : '+'}{money0(Math.abs(m.income + m.spending))}</Text>
            </View>
            <View style={styles.flowRow}><View style={{ flex: 1 }}><Bar value={m.income} max={max} color={t.series1} /></View><Text style={[styles.flowNum, { color: t.text }]}>{money0(m.income)}</Text></View>
            <View style={styles.flowRow}><View style={{ flex: 1 }}><Bar value={-m.spending} max={max} color={t.series2} /></View><Text style={[styles.flowNum, { color: t.text }]}>{money0(-m.spending)}</Text></View>
          </View>
        ))}
      </Card>
      {sources.length > 0 && (
        <>
          <Text style={[styles.h, { color: t.muted }]}>Money in by source</Text>
          <Card style={{ gap: 8 }}>
            {sources.slice(0, 15).map((s) => (
              <Pressable key={s.merchant} onPress={() => open({ merchant: s.merchant, kind: 'income', title: s.merchant })} style={{ gap: 4 }}>
                <View style={styles.between}>
                  <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{s.merchant}</Text>
                  <Text style={{ color: t.text }}>{formatMoney(s.total)} <Text style={{ color: t.muted }}>· {s.txns}</Text></Text>
                </View>
                <Bar value={Math.max(0, s.total)} max={srcMax} color={t.series1} height={6} />
              </Pressable>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

// RPT-3
function ByMerchant({ t, list, open }: { t: Theme; list: MerchantTotal[]; open: (q: Record<string, string>) => void }) {
  if (!list.length) return <Empty text="No spending in this period." />;
  const max = Math.max(1, ...list.map((m) => -m.total));
  return (
    <Card style={{ gap: 8 }}>
      {list.slice(0, 60).map((m) => (
        <Pressable key={m.merchant} onPress={() => open({ merchant: m.merchant, title: m.merchant })} style={{ gap: 4 }}>
          <View style={styles.between}>
            <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{m.merchant}</Text>
            <Text style={{ color: t.text }}>{formatMoney(-m.total)} <Text style={{ color: t.muted }}>· {m.txns}</Text></Text>
          </View>
          <Bar value={Math.max(0, -m.total)} max={max} color={t.series1} height={6} />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  h: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flowNum: { width: 70, textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'] },
  swatch: { width: 10, height: 10, borderRadius: 2, marginRight: 4 },
});
