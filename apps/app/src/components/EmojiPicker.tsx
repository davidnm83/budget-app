// Choose an emoji from the full set, by group or by searching its name. The list (about 1,900)
// is loaded the first time the picker opens.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { memo, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

type Group = { name: string; items: [string, string][] };
let cache: Group[] | null = null;
const COLS = 8;
const CELL = 46; // row height; fixed, so the list knows where every row is without measuring

export function EmojiPicker({ value, onPick, onClose, title = 'Choose an emoji' }: { value?: string; onPick: (emoji: string) => void; onClose: () => void; title?: string }) {
  const t = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<Group[] | null>(cache);
  const [g, setG] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => { if (!cache) import('@/lib/emojiData.json').then((m: any) => { cache = (m.default ?? m) as Group[]; setGroups(cache); }); }, []);
  const shown = useMemo(() => {
    if (!groups) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? groups.flatMap((x) => x.items).filter(([, name]) => words.every((w) => name.includes(w))) : groups[g].items;
    const rows: [string, string][][] = [];
    for (let i = 0; i < list.length; i += COLS) rows.push(list.slice(i, i + COLS));
    return rows;
  }, [groups, g, q]);
  const choose = (e: string) => { onPick(e); onClose(); };
  return (
    <Sheet title={title} onClose={onClose} scroll={false}>
      <View style={{ flex: 1, minHeight: 420 }}>
        <View style={[styles.search, { borderColor: t.line, backgroundColor: t.card }]}>
          <Ionicons name="search" size={16} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search, e.g. car, coffee, house" placeholderTextColor={t.muted} autoFocus={wide}
            style={[{ flex: 1, color: t.text, paddingVertical: 9, fontSize: 15 }, { outlineStyle: 'none' } as any]} />
          {!!value && <Pressable onPress={() => { onPick(''); onClose(); }} hitSlop={8}><Text style={{ color: t.accent, fontSize: 13 }}>Use default</Text></Pressable>}
        </View>
        {!q.trim() && groups && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, minHeight: 52 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingBottom: 10, alignItems: 'center' }}>
            {groups.map((x, i) => (
              <Pressable key={x.name} onPress={() => setG(i)} accessibilityLabel={x.name} style={[styles.group, { borderColor: g === i ? t.accent : t.line, backgroundColor: g === i ? t.accent + '22' : 'transparent' }]}>
                <Text style={{ fontSize: 18 }}>{x.items[0][0]}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!groups ? <Text style={{ color: t.muted, padding: 16 }}>Loading…</Text> : !shown.length ? <Text style={{ color: t.muted, padding: 16 }}>No emoji matches “{q}”.</Text> : (
          <FlatList data={shown} keyExtractor={(r) => r[0][0]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 28 }}
            initialNumToRender={8} maxToRenderPerBatch={8} updateCellsBatchingPeriod={30} windowSize={5}
            getItemLayout={(_, index) => ({ length: CELL, offset: 26 + CELL * index, index })}
            ListHeaderComponent={<Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, height: 26, lineHeight: 26 }}>{q.trim() ? 'RESULTS' : groups[g].name.toUpperCase()}</Text>}
            renderItem={({ item }) => <Row item={item} value={value} hover={t.line} onPick={choose} />} />
        )}
      </View>
    </Sheet>
  );
}

/**
 * One row of the grid. On the web each emoji is a single plain element and the row handles the
 * tap for all of them (hover is done in CSS), which is far lighter than a button per emoji when
 * a few hundred are on screen. Rows only redraw when their own emoji or the chosen one change.
 */
const Row = memo(function Row({ item, value, hover, onPick }: { item: [string, string][]; value?: string; hover: string; onPick: (e: string) => void }) {
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.row}>
        {item.map(([e, name]) => (
          <Pressable key={e} onPress={() => onPick(e)} accessibilityLabel={name} style={[styles.cell, e === value && { backgroundColor: hover }]}><Text style={styles.glyph}>{e}</Text></Pressable>
        ))}
      </View>
    );
  }
  const click = (ev: any) => { const e = ev.target?.closest?.('[data-emoji]')?.getAttribute('data-emoji'); if (e) onPick(e); };
  return (
    <View style={styles.row} {...({ onClick: click } as any)}>
      {item.map(([e, name]) => (
        <Text key={e} accessibilityLabel={name} {...({ dataSet: { emoji: e } } as any)} style={[styles.cell, styles.glyph, e === value && { backgroundColor: hover }]}>{e}</Text>
      ))}
    </View>
  );
});

/** The emoji shown as a button; tap to open the picker. An empty value shows the default in a muted state. */
export function EmojiField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel="Choose an emoji" style={[styles.field, { borderColor: t.line, backgroundColor: t.card }]}>
        <Text style={{ fontSize: 22, opacity: value ? 1 : 0.45 }}>{value || placeholder || '🙂'}</Text>
      </Pressable>
      {open && <EmojiPicker value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, marginHorizontal: 12, marginTop: 14, marginBottom: 12 },
  group: { width: 40, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', height: CELL },
  cell: { flex: 1, maxWidth: `${100 / COLS}%`, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: 10, cursor: 'pointer' as any },
  glyph: { fontSize: 26, lineHeight: CELL, textAlign: 'center' },
  field: { width: 56, height: 44, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
