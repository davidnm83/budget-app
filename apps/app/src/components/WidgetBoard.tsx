// A page of widgets you arrange yourself (Overview and your own pages). Out of edit mode it is
// just the widgets: one column on phones, half- or full-width cards on wide screens. In edit mode
// every widget gets a strip of controls: drag (or the arrows) to reorder, width, chart height,
// settings and remove. Each change is saved to the account as it is made.
import Ionicons from '@expo/vector-icons/Ionicons';
import { EmptyState } from '@/components/States';
import { toast } from '@/lib/toast';
import { riseAfter } from '@/lib/motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { entryLabel, keyOf, makeEntry, parseEntry, TitleOverride, Widget, WidgetSettings, WIDGETS, type WidgetCfg, type WidgetDef } from '@/components/Widgets';
import { useWide } from '@/lib/layout';
import { useTheme, type Theme } from '@/lib/theme';
import { afterClose } from '@/lib/useBackToClose';

const HOME_ONLY = ['review', 'week', 'budget', 'networth'];

export function WidgetBoard({ entries, onChange, place, refresh, anchor, range, editing, onEditing, special, extra, blocks = [] }: {
  entries: string[]; onChange: (next: string[]) => void; place: 'home' | 'page' | 'budget' | 'report'; refresh: number;
  /** The month the page is showing, for widgets that follow it. */
  anchor?: string;
  /** The date range the page is showing (Reports), for charts.  */
  range?: { from: string; to: string };
  editing: boolean; onEditing: (v: boolean) => void;
  /** Widgets the page draws itself from data it already has (Overview's four). */
  special?: (key: string) => ReactNode | undefined;
  /** Extra controls at the end of the edit bar (a page's name and delete). */
  extra?: ReactNode;
  /** Blocks that belong to this page only (drawn through `special`). */
  blocks?: WidgetDef[];
}) {
  const t = useTheme();
  const wide = useWide();
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState<{ index: number | null; key: string; cfg: WidgetCfg } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const defs = [...blocks, ...WIDGETS];
  const labelOf = (e: string) => blocks.find((b) => b.key === parseEntry(e)[0])?.title ?? entryLabel(e);
  const avail = [...blocks, ...WIDGETS.filter((w) => (place === 'home' ? w.home : place === 'budget' ? w.budget : !HOME_ONLY.includes(w.key)))];
  const known = entries.map((e, i) => ({ e, i })).filter(({ e }) => defs.some((w) => w.key === keyOf(e)));

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= entries.length) return;
    const next = [...entries]; const [x] = next.splice(from, 1); next.splice(to, 0, x); onChange(next);
  };
  const patch = (i: number, c: Partial<WidgetCfg>) => {
    const [k, cfg] = parseEntry(entries[i]);
    onChange(entries.map((e, n) => (n === i ? makeEntry(k, { ...cfg, ...c }) : e)));
  };
  const add = (w: WidgetDef) => {
    setAdding(false);
    // Let the list finish closing (its history step) before the settings sheet opens.
    if (w.config) afterClose(() => setSettings({ index: null, key: w.key, cfg: w.config === 'chart' ? { months: 6, source: 'spending', view: 'bars' } : {} }));
    else onChange([...entries, w.key]);
  };

  const bar = (
      <View style={styles.bar}>
        {editing ? (
          <>
            <Pressable onPress={() => setAdding(true)} style={[styles.pill, { borderColor: t.accent }]}><Ionicons name="add" size={18} color={t.accent} /><Text style={{ color: t.accent, fontWeight: '600' }}>Add widget</Text></Pressable>
            {extra}
            <Pressable onPress={() => onEditing(false)} style={[styles.pill, { borderColor: t.accent, backgroundColor: t.accent }]}><Text style={{ color: '#fff', fontWeight: '600' }}>Done</Text></Pressable>
          </>
        ) : (
          <Pressable onPress={() => onEditing(true)} style={styles.pill} accessibilityLabel="Edit layout">
            <Ionicons name="options-outline" size={16} color={t.accent} /><Text style={{ color: t.accent }}>{known.length ? (place === 'budget' ? 'Edit widgets' : 'Edit layout') : 'Add widgets'}</Text>
          </Pressable>
        )}
      </View>
  );
  return (
    <>
      <View style={[styles.board, wide && { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' }]}>
        {known.map(({ e, i }) => {
          const [k, cfg] = parseEntry(e);
          const full = cfg.w === 'full';
          return (
            <Cell key={`${i}:${e}`} wide={wide} full={full} editing={editing} index={i} t={t} isOver={over === i && drag !== i}
              onDragStart={() => setDrag(i)} onDragOver={() => setOver(i)} onDrop={() => { if (drag != null) move(drag, i); setDrag(null); setOver(null); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
              {editing && (
                <View style={[styles.tools, { backgroundColor: t.card, borderColor: t.line }]}>
                  {Platform.OS === 'web' && wide && <Ionicons name="reorder-three" size={20} color={t.muted} style={{ cursor: 'grab' } as any} />}
                  <Text style={{ color: t.text, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>{labelOf(e)}</Text>
                  <Tool t={t} icon={wide ? 'chevron-back' : 'chevron-up'} label="Move earlier" onPress={() => move(i, i - 1)} off={i === 0} />
                  <Tool t={t} icon={wide ? 'chevron-forward' : 'chevron-down'} label="Move later" onPress={() => move(i, i + 1)} off={i === entries.length - 1} />
                  {wide && <Tool t={t} icon={full ? 'contract-outline' : 'expand-outline'} label={full ? 'Make half width' : 'Make full width'} onPress={() => patch(i, { w: full ? 'half' : 'full' })} />}
                  {defs.find((w) => w.key === keyOf(e))?.sizable && <Pressable onPress={() => patch(i, { h: cfg.h === 's' ? 'm' : cfg.h === 'l' ? 's' : 'l' })} accessibilityLabel="Change height" hitSlop={6} style={[styles.size, { borderColor: t.line }]}>
                    <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>{cfg.h === 's' ? 'Short' : cfg.h === 'l' ? 'Tall' : 'Medium'}</Text>
                  </Pressable>}
                  {WIDGETS.some((w) => w.key === keyOf(e)) && <Tool t={t} icon="settings-outline" label="Widget settings" onPress={() => setSettings({ index: i, key: keyOf(e), cfg: k === 'spend' ? { source: 'spending', ...cfg } : cfg })} />}
                  <Tool t={t} icon="close" label="Remove widget" onPress={() => { const before = entries; onChange(entries.filter((_, n) => n !== i)); toast('Widget removed', { undo: () => onChange(before) }); }} />
                </View>
              )}
              <View style={[{ flexGrow: 1 }, editing && { opacity: drag === i ? 0.4 : 1 }]} pointerEvents={editing ? 'none' : 'auto'}>
                {special?.(k) != null ? <TitleOverride.Provider value={cfg.title || undefined}>{special(k)}</TitleOverride.Provider> : <Widget k={e} refresh={refresh} anchor={anchor} range={range} />}
              </View>
            </Cell>
          );
        })}
      </View>
      {!known.length && place !== 'budget' && !editing && <EmptyState icon="grid-outline" title="No widgets here yet" text="Add charts and summaries and arrange them the way you like." action="Add widgets" onAction={() => onEditing(true)} />}
      {bar}
      {adding && (
        <Sheet title="Add a widget" onClose={() => setAdding(false)}>
          {avail.filter((w) => w.config || !entries.some((e) => keyOf(e) === w.key)).sort((a, b) => Number(!!b.config) - Number(!!a.config)).map((w) => (
            <Pressable key={w.key} onPress={() => add(w)} style={({ pressed, hovered }: any) => [styles.choice, { borderColor: t.line, backgroundColor: pressed || hovered ? t.line : t.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>{w.title}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{w.about}</Text>
              </View>
              <Ionicons name={w.config ? 'chevron-forward' : 'add-circle-outline'} size={20} color={t.accent} />
            </Pressable>
          ))}
        </Sheet>
      )}
      {settings && (
        <WidgetSettings kind={settings.key === 'chart' || settings.key === 'account' ? settings.key : 'basic'} widget={settings.key} cfg={settings.cfg} onClose={() => setSettings(null)}
          onDone={(cfg) => {
            const e = makeEntry(settings.key, cfg);
            onChange(settings.index == null ? [...entries, e] : entries.map((x, n) => (n === settings.index ? e : x)));
            setSettings(null);
          }} />
      )}
    </>
  );
}

function Tool({ t, icon, label, onPress, off }: { t: Theme; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; off?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityLabel={label} hitSlop={6} style={({ hovered }: any) => [styles.tool, hovered && { backgroundColor: t.line }, off && { opacity: 0.25 }]}>
      <Ionicons name={icon} size={18} color={t.accent} />
    </Pressable>
  );
}

/** One slot on the board. On the web, while editing, it can be dragged onto another slot to take its place. */
function Cell({ wide, full, editing, index, t, isOver, onDragStart, onDragOver, onDrop, onDragEnd, children }: {
  wide: boolean; full: boolean; editing: boolean; index: number; t: Theme; isOver: boolean;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void; onDragEnd: () => void; children: ReactNode;
}) {
  const ref = useRef<View>(null);
  const cb = useRef({ onDragStart, onDragOver, onDrop, onDragEnd });
  cb.current = { onDragStart, onDragOver, onDrop, onDragEnd };
  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el?.setAttribute) return;
    if (!editing) { el.removeAttribute('draggable'); return; }
    el.setAttribute('draggable', 'true');
    const start = (ev: DragEvent) => { ev.dataTransfer?.setData('text/plain', String(index)); cb.current.onDragStart(); };
    const overFn = (ev: DragEvent) => { ev.preventDefault(); cb.current.onDragOver(); };
    const drop = (ev: DragEvent) => { ev.preventDefault(); cb.current.onDrop(); };
    const end = () => cb.current.onDragEnd();
    el.addEventListener('dragstart', start); el.addEventListener('dragover', overFn); el.addEventListener('drop', drop); el.addEventListener('dragend', end);
    return () => { el.removeEventListener('dragstart', start); el.removeEventListener('dragover', overFn); el.removeEventListener('drop', drop); el.removeEventListener('dragend', end); };
  }, [editing, index]);
  return (
    <View ref={ref} style={[styles.cell, !editing && riseAfter(index), wide && (full ? { flexBasis: '100%' } : { flexBasis: '45%', flexGrow: 1, minWidth: 0 }), editing && { borderRadius: 14, outlineWidth: 2, outlineStyle: isOver ? 'solid' : 'dashed', outlineColor: isOver ? t.accent : t.line, outlineOffset: 2 } as any]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  board: { gap: 10 },
  cell: { gap: 6 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingLeft: 10, paddingRight: 4, minHeight: 40 },
  tool: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  size: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, height: 30, justifyContent: 'center', marginHorizontal: 2 },
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'transparent', borderRadius: 20, paddingHorizontal: 14, minHeight: 40 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
});
