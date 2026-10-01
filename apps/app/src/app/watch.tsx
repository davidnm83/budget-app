// Spending watch (VIEW-5, Fina's "Expense improvement tracker"): pick the categories you're trying
// to bring down and see each one's last 6 months, its 3-month average and where this month is heading.
import { categoryIcon } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { MultiPicker } from '@/components/Picker';
import { Button, Card } from '@/components/ui';
import { WatchCard } from '@/components/WatchCard';
import { today } from '@/lib/plan';
import { savePrefs } from '@/lib/prefs';
import type { Category } from '@/lib/reports';
import { useTheme } from '@/lib/theme';
import { loadWatch, type Watched } from '@/lib/watch';


export default function Watch() {
  const t = useTheme();
  const [data, setData] = useState<{ list: Watched[]; chosen: boolean; cats: Category[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await loadWatch(today())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const selected = data?.list.map((w) => w.category.id) ?? [];
  const change = async (ids: string[]) => { await savePrefs({ watch_categories: ids }); load(); };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        The categories you're keeping an eye on. Green: this month is heading below your 3-month average; orange: above it.
        {data && !data.chosen ? ' These are suggestions until you pick your own.' : ''}
      </Text>
      <Button title="Choose categories" kind="plain" onPress={() => setPicking(true)} />
      {data?.list.map((w) => <WatchCard key={w.category.id} t={t} w={w} />)}
      {data && !data.list.length && <Card><Text style={{ color: t.muted }}>Nothing on the list yet.</Text></Card>}
      {data && (
        <MultiPicker visible={picking} title="Watch list" onClose={() => setPicking(false)} selected={selected} onChange={change}
          items={data.cats.filter((c) => c.kind === 'expense' && !c.hidden).map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group }))} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
});
