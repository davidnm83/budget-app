// Pop-up lists with a search box. MultiPicker ticks several (filters); SinglePicker picks one and
// closes (a transaction's category), with a row of suggestions on top. Both share the same look.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ModalFrame } from '@/components/ModalFrame';
import { useEffect, useMemo, useState } from 'react';
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
  const [first, setFirst] = useState<string[]>(selected);
  useEffect(() => { if (visible) setFirst(selected); }, [visible]);
  useBackToClose(visible, onClose);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = s ? items.filter((i) => i.label.toLowerCase().includes(s) || (i.group ?? '').toLowerCase().includes(s)) : items;
    // What was already chosen when the list opened comes first; ticking a row never moves it.
    return [...hits.filter((i) => first.includes(i.id)), ...hits.filter((i) => !first.includes(i.id))];
  }, [items, q, first]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <ModalFrame visible={visible} onClose={onClose}>
      <View style={{ flex: 1 }}>
        <View style={[styles.head, { borderColor: t.line }]}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{title}{selected.length ? ` · ${selected.length}` : ''}</Text>
          {list.some((i) => !selected.includes(i.id)) && <Pressable onPress={() => onChange([...new Set([...selected, ...list.map((i) => i.id)])])} hitSlop={8}><Text style={{ color: t.accent }}>{q.trim() ? `Select ${list.length} shown` : 'Select all'}</Text></Pressable>}
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

/** Pick one: suggestions first, then everything under its group heading. Tapping a row picks it and closes. */
export function SinglePicker({ visible, title, items, selected, suggested = [], onPick, onClose }: {
  visible: boolean; title: string; items: PickItem[]; selected: string | null; suggested?: string[]; onPick: (id: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  useBackToClose(visible, onClose);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = s ? items.filter((i) => i.label.toLowerCase().includes(s) || (i.group ?? '').toLowerCase().includes(s)) : items;
    const out: ({ head: string } | PickItem)[] = [];
    let g: string | undefined;
    const order = [...new Set(hits.map((i) => i.group))];
    for (const i of [...hits].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))) { if (i.group !== g) { g = i.group; if (g) out.push({ head: g }); } out.push(i); }
    return out;
  }, [items, q]);
  const sug = suggested.map((id) => items.find((i) => i.id === id)).filter(Boolean) as PickItem[];
  const first = rows.find((r) => !('head' in r)) as PickItem | undefined;
  return (
    <ModalFrame visible={visible} onClose={onClose}>
      <View style={{ flex: 1 }}>
        <View style={[styles.head, { borderColor: t.line }]}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Ionicons name="close" size={26} color={t.text} /></Pressable>
        </View>
        <View style={[styles.search, { borderColor: t.line, backgroundColor: t.card }]}>
          <Ionicons name="search" size={16} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={`Search ${title.toLowerCase()}`} placeholderTextColor={t.muted} autoFocus
            onSubmitEditing={() => { if (q.trim() && first) onPick(first.id); }}
            style={[{ flex: 1, color: t.text, paddingVertical: 9, fontSize: 15 }, { outlineStyle: 'none' } as any]} />
        </View>
        {!q.trim() && sug.length > 0 && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>SUGGESTED</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {sug.map((i) => (
                <Pressable key={i.id} onPress={() => onPick(i.id)} style={[styles.sug, { borderColor: i.id === selected ? t.accent : t.line, backgroundColor: t.card }]}>
                  <Text style={{ color: t.text, fontSize: 14 }}>{i.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <FlatList data={rows} keyExtractor={(r, n) => ('head' in r ? `h${n}` : r.id)} keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => 'head' in item
            ? <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>{item.head.toUpperCase()}</Text>
            : (
              <Pressable onPress={() => onPick(item.id)} style={({ pressed, hovered }: any) => [styles.row, { paddingVertical: 9, borderColor: t.line, backgroundColor: pressed || hovered ? t.line : t.card }]}>
                <Text style={{ color: t.text, fontSize: 15, flex: 1 }} numberOfLines={1}>{item.label}</Text>
                {item.id === selected && <Ionicons name="checkmark" size={20} color={t.accent} />}
              </Pressable>
            )} />
      </View>
    </ModalFrame>
  );
}

const styles = StyleSheet.create({
  sug: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  done: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, margin: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
});
