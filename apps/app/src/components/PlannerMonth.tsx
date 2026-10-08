// The Planner's month: a calendar of what's planned and what posted, with each day's closing balance,
// the month's figures above it and the chosen day's entries under it.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMoney, shortDate, type WeekRow } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { compact, MonthGrid, type DayCell } from '@/components/MonthGrid';
import { Tile } from '@/components/Tile';
import { Card, Chip } from '@/components/ui';
import { ROW } from '@/lib/layout';
import type { MonthData } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import type { Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PlannerMonth({ t, d, now, only, setOnly, onRow, onAdd, onChanged }: {
  t: Theme; d: MonthData; now: string; only: string | null; setOnly: (id: string | null) => void;
  onRow: (r: WeekRow) => void; onAdd: (date: string) => void; onChanged: () => void;
}) {
  const v = d.view;
  const planAccounts = d.accounts.filter((a) => a.plan_include);
  const name = (id: string | null) => d.accounts.find((a) => a.id === id)?.name ?? '';
  const inMonth = now.slice(0, 7) === d.month.slice(0, 7);
  const firstBusy = v.days.find((x) => x.rows.length)?.date ?? d.month;
  const [sel, setSel] = useState(inMonth ? now : firstBusy);
  useEffect(() => { setSel(inMonth ? now : firstBusy); }, [d.month]);

  // The month's figures: the lowest the balance gets (from today on), bills still to pay, income to come.
  const ahead = v.days.filter((x) => x.date >= now);
  const low = ahead.length ? ahead.reduce((m, x) => (x.endBalance < m.endBalance ? x : m)) : null;
  const rows = v.days.flatMap((x) => x.rows);
  const planned = rows.filter((r) => r.kind === 'planned' && !r.item?.transfer);
  const toPay = planned.filter((r) => r.planned! < 0 && r.actual == null).reduce((s, r) => s - r.planned!, 0);
  const bills = planned.filter((r) => r.planned! < 0).reduce((s, r) => s - r.counted, 0);
  const income = planned.filter((r) => r.planned! > 0).reduce((s, r) => s + r.counted, 0);
  const past = d.month.slice(0, 7) < now.slice(0, 7);
  const end = d.actual[v.days[v.days.length - 1].date];

  // Bills to look at: paid a different amount than the bill says, or more than 4 days late with nothing seen.
  const late = (r: WeekRow) => r.overdue && (Date.parse(now) - Date.parse(r.date)) / 864e5 > 4;
  const changed = (r: WeekRow) => !!r.item?.recurringId && !r.item.estimated && r.actual != null && Math.abs(r.actual - r.planned!) >= 0.01;
  const look = planned.filter((r) => changed(r) || late(r));
  const useAmount = async (r: WeekRow) => {
    const { error } = await supabase.from('recurring').update({ amount: r.actual }).eq('id', r.item!.recurringId!);
    if (error) toast(error.message); else { toast(`${r.description} is now ${formatMoney(r.actual!)}`); onChanged(); }
  };

  const cells: Record<string, DayCell> = {};
  for (const day of v.days) {
    const out = day.rows.filter((r) => r.counted < 0 && !r.item?.transfer).reduce((s, r) => s + r.counted, 0);
    const inn = day.rows.filter((r) => r.counted > 0 && !r.item?.transfer).reduce((s, r) => s + r.counted, 0);
    const bal = d.actual[day.date] ?? day.endBalance;
    const warn = v.warnings.some((w) => w.date === day.date);
    cells[day.date] = {
      lines: [...(out ? [{ text: compact(out), color: t.danger }] : []), ...(inn ? [{ text: `+${compact(inn)}`, color: t.positive }] : [])],
      foot: day.rows.length || day.date === now || day.date === d.month ? { text: compact(bal), color: bal < 0 || warn ? t.danger : t.muted } : undefined,
      dot: day.rows.some((r) => r.overdue) ? t.danger : warn ? t.series2 : undefined,
    };
  }
  const day = v.days.find((x) => x.date === sel);
  const dow = WEEKDAY[new Date(sel + 'T00:00:00Z').getUTCDay()];
  const real = d.actual[sel];

  return (
    <>
      {planAccounts.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip label="Combined" on={!only} onPress={() => setOnly(null)} />
          {planAccounts.map((a) => <Chip key={a.id} label={a.name} on={only === a.id} onPress={() => setOnly(a.id)} />)}
        </ScrollView>
      )}
      <View style={styles.tiles}>
        <Tile t={t} label="Start" value={money0(v.startBalance)} three />
        {low && !past ? <Tile t={t} label="Lowest" value={money0(low.endBalance)} sub={shortDate(low.date)} three warn={low.endBalance < 0 || v.warnings.length > 0} />
          : <Tile t={t} label="Money out" value={money0(v.summary.actualOut)} three />}
        <Tile t={t} label={past ? 'End' : 'Projected end'} value={money0(past && end != null ? end : v.endBalance)} strong three />
      </View>
      <View style={styles.tiles}>
        <Tile t={t} label="Bills" value={money0(bills)} sub={toPay > 0 ? `${money0(toPay)} still to pay` : 'all paid'} three />
        <Tile t={t} label="Income" value={money0(income)} sub="planned this month" three />
      </View>
      {v.warnings.map((w) => (
        <View key={w.accountId} style={[styles.warn, { borderColor: t.danger }]}>
          <Ionicons name="warning" size={18} color={t.danger} />
          <Text style={{ color: t.text, flex: 1, fontSize: 13 }}>
            <Text style={{ fontWeight: '700' }}>{name(w.accountId)}</Text> drops to {formatMoney(w.balance)} on {shortDate(w.date)} (below {formatMoney(w.buffer)}) after “{w.cause}”.
          </Text>
        </View>
      ))}
      <Card style={{ padding: 8 }}>
        <MonthGrid t={t} month={d.month} today={now} cells={cells} selected={sel} onPress={setSel} height={62} />
        <Text style={{ color: t.muted, fontSize: 11, paddingHorizontal: 4, paddingTop: 4 }}>Each day: money out, money in, and the balance at the end of the day (the real one up to today).</Text>
      </Card>

      <View style={styles.dayHead}>
        <Text style={{ color: t.text, fontWeight: '700', flex: 1 }}>{dow} {shortDate(sel)}{sel === now ? ' · today' : ''}</Text>
        {day && <Text style={{ color: t.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{real != null && Math.abs(real - day.endBalance) >= 1 ? `actual ${formatMoney(real)} · plan ` : 'ends at '}{formatMoney(day.endBalance)}</Text>}
      </View>
      <Card style={{ padding: 0 }}>
        {day?.rows.map((r, i) => <View key={r.key} style={i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }}><PlanRow t={t} r={r} account={only ? '' : name(r.accountId)} onPress={() => onRow(r)} /></View>)}
        {!day?.rows.length && <Text style={{ color: t.muted, padding: 12 }}>Nothing planned or posted.</Text>}
        <Pressable onPress={() => onAdd(sel)} style={({ hovered, pressed }: any) => [styles.add, { borderColor: t.line }, (hovered || pressed) && { backgroundColor: t.line }]}>
          <Ionicons name="add" size={16} color={t.accent} /><Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>Plan a one-off on this day</Text>
        </Pressable>
      </Card>

      {look.length > 0 && (
        <Card style={{ gap: 6, borderColor: t.series2, borderWidth: 1 }}>
          <Text style={{ color: t.text, fontWeight: '700' }}>{look.length} to look at</Text>
          {look.map((r) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable onPress={() => onRow(r)} style={{ flex: 1 }}>
                <Text style={{ color: t.muted, fontSize: 13 }}>{changed(r) ? `${r.description}: ${formatMoney(r.actual!)} instead of ${formatMoney(r.planned!)}` : `${r.description}: nothing seen since it was due ${shortDate(r.date)}`}</Text>
              </Pressable>
              {changed(r) && <Pressable onPress={() => useAmount(r)} hitSlop={6}><Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>Update the bill</Text></Pressable>}
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

/** One planned or posted entry: what it is, planned against actual, and the balance after it. */
export function PlanRow({ t, r, account, onPress }: { t: Theme; r: WeekRow; account: string; onPress: () => void }) {
  const matched = r.kind === 'planned' && r.actual != null;
  const icon = r.kind === 'actual' ? 'flash-outline' : matched ? 'checkmark-circle' : r.unlisted ? 'hourglass-outline' : r.overdue ? 'alert-circle' : 'time-outline';
  const color = r.kind === 'actual' ? t.muted : matched || r.unlisted ? t.accent : r.overdue ? t.danger : t.muted;
  return (
    <Pressable onPress={onPress} style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && { backgroundColor: t.line }]}>
      <Ionicons name={icon} size={17} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[ROW.title, { color: t.text, fontWeight: r.kind === 'actual' ? '500' : '600' }]} numberOfLines={1}>{r.description}</Text>
        <Text style={{ color: r.overdue ? t.danger : t.muted, fontSize: 12 }} numberOfLines={1}>
          {r.kind === 'actual' ? 'unplanned' : matched ? `planned ${formatMoney(r.planned!)}` : r.unlisted ? 'done by the bank, not listed yet' : r.overdue ? 'not posted yet' : 'planned'}{account ? ` · ${account}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {/* Done by the bank but not listed: its amount is already in the balance, so it shows but doesn't move it. */}
        <Text style={{ color: r.unlisted ? t.muted : r.counted > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'], fontWeight: matched || r.kind === 'actual' ? '600' : '400' }}>{formatMoney(r.unlisted ? r.planned! : r.counted)}</Text>
        <Text style={{ color: r.balanceAfter < 0 ? t.danger : t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatMoney(r.balanceAfter)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 12, paddingVertical: 9 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
