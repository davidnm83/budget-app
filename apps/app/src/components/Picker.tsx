// A pop-up list to pick several items, with a search box. Used for the category, account and
// merchant filters.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ModalFrame } from '@/components/ModalFrame';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { useBackToClose } from '@/lib/useBackToClose';

export interface PickItem { id: string; label: string; group?: string; detail?: string }

export function MultiPicker({ visible, title, items, selected, onChange, onClose }: {
  visible: boolean; title: string; items: PickItem[]; selected: string[]; onChange: (ids: string[]) => void; onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  useBackToClose(visible, onClose);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = s ? items.filter((i) => i.label.toLowerCase().includes(s) || (i.group ?? '').toLowerCase().includes(s)) : items;
    // Chosen ones first so you can see and undo them.
    return [...hits.filter((i) => selected.includes(i.id)), ...hits.filter((i) => !selected.includes(i.id))];
  }, [items, q, selected]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <ModalFrame visible={visible} onClose={onClose}>
      <View style={{ flex: 1 }}>
        <View style={[styles.head, { borderColor: t.line }]}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{title}{selected.length ? ` · ${selected.length}` : ''}</Text>
          {!!selected.length && <Pressable onPress={() => onChange([])} hitSlop={8}><Text style={{ color: t.accent }}>Clear</Text></Pressable>}
          <Pressable onPress={onClose} hitSlop={8} style={[styles.done, { backgroundColor: t.accent }]}><Text style={{ color: '#fff', fontWeight: '600' }}>Done</Text></Pressable>
        </View>
        <View style={[styles.search, { borderColor: t.line, backgroundColor: t.card }]}>
          <Ionicons name="search" size={16} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={`Search ${title.toLowerCase()}`} placeholderTextColor={t.muted} autoFocus
            style={[{ flex: 1, color: t.text, paddingVertical: 9, fontSize: 15 }, { outlineStyle: 'none' } as any]} />
        </View>
        <FlatList
          data={list}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const on = selected.includes(item.id);
            return (
              <Pressable onPress={() => toggle(item.id)} style={({ pressed }) => [styles.row, { borderColor: t.line, backgroundColor: pressed ? t.line : t.card }]}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? t.accent : t.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={1}>{item.label}</Text>
                  {!!item.group && <Text style={{ color: t.muted, fontSize: 12 }}>{item.group}</Text>}
                </View>
                {!!item.detail && <Text style={{ color: t.muted, fontSize: 12 }}>{item.detail}</Text>}
              </Pressable>
            );
          }}
        />
      </View>
    </ModalFrame>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  done: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, margin: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
});
