// The one way to choose dates, used by Transactions, Merchants and Reports: a button that shows
// the current range and opens the same list of presets with a custom from/to underneath.
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, addMonths, monthEnd, monthOf, shortDate } from '@budget-app/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { Field, Sheet } from '@/components/Forms';
import { Button, Chip } from '@/components/ui';
import { today } from '@/lib/plan';
import { useTheme, type Theme } from '@/lib/theme';

/** `from` and `to` are dates, or '' for "no limit" on that side. */
export interface Range { key: string; label: string; from: string; to: string }
export const ALL_TIME: Range = { key: 'all', label: 'All time', from: '', to: '' };

export function rangePresets(): Range[] {
  const now = today(), m = monthOf(now), y = now.slice(0, 4);
  return [
    ALL_TIME,
    { key: 'month', label: 'This month', from: m, to: monthEnd(m) },
    { key: 'lastMonth', label: 'Last month', from: addMonths(m, -1), to: monthEnd(addMonths(m, -1)) },
    { key: '30d', label: 'Last 30 days', from: addDays(now, -29), to: now },
    { key: '3m', label: 'Last 3 months', from: addMonths(m, -2), to: monthEnd(m) },
    { key: '12m', label: 'Last 12 months', from: addMonths(m, -11), to: monthEnd(m) },
    { key: 'year', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
    { key: 'lastYear', label: 'Last year', from: `${Number(y) - 1}-01-01`, to: `${Number(y) - 1}-12-31` },
  ];
}
export const rangeByKey = (key: string): Range => rangePresets().find((r) => r.key === key) ?? ALL_TIME;
const custom = (from: string, to: string): Range =>
  (!from && !to ? ALL_TIME : { key: 'custom', label: `${from ? shortDate(from) : 'Start'} – ${to ? shortDate(to) : 'now'}`, from, to });

/** The presets and the custom dates, for use inside another sheet (the Transactions filters). */
export function DateRangeBody({ t, value, onChange, onPicked }: { t: Theme; value: Range; onChange: (r: Range) => void; onPicked?: () => void }) {
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {rangePresets().map((p) => <Chip key={p.key} label={p.label} on={value.key === p.key} onPress={() => { onChange(p); onPicked?.(); }} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Field t={t} label="From"><DateField value={value.from} onChange={(v) => onChange(custom(v, value.to))} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="To"><DateField value={value.to} onChange={(v) => onChange(custom(value.from, v))} /></Field></View>
      </View>
    </>
  );
}

/** The button, with its own sheet. */
export function DateRangeButton({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const on = value.key !== 'all';
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={`Dates: ${value.label}`} style={({ hovered }: any) => [styles.btn, { borderColor: on ? t.accent : t.line, backgroundColor: hovered ? t.line : t.card }]}>
        <Ionicons name="calendar-outline" size={16} color={on ? t.accent : t.muted} />
        <Text style={{ color: on ? t.accent : t.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{value.label}</Text>
        <Ionicons name="chevron-down" size={14} color={t.muted} />
      </Pressable>
      {open && (
        <Sheet title="Dates" onClose={() => setOpen(false)} footer={<Button title="Done" onPress={() => setOpen(false)} />}>
          <DateRangeBody t={t} value={value} onChange={onChange} onPicked={() => setOpen(false)} />
        </Sheet>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minHeight: 38, maxWidth: 240, alignSelf: 'flex-start' },
});
