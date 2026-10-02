// A built-in page as a widget layout (Gig work, Credit cards, Car & loans, Spending watch). The
// page supplies its own blocks (drawn from data it already loaded) and a default order; you can
// reorder, resize or remove them, add any other widget, or go back to the default. The layout is
// stored with the account.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { WidgetBoard } from '@/components/WidgetBoard';
import type { WidgetDef } from '@/components/Widgets';
import { loadPrefs, savePrefs } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

export interface Block { key: string; title: string; about: string; render: () => ReactNode }

export function PageBoard({ page, blocks, defaults, refresh }: { page: string; blocks: Block[]; defaults: string[]; refresh: number }) {
  const t = useTheme();
  const [all, setAll] = useState<Record<string, string[]> | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { loadPrefs().then((p) => setAll(p.page_layouts ?? {})).catch(() => setAll({})); }, []);
  if (!all) return null;
  const entries = all[page] ?? defaults;
  const save = (next: string[] | null) => {
    const merged = { ...all }; if (next) merged[page] = next; else delete merged[page];
    setAll(merged); savePrefs({ page_layouts: merged }).catch(() => {});
  };
  const defs: WidgetDef[] = blocks.map((b) => ({ key: b.key, title: b.title, about: b.about, home: false, budget: false }));
  return (
    <WidgetBoard place="page" entries={entries} refresh={refresh} editing={editing} onEditing={setEditing} onChange={save} blocks={defs}
      special={(k) => { const b = blocks.find((x) => x.key === k); return b ? b.render() ?? <></> : undefined; }}
      extra={all[page] ? (
        <Pressable onPress={() => save(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.line, borderRadius: 20, paddingHorizontal: 14, minHeight: 40 }}>
          <Ionicons name="refresh" size={16} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Reset to default</Text>
        </Pressable>
      ) : undefined} />
  );
}
