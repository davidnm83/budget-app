// A built-in page as a widget layout (Credit cards, Car & loans, Spending watch). The
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

/**
 * `added`: blocks that became part of the page after layouts were first saved (cards that used to sit
 * outside the board). A saved layout gets them once, at the end; removing them afterwards sticks.
 */
export function PageBoard({ page, blocks, defaults, refresh, range, added, quiet }: { page: string; blocks: Block[]; defaults: string[]; refresh: number; range?: { from: string; to: string }; added?: string[]; quiet?: boolean }) {
  const t = useTheme();
  const [all, setAll] = useState<Record<string, string[]> | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { loadPrefs().then((p) => setAll(p.page_layouts ?? {})).catch(() => setAll({})); }, []);
  if (!all) return null;
  // A marker entry ("@" + the added keys) records that a saved layout has had them; it is never drawn.
  const marker = added?.length ? `@${added.join(',')}` : null;
  const saved = all[page];
  const caught = saved && marker && !saved.includes(marker) ? [...saved.filter((e) => !e.startsWith('@')), ...added!.filter((k) => !saved.some((e) => e === k || e.startsWith(`${k}::`))).map((k) => defaults.find((e) => e === k || e.startsWith(`${k}::`)) ?? k)] : null;
  const entries = (caught ?? saved ?? defaults).filter((e) => !e.startsWith('@'));
  const save = (next: string[] | null) => {
    const merged = { ...all }; if (next) merged[page] = marker ? [...next, marker] : next; else delete merged[page];
    setAll(merged); savePrefs({ page_layouts: merged }).catch(() => {});
  };
  if (caught) setTimeout(() => save(caught), 0);
  const defs: WidgetDef[] = blocks.map((b) => ({ key: b.key, title: b.title, about: b.about, home: false, budget: false }));
  return (
    <WidgetBoard place="page" quiet={quiet} entries={entries} refresh={refresh} range={range} editing={editing} onEditing={setEditing} onChange={save} blocks={defs}
      special={(k) => { const b = blocks.find((x) => x.key === k); return b ? b.render() ?? <></> : undefined; }}
      extra={all[page] ? (
        <Pressable onPress={() => save(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.line, borderRadius: 20, paddingHorizontal: 14, minHeight: 40 }}>
          <Ionicons name="refresh" size={16} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Reset to default</Text>
        </Pressable>
      ) : undefined} />
  );
}
