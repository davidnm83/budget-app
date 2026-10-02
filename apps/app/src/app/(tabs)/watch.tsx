// Spending watch (VIEW-5): pick the categories you're trying
// to bring down and see each one's last 6 months, its 3-month average and where this month is heading.
import { PAGE_MAX } from '@/lib/layout';
import { EmptyState } from '@/components/States';
import { usePullRefresh } from '@/lib/pullRefresh';
import { UNDER_BAR } from '@/lib/layout';
import { categoryIcon, monthEnd, monthName } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PageBoard } from '@/components/PageBoard';
import { MultiPicker } from '@/components/Picker';
import { Button, Card } from '@/components/ui';
import { WatchCard, WatchStackCard } from '@/components/WatchCard';
import { useTxnSheet } from '@/components/TxnSheet';
import { today } from '@/lib/plan';
import { savePrefs } from '@/lib/prefs';
import type { Category } from '@/lib/reports';
import { useTheme } from '@/lib/theme';
import { loadWatch, stackName } from '@/lib/watch';


export default function Watch() {
  const t = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadWatch>> | null>(null);
  // Picking the categories of a combined chart: 'new', or the id of the one being edited.
  const [combining, setCombining] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [showTxns, txnSheet] = useTxnSheet();
  const load = useCallback(async () => {
    try { setData(await loadWatch(today())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); setRefresh((r) => r + 1); }, [load]));
  usePullRefresh(load);
  const selected = data?.list.map((w) => w.category.id) ?? [];
  const change = async (ids: string[]) => { await savePrefs({ watch_categories: ids }); load(); };
  const custom = data?.charts.custom ?? [];
  const saveCharts = async (patch: { byGroup?: boolean; custom?: typeof custom }) => {
    try { await savePrefs({ watch_charts: { ...data?.charts, ...patch } }); load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  // A combined chart keeps whatever is ticked; unticking everything removes it.
  const combine = (ids: string[]) => {
    const name = stackName(ids.map((id) => data!.cats.find((c) => c.id === id)).filter((c): c is Category => !!c));
    const id = combining === 'new' ? `c${Date.now().toString(36)}` : combining!;
    const rest = custom.filter((c) => c.id !== id);
    if (combining === 'new') setCombining(id);
    saveCharts({ custom: ids.length ? [...rest, { id, name, ids }] : rest });
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        The categories you're keeping an eye on. Tap a month for its transactions. Green: this month is heading below your 3-month average; orange: above it.
        {data && !data.chosen ? ' These are suggestions until you pick your own.' : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button title="Choose categories" kind="plain" style={{ flexGrow: 1 }} onPress={() => setPicking(true)} />
        <Button title="Add a combined chart" kind="plain" style={{ flexGrow: 1 }} onPress={() => setCombining('new')} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
        <Text style={{ color: t.text, flex: 1 }}>Stack categories in the same group into one chart</Text>
        <Switch value={!!data?.charts.byGroup} onValueChange={(v) => saveCharts({ byGroup: v })} />
      </View>
      {data && (
        <PageBoard page="watch" refresh={refresh} defaults={['watch:list']} blocks={[
          { key: 'watch:list', title: 'Watched categories', about: 'Each category’s last 6 months against its average', render: () => (
            <View style={{ gap: 10 }}>
              {data.stacks.map((s) => <WatchStackCard key={s.id} t={t} s={s}
        onEdit={s.custom ? () => setCombining(s.id) : undefined}
        onRemove={s.custom ? () => saveCharts({ custom: custom.filter((c) => c.id !== s.id) }) : undefined}
        onMonth={(m) => showTxns({ title: `${s.name} · ${monthName(m)}`, from: m, to: monthEnd(m), categoryIds: s.parts.map((w) => w.category.id), noTransfers: true })} />)}
              {data.singles.map((w) => <WatchCard key={w.category.id} t={t} w={w}
        onMonth={(m) => showTxns({ title: `${w.category.name} · ${monthName(m)}`, from: m, to: monthEnd(m), categoryIds: [w.category.id], noTransfers: true })} />)}
              {!data.list.length && !data.stacks.length && <EmptyState icon="trending-down-outline" title="Nothing on the watch list" text="Pick the categories you’re trying to bring down and see each one against its average." action="Choose categories" onAction={() => setPicking(true)} />}
            </View>
          ) },
        ]} />
      )}
      {txnSheet}
      {data && (
        <MultiPicker visible={picking} title="Watch list" onClose={() => setPicking(false)} selected={selected} onChange={change}
          items={data.cats.filter((c) => c.kind === 'expense' && !c.hidden).map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group }))} />
      )}
      {data && (
        <MultiPicker visible={combining != null} title="Combined chart" onClose={() => setCombining(null)} onChange={combine}
          selected={custom.find((c) => c.id === combining)?.ids ?? []}
          items={data.cats.filter((c) => c.kind === 'expense' && !c.hidden).map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group }))} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
});
