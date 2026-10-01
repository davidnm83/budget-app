// Gig work (GIG-1, 2, 3, 6, 8). Earnings: payouts in your "Gig work" category by week, month and
// platform, with a weekly target. Shifts: a log of each shift with $/hour, $/km and what's left
// after gas. Payouts stay separate transactions (one per deposit); this page groups them.
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDays, costPerKmFrom, formatMoney, GIG_PLATFORMS, platformByKey, shiftStats, shortDate, summarizePayouts,
  todayIn, totalShifts, weekStart, type Payout, type Shift,
} from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { Field, Sheet } from '@/components/Forms';
import { Button, Card, Chip, Segmented } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';

interface ShiftRow extends Shift { id: string; notes: string | null }
interface Settings { cost_per_km: number | null; weekly_target: number | null }

const money0 = (n: number) => formatMoney(n).replace(/\.\d\d$/, '');
const today = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

export default function Gig() {
  const t = useTheme();
  const [view, setView] = useState<'earnings' | 'shifts'>('earnings');
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [settings, setSettings] = useState<Settings>({ cost_per_km: null, weekly_target: null });
  const [gas90, setGas90] = useState(0);
  const [hasCategory, setHasCategory] = useState(true);
  const [editing, setEditing] = useState<Partial<ShiftRow> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const now = today();
    const from = `${Number(now.slice(0, 4)) - 1}-${now.slice(5, 7)}-01`;
    const { data: cats } = await supabase.from('categories').select('id, name').or('name.ilike.gig work,name.ilike.gig income');
    const gigIds = (cats ?? []).map((c: any) => c.id);
    setHasCategory(gigIds.length > 0);
    const [p, s, st, gas] = await Promise.all([
      gigIds.length
        ? supabase.from('transaction_lines').select('date, amount, merchant').in('category_id', gigIds).gte('date', from).gt('amount', 0).limit(5000)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('gig_shifts').select('*').gte('date', addDays(now, -400)).order('date', { ascending: false }).limit(2000),
      supabase.from('gig_settings').select('cost_per_km, weekly_target').maybeSingle(),
      supabase.from('transaction_list').select('amount, category_name').ilike('category_name', 'gas').gte('date', addDays(now, -90)).lt('amount', 0).limit(1000),
    ]);
    if (p.error || s.error) setError((p.error ?? s.error)!.message);
    setPayouts(((p.data ?? []) as any[]).map((r) => ({ date: r.date, amount: Number(r.amount), text: r.merchant ?? '' })));
    setShifts(((s.data ?? []) as any[]).map((r) => ({
      id: r.id, date: r.date, platform: r.platform, start: r.start_time, end: r.end_time, activeMinutes: r.active_minutes,
      deliveries: r.deliveries, earnings: Number(r.earnings), tips: r.tips != null ? Number(r.tips) : null, km: r.km != null ? Number(r.km) : null, notes: r.notes,
    })));
    setSettings({ cost_per_km: st.data?.cost_per_km != null ? Number(st.data.cost_per_km) : null, weekly_target: st.data?.weekly_target != null ? Number(st.data.weekly_target) : null });
    setGas90(-((gas.data ?? []) as any[]).reduce((x, r) => x + Number(r.amount), 0));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const now = today();
  const sum = useMemo(() => summarizePayouts(payouts, now, 12, 6), [payouts, now]);
  const km90 = shifts.filter((s) => s.date >= addDays(now, -90)).reduce((x, s) => x + (s.km ?? 0), 0);
  const suggestedCpk = costPerKmFrom(gas90, km90);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        <Segmented value={view} onChange={setView} options={[{ value: 'earnings', label: 'Earnings' }, { value: 'shifts', label: 'Shifts' }]} />
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {view === 'earnings'
          ? <Earnings t={t} sum={sum} target={settings.weekly_target} hasCategory={hasCategory} onSettings={() => setShowSettings(true)} />
          : <Shifts t={t} shifts={shifts} cpk={settings.cost_per_km} onEdit={setEditing} onSettings={() => setShowSettings(true)} />}
      </ScrollView>
      {view === 'shifts' && (
        <Pressable onPress={() => setEditing({ date: now, platform: shifts[0]?.platform ?? 'doordash' })} style={[styles.fab, { backgroundColor: t.accent }]} accessibilityLabel="Log a shift">
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}
      {editing && <ShiftForm initial={editing} cpk={settings.cost_per_km} onClose={() => setEditing(null)} onSaved={load} />}
      {showSettings && <SettingsForm initial={settings} suggested={suggestedCpk} gas90={gas90} km90={km90} onClose={() => setShowSettings(false)} onSaved={load} />}
    </View>
  );
}

// ───────────────────────── earnings ─────────────────────────
function Earnings({ t, sum, target, hasCategory, onSettings }: {
  t: Theme; sum: ReturnType<typeof summarizePayouts>; target: number | null; hasCategory: boolean; onSettings: () => void;
}) {
  const maxWeek = Math.max(1, target ?? 0, ...sum.weeks.map((w) => w.total));
  const colorOf = (key: string) => PLATFORM_COLORS[key] ?? t.muted;
  const used = [...new Set(sum.weeks.flatMap((w) => Object.keys(w.byPlatform)).concat(sum.months.flatMap((m) => Object.keys(m.byPlatform))))];
  return (
    <>
      {!hasCategory && <Card><Text style={{ color: t.text }}>Make a category called “Gig work” (Categories in the menu) and put your payouts in it; they show up here.</Text></Card>}
      <View style={styles.tiles}>
        <Tile t={t} label="This week" value={money0(sum.thisWeek)} sub={target ? `of ${money0(target)} target` : `avg ${money0(sum.avgWeek)}/wk`}
          color={target ? (sum.thisWeek >= target ? t.accent : t.series2) : undefined} />
        <Tile t={t} label="Last week" value={money0(sum.lastWeek)} />
        <Tile t={t} label="This month" value={money0(sum.thisMonth)} sub={`last ${money0(sum.lastMonth)}`} />
        <Tile t={t} label="This year" value={money0(sum.ytd)} />
      </View>
      {target != null && target > 0 && (
        <View style={{ gap: 4 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.track, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, (sum.thisWeek / target) * 100)}%`, height: '100%', backgroundColor: sum.thisWeek >= target ? t.accent : t.series2 }} />
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {sum.thisWeek >= target ? 'Weekly target reached.' : `${money0(target - sum.thisWeek)} to go this week.`} Payouts often land a few days after the work.
          </Text>
        </View>
      )}

      <Card style={{ gap: 8 }}>
        <View style={styles.between}>
          <Text style={[styles.h, { color: t.muted }]}>Last 12 weeks</Text>
          <Pressable onPress={onSettings} hitSlop={8}><Text style={{ color: t.accent, fontSize: 12 }}>{target ? 'Change target' : 'Set a weekly target'}</Text></Pressable>
        </View>
        <View style={styles.chart}>
          {sum.weeks.map((w) => (
            <View key={w.week} style={styles.barCol}>
              <Text style={{ color: t.muted, fontSize: 9 }} numberOfLines={1}>{w.total ? money0(w.total).replace('$', '') : ''}</Text>
              <View style={{ flex: 1, width: '100%', justifyContent: 'flex-end' }}>
                {Object.entries(w.byPlatform).sort().map(([k, v]) => (
                  <View key={k} style={{ height: `${(v / maxWeek) * 100}%`, backgroundColor: colorOf(k), borderRadius: 2 }} />
                ))}
              </View>
              <Text style={{ color: t.muted, fontSize: 9 }} numberOfLines={1}>{shortDate(w.week).replace(/^\w+ /, '')}</Text>
            </View>
          ))}
          {target ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 14 + (target / maxWeek) * (CHART_H - 28), borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.text, opacity: 0.4 }} /> : null}
        </View>
        <View style={styles.legend}>
          {used.map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colorOf(k) }} />
              <Text style={{ color: t.muted, fontSize: 12 }}>{platformByKey(k).name}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>Average of the last 8 full weeks: {formatMoney(sum.avgWeek)}</Text>
      </Card>

      <Card style={{ padding: 0 }}>
        <Text style={[styles.h, { color: t.muted, paddingHorizontal: 12, paddingTop: 10 }]}>By month</Text>
        <View style={[styles.mRow, { borderColor: t.line }]}>
          <Text style={[styles.mCell, { color: t.muted, flex: 1.2, textAlign: 'left' }]}>Month</Text>
          {used.map((k) => <Text key={k} style={[styles.mCell, { color: t.muted }]} numberOfLines={1}>{platformByKey(k).icon}</Text>)}
          <Text style={[styles.mCell, { color: t.muted, fontWeight: '700' }]}>Total</Text>
        </View>
        {[...sum.months].reverse().map((m) => (
          <View key={m.month} style={[styles.mRow, { borderColor: t.line }]}>
            <Text style={[styles.mCell, { color: t.text, flex: 1.2, textAlign: 'left' }]}>{monthLabel(m.month)}</Text>
            {used.map((k) => <Text key={k} style={[styles.mCell, { color: t.text }]}>{m.byPlatform[k] ? money0(m.byPlatform[k]) : '–'}</Text>)}
            <Text style={[styles.mCell, { color: t.text, fontWeight: '700' }]}>{money0(m.total)}</Text>
          </View>
        ))}
      </Card>

      {sum.platforms.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.h, { color: t.muted }]}>This year by platform</Text>
          {sum.platforms.map((p) => (
            <View key={p.key} style={{ gap: 3 }}>
              <View style={styles.between}>
                <Text style={{ color: t.text }}>{platformByKey(p.key).icon}  {platformByKey(p.key).name}</Text>
                <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{money0(p.total)} · {Math.round(p.share * 100)}%</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.track, overflow: 'hidden' }}>
                <View style={{ width: `${p.share * 100}%`, height: '100%', backgroundColor: colorOf(p.key) }} />
              </View>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

// ───────────────────────── shifts ─────────────────────────
function Shifts({ t, shifts, cpk, onEdit, onSettings }: { t: Theme; shifts: ShiftRow[]; cpk: number | null; onEdit: (s: ShiftRow) => void; onSettings: () => void }) {
  const weeks = useMemo(() => {
    const m = new Map<string, ShiftRow[]>();
    for (const s of shifts) { const w = weekStart(s.date); (m.get(w) ?? m.set(w, []).get(w)!).push(s); }
    return [...m.entries()];
  }, [shifts]);
  const last30 = totalShifts(shifts.filter((s) => s.date >= addDays(today(), -30)), cpk);
  return (
    <>
      <View style={styles.tiles}>
        <Tile t={t} label="Last 30 days" value={money0(last30.earnings)} sub={`${last30.shifts} shift${last30.shifts === 1 ? '' : 's'} · ${last30.hours} h`} />
        <Tile t={t} label="Per hour" value={last30.perHour != null ? formatMoney(last30.perHour) : '–'} sub="before gas" />
        <Tile t={t} label="Per km" value={last30.perKm != null ? formatMoney(last30.perKm) : '–'} sub={`${Math.round(last30.km)} km`} />
        <Tile t={t} label="After gas" value={money0(last30.net)} sub={cpk ? `at ${formatMoney(cpk)}/km` : 'set a cost/km'} />
      </View>
      {!cpk && (
        <Pressable onPress={onSettings}><Text style={{ color: t.accent, fontSize: 13 }}>Set your car cost per km to see earnings after gas →</Text></Pressable>
      )}
      {!shifts.length && <Card><Text style={{ color: t.muted }}>No shifts yet. Tap + after a shift to log its hours, earnings and km.</Text></Card>}
      {weeks.map(([w, list]) => {
        const tot = totalShifts(list, cpk);
        return (
          <Card key={w} style={{ padding: 0 }}>
            <View style={[styles.weekHead, { backgroundColor: t.bg, borderColor: t.line }]}>
              <Text style={{ color: t.text, fontWeight: '700', flex: 1 }}>Week of {shortDate(w)}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{tot.hours} h{tot.perHour != null ? ` · ${formatMoney(tot.perHour)}/h` : ''}  </Text>
              <Text style={{ color: t.text, fontWeight: '700' }}>{money0(tot.earnings)}</Text>
            </View>
            {list.map((s) => {
              const st = shiftStats(s, cpk);
              const p = platformByKey(s.platform);
              return (
                <Pressable key={s.id} onPress={() => onEdit(s)} style={({ pressed }) => [styles.shift, { borderColor: t.line }, pressed && { backgroundColor: t.line }]}>
                  <Text style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{p.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text }}>{shortDate(s.date)} · {p.name}{s.start && s.end ? ` · ${s.start}–${s.end}` : ''}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {[st.hours != null && `${st.hours} h`, s.km && `${s.km} km`, s.deliveries && `${s.deliveries} orders`, st.perHour != null && `${formatMoney(st.perHour)}/h`, st.perKm != null && `${formatMoney(st.perKm)}/km`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: t.text, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(s.earnings)}</Text>
                    {st.carCost != null && <Text style={{ color: t.muted, fontSize: 11 }}>{formatMoney(st.net)} after gas</Text>}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        );
      })}
    </>
  );
}

function ShiftForm({ initial, cpk, onClose, onSaved }: { initial: Partial<ShiftRow>; cpk: number | null; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [date, setDate] = useState(initial.date ?? today());
  const [platform, setPlatform] = useState(initial.platform ?? 'doordash');
  const [start, setStart] = useState(initial.start ?? '');
  const [end, setEnd] = useState(initial.end ?? '');
  const [active, setActive] = useState(initial.activeMinutes != null ? String(initial.activeMinutes) : '');
  const [deliveries, setDeliveries] = useState(initial.deliveries != null ? String(initial.deliveries) : '');
  const [earnings, setEarnings] = useState(initial.earnings != null ? String(initial.earnings) : '');
  const [tips, setTips] = useState(initial.tips != null ? String(initial.tips) : '');
  const [km, setKm] = useState(initial.km != null ? String(initial.km) : '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [error, setError] = useState('');
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[$,\s]/g, '')));
  const time = (s: string) => { const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(s.trim()); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
  const preview = shiftStats({ date, platform, start: time(start), end: time(end), activeMinutes: num(active), deliveries: num(deliveries), earnings: num(earnings) ?? 0, km: num(km) }, cpk);

  const save = async () => {
    const e = num(earnings);
    if (!date || e == null || isNaN(e)) { setError('Fill in the date and what you earned.'); return; }
    if ((start && !time(start)) || (end && !time(end))) { setError('Times look like 17:30.'); return; }
    const row = {
      date, platform, start_time: time(start), end_time: time(end), active_minutes: num(active), deliveries: num(deliveries),
      earnings: e, tips: num(tips), km: num(km), notes: notes.trim() || null,
    };
    const { error } = initial.id ? await supabase.from('gig_shifts').update(row).eq('id', initial.id) : await supabase.from('gig_shifts').insert(row);
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };
  const remove = async () => {
    const { error } = await supabase.from('gig_shifts').delete().eq('id', initial.id!);
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };

  return (
    <Sheet title={initial.id ? 'Edit shift' : 'Log a shift'} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {initial.id ? <Button title="Delete" kind="danger" onPress={remove} /> : null}
        <Button title="Save" onPress={save} style={{ flex: 1 }} />
      </View>}>
      <Field t={t} label="Platform">
        <View style={styles.chips}>
          {GIG_PLATFORMS.map((p) => <Chip key={p.key} label={`${p.icon} ${p.name}`} on={platform === p.key} onPress={() => setPlatform(p.key)} />)}
          <Chip label="💼 Other" on={platform === 'other'} onPress={() => setPlatform('other')} />
        </View>
      </Field>
      <Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field>
      <View style={styles.row2}>
        <View style={{ flex: 1 }}><Field t={t} label="Start"><TextInput value={start} onChangeText={setStart} placeholder="17:30" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="End"><TextInput value={end} onChangeText={setEnd} placeholder="21:00" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Active min"><TextInput value={active} onChangeText={setActive} keyboardType="number-pad" placeholder="opt." placeholderTextColor={t.muted} style={input} /></Field></View>
      </View>
      <View style={styles.row2}>
        <View style={{ flex: 1 }}><Field t={t} label="Earned (with tips)"><TextInput value={earnings} onChangeText={setEarnings} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Tips (part of it)"><TextInput value={tips} onChangeText={setTips} keyboardType="decimal-pad" placeholder="opt." placeholderTextColor={t.muted} style={input} /></Field></View>
      </View>
      <View style={styles.row2}>
        <View style={{ flex: 1 }}><Field t={t} label="Km driven"><TextInput value={km} onChangeText={setKm} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Orders"><TextInput value={deliveries} onChangeText={setDeliveries} keyboardType="number-pad" placeholder="opt." placeholderTextColor={t.muted} style={input} /></Field></View>
      </View>
      <Field t={t} label="Notes"><TextInput value={notes} onChangeText={setNotes} placeholder="zone, weather, promos…" placeholderTextColor={t.muted} style={input} /></Field>
      {(preview.perHour != null || preview.perKm != null) && (
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {[preview.hours != null && `${preview.hours} h`, preview.perHour != null && `${formatMoney(preview.perHour)}/h`, preview.perKm != null && `${formatMoney(preview.perKm)}/km`,
            preview.carCost != null && `${formatMoney(preview.net)} after ${formatMoney(preview.carCost)} gas`].filter(Boolean).join(' · ')}
        </Text>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

function SettingsForm({ initial, suggested, gas90, km90, onClose, onSaved }: {
  initial: Settings; suggested: number | null; gas90: number; km90: number; onClose: () => void; onSaved: () => void;
}) {
  const t = useTheme();
  const [cpk, setCpk] = useState(initial.cost_per_km != null ? String(initial.cost_per_km) : '');
  const [target, setTarget] = useState(initial.weekly_target != null ? String(initial.weekly_target) : '');
  const [error, setError] = useState('');
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const save = async () => {
    const n = (s: string) => (s.trim() ? Number(s.replace(/[$,\s]/g, '')) : null);
    const { error } = await supabase.from('gig_settings').upsert({ cost_per_km: n(cpk), weekly_target: n(target), updated_at: new Date().toISOString() });
    if (error) setError(error.message); else { onSaved(); onClose(); }
  };
  return (
    <Sheet title="Gig settings" onClose={onClose} footer={<Button title="Save" onPress={save} />}>
      <Field t={t} label="Weekly earnings target"><TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="e.g. 600" placeholderTextColor={t.muted} style={input} /></Field>
      <Field t={t} label="Car cost per km" hint="Gas only is a good start; add wear (tires, oil, repairs) if you want a fuller picture.">
        <TextInput value={cpk} onChangeText={setCpk} keyboardType="decimal-pad" placeholder="e.g. 0.12" placeholderTextColor={t.muted} style={input} />
      </Field>
      {suggested != null ? (
        <Pressable onPress={() => setCpk(String(suggested))}>
          <Text style={{ color: t.accent, fontSize: 13 }}>Use {formatMoney(suggested)}/km: {formatMoney(gas90)} of gas ÷ {Math.round(km90)} km logged in the last 90 days</Text>
        </Pressable>
      ) : (
        <Text style={{ color: t.muted, fontSize: 13 }}>Log km on your shifts and this can suggest a cost from your gas spending.</Text>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

function Tile({ t, label, value, sub, color }: { t: Theme; label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: color ? color + '14' : t.card, borderColor: color ?? t.line }, color && { borderLeftWidth: 3 }]}>
      <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: color ?? t.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

const monthLabel = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const PLATFORM_COLORS: Record<string, string> = { doordash: '#e5533d', uber: '#3987e5', instacart: '#43a047', skip: '#f29f05', lyft: '#d63fa3', 'naan-kabob': '#8e6bd6', other: '#8a8a84' };
const CHART_H = 150;

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: 96, maxWidth: 760, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { flexGrow: 1, flexBasis: '22%', minWidth: 78, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  h: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chart: { height: CHART_H, flexDirection: 'row', alignItems: 'stretch', gap: 3 },
  barCol: { flex: 1, alignItems: 'center', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  mCell: { flex: 1, textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'] },
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  shift: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row2: { flexDirection: 'row', gap: 10 },
  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
