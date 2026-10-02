// Categories (TXN-7): your list, grouped. Add, rename, pick an emoji, move to another group,
// change the type, hide, or merge one into another. Tap a group name to rename the group.
import { PAGE_MAX } from '@/lib/layout';
import { afterClose } from '@/lib/useBackToClose';
import { toast } from '@/lib/toast';
import { useConfirm } from '@/components/Confirm';
import { usePullRefresh } from '@/lib/pullRefresh';
import { EmojiField } from '@/components/EmojiPicker';
import { UNDER_BAR } from '@/lib/layout';
import Ionicons from '@expo/vector-icons/Ionicons';
import { categoryIcon, groupIcon } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Field, Sheet } from '@/components/Forms';
import { MultiPicker } from '@/components/Picker';
import { Button, Card, Chip, Segmented } from '@/components/ui';
import { loadGroupIcons, mergeCategories, renameGroup, setGroupIcon } from '@/lib/categories';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

interface Cat { id: string; name: string; group_name: string; kind: 'expense' | 'income' | 'transfer'; is_hidden: boolean; sort: number; icon: string | null }
const KINDS = [{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }] as const;

export default function Categories() {
  const t = useTheme();
  const [cats, setCats] = useState<Cat[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<Partial<Cat> | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [groupIcons, setGroupIcons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('categories').select('id, name, group_name, kind, is_hidden, sort, icon').order('sort').order('name');
    if (error) { setError(error.message); return; }
    setCats((data ?? []) as Cat[]);
    setGroupIcons(await loadGroupIcons());
    const { data: used } = await supabase.rpc('report_category_months', { p_from: '1900-01-01', p_to: '2999-12-31' });
    const m = new Map<string, number>();
    for (const r of (used ?? []) as any[]) if (r.category_id) m.set(r.category_id, (m.get(r.category_id) ?? 0) + Number(r.txns));
    setCounts(m);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

  const groups = useMemo(() => {
    const m = new Map<string, Cat[]>();
    for (const c of cats.filter((x) => showHidden || !x.is_hidden)) (m.get(c.group_name) ?? m.set(c.group_name, []).get(c.group_name)!).push(c);
    // Groups A–Z; categories inside a group A–Z too.
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([g, list]) => [g, [...list].sort((x, y) => x.name.localeCompare(y.name))] as [string, Cat[]]);
  }, [cats, showHidden]);
  const hidden = cats.filter((c) => c.is_hidden).length;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        <Text style={{ color: t.muted, fontSize: 13 }}>Tap a category to edit it, or a group name to rename the group or change its emoji. Hidden categories stay on old transactions.</Text>
        {groups.map(([g, list]) => (
          <View key={g} style={{ gap: 6 }}>
            <Pressable onPress={() => setGroup(g)} style={styles.groupHead}>
              <Text style={{ fontSize: 15 }}>{groupIcon(g, groupIcons[g])}</Text>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, flex: 1 }}>{g.toUpperCase()}</Text>
              <Ionicons name="pencil" size={13} color={t.muted} />
            </Pressable>
            <Card style={{ padding: 0 }}>
              {list.map((c, i) => (
                <Pressable key={c.id} onPress={() => setEditing(c)} style={({ pressed, hovered }: any) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
                  <Text style={styles.icon}>{categoryIcon(c.name, c.icon)}</Text>
                  <Text style={{ color: c.is_hidden ? t.muted : t.text, flex: 1, fontSize: 15 }} numberOfLines={1}>{c.name}{c.is_hidden ? ' (hidden)' : ''}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{c.kind === 'income' ? 'income · ' : c.kind === 'transfer' ? 'transfer · ' : ''}{counts.get(c.id) ?? 0}</Text>
                </Pressable>
              ))}
            </Card>
          </View>
        ))}
        {hidden > 0 && (
          <Pressable onPress={() => setShowHidden(!showHidden)} style={{ alignItems: 'center', padding: 8 }}>
            <Text style={{ color: t.accent }}>{showHidden ? 'Hide' : 'Show'} {hidden} hidden</Text>
          </Pressable>
        )}
      </ScrollView>
      <Pressable onPress={() => setEditing({ kind: 'expense', group_name: groups[0]?.[0] ?? 'Other' })} style={[styles.fab, { backgroundColor: t.accent }]} accessibilityLabel="New category">
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
      {editing && <CategoryEditor initial={editing} cats={cats} count={editing.id ? counts.get(editing.id) ?? 0 : 0} onClose={() => setEditing(null)} onSaved={load} />}
      {group && <GroupEditor name={group} icon={groupIcons[group] ?? ''} onClose={() => setGroup(null)} onSaved={load} />}
    </View>
  );
}

function CategoryEditor({ initial, cats, count, onClose, onSaved }: { initial: Partial<Cat>; cats: Cat[]; count: number; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [name, setName] = useState(initial.name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [groupName, setGroupName] = useState(initial.group_name ?? '');
  const [kind, setKind] = useState<Cat['kind']>(initial.kind ?? 'expense');
  const [hidden, setHidden] = useState(!!initial.is_hidden);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [confirm, confirmSheet] = useConfirm();
  const [error, setError] = useState('');
  const groups = [...new Set(cats.map((c) => c.group_name))];
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];

  const save = async () => {
    if (!name.trim() || !groupName.trim()) { setError('Give it a name and a group.'); return; }
    const row = { name: name.trim(), icon: icon.trim() || null, group_name: groupName.trim(), kind, is_hidden: hidden,
      ...(initial.id ? {} : { sort: Math.max(0, ...cats.filter((c) => c.group_name === groupName).map((c) => c.sort)) + 1 }) };
    const { error } = initial.id ? await supabase.from('categories').update(row).eq('id', initial.id) : await supabase.from('categories').insert(row);
    if (error) setError(error.message.includes('duplicate') ? 'There is already a category with that name.' : error.message);
    else { onSaved(); onClose(); }
  };
  const merge = async (ids: string[]) => {
    const to = ids[ids.length - 1];
    setMergeOpen(false);
    if (!to || !initial.id) return;
    const target = cats.find((c) => c.id === to)?.name ?? 'the other category';
    afterClose(() => confirm({
      title: 'Merge categories', action: 'Merge',
      message: `Move every transaction, budget and rule from “${initial.name}” into “${target}”, then delete “${initial.name}”?`,
      run: async () => { try { await mergeCategories(initial.id!, to); toast(`Merged into ${target}`); onSaved(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } },
    }));
  };
  const remove = async () => {
    const { error } = await supabase.from('categories').delete().eq('id', initial.id!);
    if (error) setError(error.message); else { toast('Saved'); onSaved(); onClose(); }
  };

  return (
    <Sheet title={initial.id ? 'Edit category' : 'New category'} onClose={onClose}
      footer={<Button title="Save" onPress={save} />}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <Field t={t} label="Icon"><EmojiField value={icon} onChange={setIcon} placeholder={categoryIcon(name || '-', null)} /></Field>
        <View style={{ flex: 1 }}><Field t={t} label="Name"><TextInput value={name} onChangeText={setName} style={input} /></Field></View>
      </View>
      <Field t={t} label="Type"><Segmented value={kind} onChange={setKind} options={KINDS as any} /></Field>
      <Field t={t} label="Group">
        <View style={styles.chips}>{groups.map((g) => <Chip key={g} label={g} on={groupName === g} onPress={() => setGroupName(g)} />)}</View>
        <TextInput value={groupName} onChangeText={setGroupName} placeholder="…or type a new group" placeholderTextColor={t.muted} style={input} />
      </Field>
      {initial.id && (
        <>
          <View style={styles.between}>
            <Text style={{ color: t.text, flex: 1 }}>Hide from lists (stays on {count} transactions)</Text>
            <Switch value={hidden} onValueChange={setHidden} />
          </View>
          <Field t={t} label="Merge">
            <Text style={{ color: t.muted, fontSize: 12 }}>Move its {count} transactions, rules, bills and budgets into another category, then remove this one.</Text>
            <Button title="Merge into…" kind="plain" onPress={() => setMergeOpen(true)} />
          </Field>
          {count === 0 && <Button title="Delete (it has no transactions)" kind="danger" onPress={remove} />}
        </>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {confirmSheet}
      <MultiPicker visible={mergeOpen} title={`Merge ${initial.name ?? ''} into`} onClose={() => setMergeOpen(false)} selected={[]} onChange={merge}
        items={cats.filter((c) => c.id !== initial.id).map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))} />
    </Sheet>
  );
}

function GroupEditor({ name, icon: initialIcon, onClose, onSaved }: { name: string; icon: string; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [value, setValue] = useState(name);
  const [icon, setIcon] = useState(initialIcon);
  const [error, setError] = useState('');
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const save = async () => {
    try {
      if (icon !== initialIcon) await setGroupIcon(name, icon.trim() || null);
      await renameGroup(name, value);
      onSaved(); onClose();
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Sheet title="Edit group" onClose={onClose} footer={<Button title="Save" onPress={save} />}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <Field t={t} label="Icon"><EmojiField value={icon} onChange={setIcon} placeholder={groupIcon(name)} /></Field>
        <View style={{ flex: 1 }}><Field t={t} label="Group name"><TextInput value={value} onChangeText={setValue} style={input} /></Field></View>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>Renaming to an existing group's name combines the two.</Text>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 12, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  icon: { width: 24, fontSize: 18, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  emoji: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fab: { position: 'absolute', right: 20, bottom: 92, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
