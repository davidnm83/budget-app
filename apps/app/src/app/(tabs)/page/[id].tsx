// Your own pages (NAV-2, NAV-3): a page is a name, an emoji and widgets you choose and order.
// /page/new offers ready-made starting points (Car, Debt, Monthly check-in) or a blank page.
import Ionicons from '@expo/vector-icons/Ionicons';
import { EmojiField } from '@/components/EmojiPicker';
import { UNDER_BAR } from '@/lib/layout';
import { router, Tabs, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Button, Card, Empty } from '@/components/ui';
import { WidgetBoard } from '@/components/WidgetBoard';
import { makeEntry } from '@/components/Widgets';
import { PAGE_MAX } from '@/lib/layout';
import { loadPrefs, savePrefs, type Page } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

const TEMPLATES: { name: string; icon: string; about: string; widgets: string[] }[] = [
  { name: 'Car', icon: '🚗', about: 'Car costs by month, gas, the car loan and its payoff', widgets: [
    makeEntry('spend', { title: 'Car costs', group: 'Transportation', months: 6 }),
    makeEntry('spend', { title: 'Gas', names: ['Gas'], months: 6 }),
    makeEntry('account', { title: 'Car loan', accountMatch: 'auto|car|escape|vehicle' }),
  ] },
  { name: 'Debt', icon: '💳', about: 'Cards, utilisation, interest paid and what’s left after the cards', widgets: [
    'credit', 'cash', makeEntry('spend', { title: 'Interest and fees', names: ['Credit card interest', 'Bank Charges & Fees'], months: 12 }), 'nwtypes',
  ] },
  { name: 'Monthly check-in', icon: '🗓️', about: 'Average spending, groups vs last month, watch list and bills', widgets: ['avgspend', 'groups', 'watch', 'calendar', 'runway'] },
  { name: 'Blank page', icon: '📄', about: 'Start empty and add widgets', widgets: [] },
];

export default function CustomPage() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    setRefresh((r) => r + 1);
    loadPrefs().then((p) => setPages(p.pages ?? [])).catch((e) => setError(String(e?.message ?? e)));
  }, []));
  const page = pages?.find((p) => p.id === id) ?? null;
  const save = async (next: Page[]) => { await savePrefs({ pages: next }); setPages(next); };
  const create = async (tpl: (typeof TEMPLATES)[number]) => {
    setEditing(!tpl.widgets.length); // a blank page opens ready to add widgets
    const p: Page = { id: `p${Date.now().toString(36)}`, name: tpl.name === 'Blank page' ? 'My page' : tpl.name, icon: tpl.icon, widgets: tpl.widgets };
    try { await save([...(pages ?? []), p]); router.navigate(`/page/${p.id}` as any); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];

  if (id === 'new') {
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
        <Tabs.Screen options={{ title: 'New page' }} />
        <Text style={{ color: t.muted, fontSize: 13 }}>Start from a ready-made page or a blank one. You can rename it and change its widgets afterwards; it shows in the menu.</Text>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {TEMPLATES.map((tpl) => (
          <Pressable key={tpl.name} onPress={() => create(tpl)} disabled={!pages}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 26 }}>{tpl.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{tpl.name}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{tpl.about}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.muted} />
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    );
  }
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      <Tabs.Screen options={{ title: page ? `${page.icon} ${page.name}` : 'Page' }} />
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {pages && !page && <Empty text="This page no longer exists." />}
      {page && (
        <>
          <WidgetBoard place="page" entries={page.widgets} refresh={refresh} editing={editing} onEditing={setEditing}
            onChange={(next) => save(pages!.map((p) => (p.id === page.id ? { ...p, widgets: next } : p))).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
            extra={<Pressable onPress={() => { setName(page.name); setIcon(page.icon); setRenaming(true); }} style={[styles.edit, { borderColor: t.line }]}>
              <Ionicons name="create-outline" size={16} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Name or delete</Text>
            </Pressable>} />
        </>
      )}
      {renaming && page && (
        <Sheet title="This page" onClose={() => setRenaming(false)}
          footer={<View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Delete page" kind="danger" onPress={async () => { await save(pages!.filter((p) => p.id !== page.id)); setRenaming(false); router.navigate('/'); }} />
            <Button title="Save" style={{ flex: 1 }} onPress={async () => { await save(pages!.map((p) => (p.id === page.id ? { ...p, name: name.trim() || 'My page', icon: icon || '📄' } : p))); setRenaming(false); }} />
          </View>}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <EmojiField value={icon} onChange={setIcon} placeholder="📄" />
            <TextInput value={name} onChangeText={setName} placeholder="Page name" placeholderTextColor={t.muted} style={[input, { flex: 1 }]} />
          </View>
        </Sheet>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, minHeight: 40 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
});
