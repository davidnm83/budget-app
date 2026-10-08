// Reports (RPT-1, 2, 3): spending by category, cash flow by month with income by source, and
// spending by merchant, for a chosen date range; tap anything for its transactions. Plus your own
// tabs, each a set of widgets you pick (kept in user_prefs.report_tabs).
import { today } from '@/lib/plan';
import { PAGE_MAX } from '@/lib/layout';
import { makeEntry } from '@/components/Widgets';
import { PageBoard } from '@/components/PageBoard';
import { EmptyState } from '@/components/States';
import { DateRangeButton, rangeByKey, type Range } from '@/components/DateRange';
import { usePullRefresh } from '@/lib/pullRefresh';
import { UNDER_BAR } from '@/lib/layout';
import { addMonths, formatMoney, monthEnd, monthName } from '@budget-app/core';
// Month totals cover whole months; ranges here always start on the 1st and end today or at a month end.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { WatchPage } from '@/components/WatchPage';
import { openYearReview } from '@/components/YearReview';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Sheet } from '@/components/Forms';
import { WidgetBoard } from '@/components/WidgetBoard';
import { useTxnSheet } from '@/components/TxnSheet';
import { loadPrefs, savePrefs, type ReportTab } from '@/lib/prefs';
import { Bar, Button, Card, Chip, Empty } from '@/components/ui';
import {
  loadCategories, loadCategoryMonths, loadMerchants, loadMonthSummaries, thisMonth,
  type Category, type CategoryMonth, type MerchantTotal, type MonthSummary,
} from '@/lib/reports';
import { useTheme, type Theme } from '@/lib/theme';

type Tab = string; // 'categories' | 'cashflow' | 'merchants' | a custom tab's id
const BUILT_IN = [{ id: 'categories', name: 'Categories' }, { id: 'cashflow', name: 'Cash flow' }, { id: 'watch', name: 'Watch' }];
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export default function Reports() {
  const t = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'watch' ? 'watch' : 'categories');
  useEffect(() => { if (params.tab === 'watch') setTab('watch'); }, [params.tab]);
  const [picked, setPicked] = useState<Range>(() => rangeByKey('month'));
  const [cats, setCats] = useState<Category[]>([]);
  const [rows, setRows] = useState<CategoryMonth[]>([]);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [sources, setSources] = useState<MerchantTotal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Reports never look past today, and "all time" starts at the beginning.
  const now = today();
  const range = { from: picked.from || '1900-01-01', to: !picked.to || picked.to > now ? now : picked.to, label: picked.label };
  const [showTxns, txnSheet] = useTxnSheet();
  const [tabs, setTabs] = useState<ReportTab[]>([]);
  const [editTab, setEditTab] = useState<ReportTab | null>(null);
  const [tabName, setTabName] = useState('');
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const custom = tabs.find((x) => x.id === tab) ?? null;

  const load = useCallback(async () => {
    setLoading(true); setError(''); setRefresh((r) => r + 1);
    loadPrefs().then((p) => setTabs(p.report_tabs ?? [])).catch(() => {});
    try {
      const r = range;
      const [c, s, inc] = await Promise.all([
        loadCategories(), loadMonthSummaries(r.from, r.to), loadMerchants(r.from, r.to, 'income'),
      ]);
      setCats(c); setMonths(s); setSources(inc);
      // report_months is newest first, so its last row is the oldest month with activity.
      setRows(s.length ? await loadCategoryMonths(s[s.length - 1].month, s[0].month) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

  // Drill-down: the transactions behind a number, in a slide-over.
  const open = (q: Record<string, string>) => {
    const from = q.month ?? range.from, to = q.month ? monthEnd(q.month) : range.to;
    showTxns({
      title: q.title ?? '', from, to, category: q.category, group: q.group, merchant: q.merchant,
      kind: (q.kind as any) ?? (q.merchant || q.group ? 'expense' : undefined), noTransfers: true,
    });
  };
  const saveTabs = async (next: ReportTab[]) => { await savePrefs({ report_tabs: next }); setTabs(next); };
  // A new tab appears straight away, open for adding widgets; name it from the edit bar.
  const newTab = async () => {
    const x = { id: `t${Date.now().toString(36)}`, name: 'My tab', widgets: [] };
    try { await saveTabs([...tabs, x]); setTab(x.id); setEditing(true); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, minHeight: 56 }} contentContainerStyle={styles.tabBar}>
      {[...BUILT_IN, ...tabs].map((x) => (
        <Pressable key={x.id} onPress={() => setTab(x.id)} onLongPress={() => { const c = tabs.find((y) => y.id === x.id); if (c) { setTabName(c.name); setEditTab(c); } }}
          style={[styles.tab, { borderColor: tab === x.id ? t.accent : t.line, backgroundColor: tab === x.id ? t.accent : t.card }]}>
          <Text style={{ color: tab === x.id ? '#fff' : t.text, fontWeight: '600' }}>{x.name || 'Untitled'}</Text>
        </Pressable>
      ))}
      <Pressable onPress={newTab} style={[styles.tab, { borderColor: t.line, borderStyle: 'dashed' }]} accessibilityLabel="Add a tab">
        <Ionicons name="add" size={16} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Tab</Text>
      </Pressable>
    </ScrollView>
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {!custom && tab !== 'watch' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DateRangeButton value={picked} onChange={setPicked} />
          <Pressable onPress={() => openYearReview(Number(now.slice(0, 4)) - (now.slice(5, 7) <= '02' ? 1 : 0))} style={[styles.tab, { borderColor: t.line, backgroundColor: t.card }]} accessibilityRole="button">
            <Ionicons name="sparkles-outline" size={15} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Year in review</Text>
          </Pressable>
        </View>
      )}
      {tab === 'watch' && <WatchPage />}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {custom && (
        <>
          <WidgetBoard place="report" entries={custom.widgets} refresh={refresh} editing={editing} onEditing={setEditing}
            onChange={(next) => saveTabs(tabs.map((y) => (y.id === custom.id ? { ...y, widgets: next } : y))).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
            extra={<Pressable onPress={() => { setTabName(custom.name); setEditTab(custom); }} style={[styles.editTab, { borderColor: t.line }]}>
              <Ionicons name="create-outline" size={16} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Name or delete</Text>
            </Pressable>} />
        </>
      )}
      {/* The built-in tabs are layouts too: their own blocks first, plus any widget you add. Charts follow the dates above. */}
      {tab === 'categories' && (
        <PageBoard key="rc" page="reports:categories" refresh={refresh} range={range} defaults={[makeEntry('chart', { source: 'spending', view: 'pie', title: 'Spending by category' }), 'rep:categories']}
          blocks={[{ key: 'rep:categories', title: 'Spending by category', about: 'Every group and category for the dates chosen', render: () => <View style={{ gap: 10 }}><ByCategory t={t} cats={cats} rows={rows} open={open} /></View> }]} />
      )}
      {tab === 'cashflow' && (
        <PageBoard key="rf" page="reports:cashflow" refresh={refresh} range={range} defaults={[makeEntry('chart', { source: 'cashflow', view: 'bars', title: 'Money in and out', w: 'full' }), makeEntry('rep:cashflow', { w: 'full' })]}
          blocks={[{ key: 'rep:cashflow', title: 'Cash flow by month', about: 'Income, spending and net each month, and income by source', render: () => <View style={{ gap: 10 }}><CashFlow t={t} months={months} sources={sources} open={open} /></View> }]} />
      )}
    </ScrollView>
    {txnSheet}
    {editTab && (
      <Sheet title="This tab" onClose={() => setEditTab(null)}
        footer={<View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Delete tab" kind="danger" onPress={async () => { await saveTabs(tabs.filter((x) => x.id !== editTab.id)); setTab('categories'); setEditTab(null); }} />
          <Button title="Save" style={{ flex: 1 }} onPress={async () => { await saveTabs(tabs.map((y) => (y.id === editTab.id ? { ...y, name: tabName.trim() || 'My tab' } : y))); setEditTab(null); }} />
        </View>}>
        <TextInput value={tabName} onChangeText={setTabName} placeholder="Tab name, e.g. Car or Monthly check-in" placeholderTextColor={t.muted}
          style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
      </Sheet>
    )}
    </View>
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
  if (!groups.length) return <EmptyState icon="pie-chart-outline" title="No spending in this period" text="Pick a wider range of dates above." />;
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
  if (!months.length) return <EmptyState icon="swap-vertical-outline" title="Nothing in this period" text="Pick a wider range of dates above." />;
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
          <Pressable key={m.month} onPress={() => open({ month: m.month, title: monthName(m.month) })} style={{ gap: 3 }}>
            <View style={styles.between}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{monthName(m.month)}</Text>
              <Text style={{ color: m.income + m.spending < 0 ? t.danger : t.muted }}>net {m.income + m.spending < 0 ? '−' : '+'}{money0(Math.abs(m.income + m.spending))}</Text>
            </View>
            <View style={styles.flowRow}><View style={{ flex: 1 }}><Bar value={m.income} max={max} color={t.series1} /></View><Text style={[styles.flowNum, { color: t.text }]}>{money0(m.income)}</Text></View>
            <View style={styles.flowRow}><View style={{ flex: 1 }}><Bar value={-m.spending} max={max} color={t.series2} /></View><Text style={[styles.flowNum, { color: t.text }]}>{money0(-m.spending)}</Text></View>
          </Pressable>
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
const styles = StyleSheet.create({
  tabBar: { gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  editTab: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, minHeight: 40 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  page: { paddingHorizontal: 12, paddingTop: 4, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  h: { fontSize: 12, fontWeight: '700', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flowNum: { width: 70, textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'] },
  swatch: { width: 10, height: 10, borderRadius: 2, marginRight: 4 },
});
