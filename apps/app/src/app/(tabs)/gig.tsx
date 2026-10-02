// Gig work (GIG-1 to GIG-8). Earnings: payouts in your "Gig work" category by week, month and
// app, with a weekly target. Shifts: each shift ("dash") with its time, km and gas, and per app
// the earnings, active time and orders; $/hour, $/active hour, % active, $/km, after gas.
// Settings: gas (L/100 km × $/L), and when each app pays out, which feeds the planner.
import { PAGE_MAX } from '@/lib/layout';
import { EmptyState } from '@/components/States';
import { toast } from '@/lib/toast';
import { deleteWithUndo } from '@/lib/toast';
import { usePullRefresh } from '@/lib/pullRefresh';
import { UNDER_BAR } from '@/lib/layout';
import { BarChart } from '@/components/Charts';
import { PageBoard } from '@/components/PageBoard';
import { makeEntry } from '@/components/Widgets';
import { Tile } from '@/components/Tile';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDays, costPerKmFrom, formatDuration, monthEnd, formatMoney, fuelCostFor, GIG_PLATFORMS, partsOf, platformByKey, shiftStats, shortDate,
  summarizePayouts, todayIn, totalsByPlatform, totalShifts, weekStart, type Payout, type PayoutRule, type ShiftPart,
} from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { DateField, TimeField } from '@/components/DateField';
import { Field, Sheet } from '@/components/Forms';
import { Button, Card, Chip, Segmented } from '@/components/ui';
import { costPerKm, loadGigSettings, loadPayoutRules, loadShifts, saveShift, type GigSettings, type ShiftRow } from '@/lib/gig';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { useTxnSheet } from '@/components/TxnSheet';

interface AccountLite { id: string; name: string; mask: string | null; type: string; plan_include: boolean }

const money0 = (n: number) => formatMoney(n).replace(/\.\d\d$/, '');
const today = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMPTY: GigSettings = { cost_per_km: null, weekly_target: null, fuel_price: null, fuel_efficiency: null, plan_ahead: false, exclude_gig_gas: false };

const GIG_DEFAULT = [makeEntry('gig:tiles', { w: 'full' }), makeEntry('gig:weeks', { w: 'full' }), 'gig:months', 'gig:platforms'];

export default function Gig() {
  const t = useTheme();
  const [view, setView] = useState<'earnings' | 'shifts'>('earnings');
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [settings, setSettings] = useState<GigSettings>(EMPTY);
  const [rules, setRules] = useState<PayoutRule[]>([]);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [gas90, setGas90] = useState(0);
  const [hasCategory, setHasCategory] = useState(true);
  const [gigIds, setGigIds] = useState<string[]>([]);
  const [showTxns, txnSheet] = useTxnSheet();
  const [editing, setEditing] = useState<Partial<ShiftRow> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    const now = today();
    const from = `${Number(now.slice(0, 4)) - 1}-${now.slice(5, 7)}-01`;
    try {
      const { data: cats } = await supabase.from('categories').select('id, name').or('name.ilike.gig work,name.ilike.gig income');
      const gigIds = (cats ?? []).map((c: any) => c.id);
      setHasCategory(gigIds.length > 0); setGigIds(gigIds);
      const [p, s, st, r, gas, acc] = await Promise.all([
        gigIds.length
          ? supabase.from('transaction_lines').select('date, amount, merchant').in('category_id', gigIds).gte('date', from).gt('amount', 0).limit(5000)
          : Promise.resolve({ data: [], error: null }),
        loadShifts(), loadGigSettings(), loadPayoutRules(),
        supabase.from('transaction_list').select('amount, category_name').ilike('category_name', 'gas').gte('date', addDays(now, -90)).lt('amount', 0).limit(1000),
        supabase.from('account_balances').select('id, name, mask, type, plan_include').eq('is_hidden', false).order('name'),
      ]);
      if (p.error) setError(p.error.message); else setError('');
      setPayouts(((p.data ?? []) as any[]).map((x) => ({ date: x.date, amount: Number(x.amount), text: x.merchant ?? '' })));
      setShifts(s); setSettings(st); setRules(r);
      setAccounts((acc.data ?? []) as AccountLite[]);
      setGas90(-((gas.data ?? []) as any[]).reduce((x, y) => x + Number(y.amount), 0));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); setRefresh((r) => r + 1); }, [load]));
  usePullRefresh(load);

  const now = today();
  const sum = useMemo(() => summarizePayouts(payouts, now, 12, 6), [payouts, now]);
  const km90 = shifts.filter((s) => s.date >= addDays(now, -90)).reduce((x, s) => x + (s.km ?? 0), 0);
  const cpk = costPerKm(settings);
  const lastApps = shifts[0] ? [...new Set(partsOf(shifts[0]).map((p) => p.platform))] : ['doordash'];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Segmented value={view} onChange={setView} options={[{ value: 'earnings', label: 'Earnings' }, { value: 'shifts', label: 'Shifts' }]} />
          </View>
          <Pressable onPress={() => setShowSettings(true)} hitSlop={8} accessibilityLabel="Gig settings" style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }]}>
            <Ionicons name="settings-outline" size={18} color={t.text} />
          </Pressable>
        </View>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {view === 'earnings'
          ? <Earnings refresh={refresh} t={t} sum={sum} target={settings.weekly_target} hasCategory={hasCategory} onSettings={() => setShowSettings(true)}
              onRange={(title, from, to) => showTxns({ title, from, to, categoryIds: gigIds, kind: 'income' })} />
          : <Shifts t={t} shifts={shifts} cpk={cpk} onEdit={setEditing} onSettings={() => setShowSettings(true)} />}
      </ScrollView>
      {view === 'shifts' && (
        <Pressable onPress={() => setEditing({ date: now, parts: lastApps.map((platform) => ({ platform, earnings: 0 })) })} style={[styles.fab, { backgroundColor: t.accent }]} accessibilityLabel="Log a shift">
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}
      {txnSheet}
      {editing && <ShiftForm initial={editing} settings={settings} rules={rules} onClose={() => setEditing(null)} onSaved={load} />}
      {showSettings && (
        <SettingsForm initial={settings} rules={rules} accounts={accounts} suggestedCpk={costPerKmFrom(gas90, km90)} gas90={gas90} km90={km90}
          usedApps={[...new Set([...shifts.flatMap((s) => partsOf(s).map((p) => p.platform)), ...sum.platforms.map((p) => p.key)])]}
          onClose={() => setShowSettings(false)} onSaved={load} />
      )}
    </View>
  );
}

// ───────────────────────── earnings ─────────────────────────
function Earnings({ t, sum, target, hasCategory, onSettings, onRange, refresh }: {
  refresh: number; t: Theme; sum: ReturnType<typeof summarizePayouts>; target: number | null; hasCategory: boolean; onSettings: () => void;
  onRange: (title: string, from: string, to: string) => void;
}) {
  const colorOf = (key: string) => PLATFORM_COLORS[key] ?? t.muted;
  const used = [...new Set(sum.weeks.flatMap((w) => Object.keys(w.byPlatform)).concat(sum.months.flatMap((m) => Object.keys(m.byPlatform))))];
  return (
    <>
      {!hasCategory && <Card><Text style={{ color: t.text }}>Make a category called “Gig work” (Categories in the menu) and put your payouts in it; they show up here.</Text></Card>}
      <PageBoard page="gig" refresh={refresh} defaults={GIG_DEFAULT} blocks={[
        { key: 'gig:tiles', title: 'Payout totals', about: 'This week against your target, last week, this month and this year', render: () => (
          <View style={{ gap: 10 }}>
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
          </View>
        ) },
        { key: 'gig:weeks', title: 'Last 12 weeks', about: 'Weekly payouts by app, with your target line', render: () => (
          <Card style={{ gap: 8 }}>
        <View style={styles.between}>
          <Text style={[styles.h, { color: t.muted }]}>Last 12 weeks</Text>
          <Pressable onPress={onSettings} hitSlop={8}><Text style={{ color: t.accent, fontSize: 12 }}>{target ? 'Change target' : 'Set a weekly target'}</Text></Pressable>
        </View>
          <BarChart t={t} stacked height={150} labels={sum.weeks.map((w) => shortDate(w.week))} format={money0} refLine={target ?? undefined}
            series={used.map((k) => ({ name: platformByKey(k).name, values: sum.weeks.map((w) => w.byPlatform[k] ?? 0) }))} colors={used.map(colorOf)}
            onPick={(i) => onRange(`Gig pay · week of ${shortDate(sum.weeks[i].week)}`, sum.weeks[i].week, addDays(sum.weeks[i].week, 6))} />
        <Text style={{ color: t.muted, fontSize: 12 }}>Average of the last 8 full weeks: {formatMoney(sum.avgWeek)}{target ? ' · the dashed line is your target' : ''}</Text>
      </Card>
        ) },
        { key: 'gig:months', title: 'Payouts by month', about: 'Each month’s payouts by app', render: () => (
          <Card style={{ padding: 0 }}>
        <Text style={[styles.h, { color: t.muted, paddingHorizontal: 12, paddingTop: 10 }]}>By month</Text>
        <View style={[styles.mRow, { borderColor: t.line }]}>
          <Text style={[styles.mCell, { color: t.muted, flex: 1.2, textAlign: 'left' }]}>Month</Text>
          {used.map((k) => <Text key={k} style={[styles.mCell, { color: t.muted }]} numberOfLines={1}>{platformByKey(k).icon}</Text>)}
          <Text style={[styles.mCell, { color: t.muted, fontWeight: '700' }]}>Total</Text>
        </View>
        {[...sum.months].reverse().map((m) => (
          <Pressable key={m.month} style={[styles.mRow, { borderColor: t.line }]} onPress={() => onRange(`Gig pay · ${monthLabel(m.month)}`, `${m.month}-01`, monthEnd(`${m.month}-01`))}>
            <Text style={[styles.mCell, { color: t.text, flex: 1.2, textAlign: 'left' }]}>{monthLabel(m.month)}</Text>
            {used.map((k) => <Text key={k} style={[styles.mCell, { color: t.text }]}>{m.byPlatform[k] ? money0(m.byPlatform[k]) : '–'}</Text>)}
            <Text style={[styles.mCell, { color: t.text, fontWeight: '700' }]}>{money0(m.total)}</Text>
          </Pressable>
        ))}
      </Card>
        ) },
        { key: 'gig:platforms', title: 'This year by app', about: 'Each app’s share of this year’s payouts', render: () => (
          sum.platforms.length > 0 ? (
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
        </Card>) : null
        ) },
      ]} />
    </>
  );
}

// ───────────────────────── shifts ─────────────────────────
function Shifts({ t, shifts, cpk, onEdit, onSettings }: { t: Theme; shifts: ShiftRow[]; cpk: number | null; onEdit: (s: ShiftRow) => void; onSettings: () => void }) {
  const [shown, setShown] = useState(6);
  const weeks = useMemo(() => {
    const m = new Map<string, ShiftRow[]>();
    for (const s of shifts) { const w = weekStart(s.date); (m.get(w) ?? m.set(w, []).get(w)!).push(s); }
    return [...m.entries()];
  }, [shifts]);
  const months = useMemo(() => {
    const m = new Map<string, ShiftRow[]>();
    for (const s of shifts) { const k = s.date.slice(0, 7); (m.get(k) ?? m.set(k, []).get(k)!).push(s); }
    return [...m.entries()].map(([month, list]) => ({ month, ...totalShifts(list, cpk) }));
  }, [shifts, cpk]);
  const recent = shifts.filter((s) => s.date >= addDays(today(), -30));
  const last30 = totalShifts(recent, cpk);
  const byApp = totalsByPlatform(recent);

  return (
    <>
      <Text style={[styles.h, { color: t.muted }]}>Last 30 days</Text>
      <View style={styles.tiles}>
        <Tile t={t} label="Earned" value={money0(last30.earnings)} sub={`${last30.shifts} shift${last30.shifts === 1 ? '' : 's'} · ${formatDuration(last30.minutes)}`} />
        <Tile t={t} label="Per hour" value={last30.perHour != null ? formatMoney(last30.perHour) : '–'} sub="dash time" />
        <Tile t={t} label="Per active hr" value={last30.perActiveHour != null ? formatMoney(last30.perActiveHour) : '–'} sub={`${pct(last30.activeShare)} active`} />
        <Tile t={t} label="Per km" value={last30.perKm != null ? formatMoney(last30.perKm) : '–'} sub={`${Math.round(last30.km)} km`} />
        <Tile t={t} label="After gas" value={money0(last30.net)} sub={cpk ? `≈ ${formatMoney(cpk)}/km gas` : 'set gas in ⚙'} />
      </View>
      {!cpk && <Pressable onPress={onSettings}><Text style={{ color: t.accent, fontSize: 13 }}>Set your fuel efficiency and gas price to see earnings after gas →</Text></Pressable>}

      {byApp.length > 1 && (
        <Card style={{ padding: 0 }}>
          <Text style={[styles.h, { color: t.muted, paddingHorizontal: 12, paddingTop: 10 }]}>By app · last 30 days</Text>
          {byApp.map((a) => (
            <View key={a.platform} style={[styles.mRow, { borderColor: t.line }]}>
              <Text style={{ color: t.text, flex: 1.4 }}>{platformByKey(a.platform).icon} {platformByKey(a.platform).name}</Text>
              <Text style={[styles.mCell, { color: t.text }]}>{money0(a.earnings)}</Text>
              <Text style={[styles.mCell, { color: t.muted }]}>{formatDuration(a.activeMinutes || null)}</Text>
              <Text style={[styles.mCell, { color: t.text }]}>{a.perActiveHour != null ? `${formatMoney(a.perActiveHour)}/h` : '–'}</Text>
              <Text style={[styles.mCell, { color: t.muted }]}>{a.deliveries ? `${a.deliveries} orders` : ''}</Text>
            </View>
          ))}
          <Text style={{ color: t.muted, fontSize: 12, padding: 12, paddingTop: 6 }}>Per active hour counts only the time that app had you on an order.</Text>
        </Card>
      )}

      {!shifts.length && <EmptyState icon="bicycle-outline" title="No shifts yet" text="After a shift, tap + to log its hours, earnings and km. You’ll see what you make per hour and after gas." />}

      {months.length > 1 && (
        <Card style={{ padding: 0 }}>
          <Text style={[styles.h, { color: t.muted, paddingHorizontal: 12, paddingTop: 10 }]}>By month</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={[styles.mRow, { borderColor: t.line }]}>
                {MONTH_COLS.map((c) => <Text key={c.label} style={[styles.tCell, { width: c.w, color: t.muted, fontSize: 12 }, c.left && { textAlign: 'left' }]}>{c.label}</Text>)}
              </View>
              {months.slice(0, 24).map((m) => (
                <View key={m.month} style={[styles.mRow, { borderColor: t.line }]}>
                  {[monthLabel(m.month), String(m.shifts), formatDuration(m.minutes), pct(m.activeShare), money0(m.earnings),
                    m.perHour != null ? m.perHour.toFixed(0) : '–', m.perActiveHour != null ? m.perActiveHour.toFixed(0) : '–',
                    m.perKm != null ? m.perKm.toFixed(2) : '–', money0(m.net)].map((v, i) => (
                    <Text key={i} style={[styles.tCell, { width: MONTH_COLS[i].w, color: t.text }, MONTH_COLS[i].left && { textAlign: 'left' }, i === 8 && { fontWeight: '700' }]}>{v}</Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}

      {weeks.slice(0, shown).map(([w, list]) => {
        const tot = totalShifts(list, cpk);
        return (
          <Card key={w} style={{ padding: 0 }}>
            <View style={[styles.weekHead, { backgroundColor: t.bg, borderColor: t.line }]}>
              <Text style={{ color: t.text, fontWeight: '700', flex: 1 }}>Week of {shortDate(w)}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{formatDuration(tot.minutes)}{tot.perHour != null ? ` · ${formatMoney(tot.perHour)}/h` : ''}  </Text>
              <Text style={{ color: t.text, fontWeight: '700' }}>{money0(tot.earnings)}</Text>
            </View>
            {list.map((s) => <ShiftLine key={s.id} t={t} s={s} cpk={cpk} onPress={() => onEdit(s)} />)}
          </Card>
        );
      })}
      {weeks.length > shown && <Button title={`Show older weeks (${weeks.length - shown} more)`} kind="plain" onPress={() => setShown(shown + 12)} />}
    </>
  );
}

const MONTH_COLS = [
  { label: 'Month', w: 64, left: true }, { label: 'Shifts', w: 44 }, { label: 'Dash time', w: 74 }, { label: 'Active', w: 52 },
  { label: 'Earned', w: 66 }, { label: '$/h', w: 40 }, { label: '$/act h', w: 54 }, { label: '$/km', w: 46 }, { label: 'After gas', w: 72 },
];

function ShiftLine({ t, s, cpk, onPress }: { t: Theme; s: ShiftRow; cpk: number | null; onPress: () => void }) {
  const st = shiftStats(s, cpk);
  const parts = partsOf(s);
  const name = parts.length === 1 ? platformByKey(parts[0].platform).name : parts.map((p) => platformByKey(p.platform).name).join(' + ');
  const line1 = [st.minutes != null && formatDuration(st.minutes), st.activeMinutes != null && `${formatDuration(st.activeMinutes)} active${st.activeShare != null ? ` (${pct(st.activeShare)})` : ''}`,
    s.km && `${s.km} km`, st.deliveries && `${st.deliveries} order${st.deliveries === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const line2 = [st.perHour != null && `${formatMoney(st.perHour)}/h`, st.perActiveHour != null && `${formatMoney(st.perActiveHour)}/active h`, st.perKm != null && `${formatMoney(st.perKm)}/km`].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} style={({ pressed, hovered }: any) => [styles.shift, { borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
      <Text style={{ fontSize: 16, width: 30, textAlign: 'center' }}>{parts.map((p) => platformByKey(p.platform).icon).join('')}</Text>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: t.text }} numberOfLines={1}>{shortDate(s.date)} · {name}{s.start && s.end ? ` · ${s.start}–${s.end}` : ''}</Text>
        {!!line1 && <Text style={{ color: t.muted, fontSize: 12 }}>{line1}</Text>}
        {!!line2 && <Text style={{ color: t.muted, fontSize: 12 }}>{line2}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: t.text, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(st.earnings)}</Text>
        {st.carCost != null && <Text style={{ color: t.muted, fontSize: 12 }}>{formatMoney(st.net)} after gas</Text>}
      </View>
    </Pressable>
  );
}

// ───────────────────────── log a shift ─────────────────────────
interface PartDraft { platform: string; earnings: string; tips: string; h: string; m: string; orders: string; cashed: boolean; fee: string }
const toDraft = (p: ShiftPart): PartDraft => ({
  platform: p.platform, earnings: p.earnings ? String(p.earnings) : '', tips: p.tips != null ? String(p.tips) : '',
  h: p.activeMinutes ? String(Math.floor(p.activeMinutes / 60)) : '', m: p.activeMinutes ? String(p.activeMinutes % 60) : '',
  orders: p.deliveries != null ? String(p.deliveries) : '',
  cashed: !!p.cashedOut, fee: p.cashoutFee != null ? String(p.cashoutFee) : '',
});

function ShiftForm({ initial, settings, rules, onClose, onSaved }: { initial: Partial<ShiftRow>; settings: GigSettings; rules: PayoutRule[]; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [date, setDate] = useState(initial.date ?? today());
  const [start, setStart] = useState(initial.start ?? '');
  const [end, setEnd] = useState(initial.end ?? '');
  const [km, setKm] = useState(initial.km != null ? String(initial.km) : '');
  const [price, setPrice] = useState(String(initial.fuelPrice ?? settings.fuel_price ?? ''));
  const [eff, setEff] = useState(String(initial.fuelEfficiency ?? settings.fuel_efficiency ?? ''));
  const [parts, setParts] = useState<PartDraft[]>((initial.parts?.length ? initial.parts : initial.platform ? partsOf(initial as ShiftRow) : [{ platform: 'doordash', earnings: 0 }]).map(toDraft));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[$,\s]/g, '')));
  const imported = initial.source === 'dash-journey';

  const togglePlatform = (key: string) => setParts((ps) => ps.some((p) => p.platform === key)
    ? (ps.length > 1 ? ps.filter((p) => p.platform !== key) : ps)
    : [...ps, { platform: key, earnings: '', tips: '', h: '', m: '', orders: '', cashed: false, fee: '' }]);
  const setPart = (key: string, patch: Partial<PartDraft>) => setParts((ps) => ps.map((p) => (p.platform === key ? { ...p, ...patch } : p)));
  const toParts = (): ShiftPart[] => parts.map((p) => {
    const mins = (num(p.h) ?? 0) * 60 + (num(p.m) ?? 0);
    return { platform: p.platform, earnings: num(p.earnings) ?? 0, tips: num(p.tips), activeMinutes: mins > 0 ? Math.round(mins) : null, deliveries: num(p.orders),
      cashedOut: p.cashed, cashoutFee: p.cashed ? num(p.fee) ?? rules.find((r) => r.platform === p.platform)?.instantFee ?? 0 : null };
  });

  // Gas: km × L/100 km × $/L. An imported shift that recorded its own gas cost keeps it until you change the inputs.
  const kmN = num(km), effN = num(eff), priceN = num(price);
  const computedFuel = fuelCostFor(kmN, effN, priceN);
  const keepImported = imported && initial.fuelCost != null && kmN === (initial.km ?? null) && !effN;
  const fuelCost = keepImported ? initial.fuelCost! : computedFuel;
  const preview = shiftStats({ date, platform: 'x', earnings: 0, start: start || null, end: end || null, km: kmN, fuelCost, parts: toParts() }, null);

  const save = async () => {
    if (!date) { setError('Pick the date.'); return; }
    if (toParts().every((p) => !p.earnings)) { setError('Fill in what you earned.'); return; }
    setBusy(true);
    try {
      await saveShift(initial.id, {
        date, start_time: start || null, end_time: end || null, km: kmN, notes: notes.trim() || null,
        fuel_price: priceN, fuel_efficiency: effN, fuel_cost: fuelCost,
        ...(keepImported ? {} : { fuel_litres: kmN && effN ? Math.round(kmN * effN) / 100 : null }),
      }, toParts());
      // Remember the gas price and efficiency for the next shift.
      if ((priceN && priceN !== settings.fuel_price) || (effN && effN !== settings.fuel_efficiency)) {
        await supabase.from('gig_settings').upsert({ ...(priceN ? { fuel_price: priceN } : {}), ...(effN ? { fuel_efficiency: effN } : {}), updated_at: new Date().toISOString() });
      }
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    const error = await deleteWithUndo('gig_shifts', initial.id!, 'Shift deleted', { table: 'gig_shift_parts', key: 'shift_id' });
    if (error) setError(error); else { onSaved(); onClose(); }
  };

  return (
    <Sheet title={initial.id ? 'Edit shift' : 'Log a shift'} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {initial.id ? <Button title="Delete" kind="danger" onPress={remove} /> : null}
        <Button title="Save" onPress={save} busy={busy} style={{ flex: 1 }} />
      </View>}>
      <Field t={t} label="Apps on this shift" hint="Pick every app you had on. Time, km and gas are shared; earnings, active time and orders are per app.">
        <View style={styles.chips}>
          {[...GIG_PLATFORMS, platformByKey('other')].map((p) => <Chip key={p.key} label={`${p.icon} ${p.name}`} on={parts.some((x) => x.platform === p.key)} onPress={() => togglePlatform(p.key)} />)}
        </View>
      </Field>
      <Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field>
      <View style={styles.row2}>
        <View style={{ flex: 1 }}><Field t={t} label="Start"><TimeField value={start} onChange={setStart} placeholder="17:30" /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="End"><TimeField value={end} onChange={setEnd} placeholder="21:00" /></Field></View>
      </View>

      {parts.map((p) => {
        const pl = platformByKey(p.platform);
        return (
          <View key={p.platform} style={[styles.part, { borderColor: t.line, backgroundColor: t.card }]}>
            <Text style={{ color: t.text, fontWeight: '700' }}>{pl.icon}  {pl.name}</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><Field t={t} label="Earned $ (incl. tips)"><TextInput value={p.earnings} onChangeText={(v) => setPart(p.platform, { earnings: v })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} /></Field></View>
              <View style={{ flex: 1 }}><Field t={t} label="Tips $ (part of it)"><TextInput value={p.tips} onChangeText={(v) => setPart(p.platform, { tips: v })} keyboardType="decimal-pad" placeholder="optional" placeholderTextColor={t.muted} style={input} /></Field></View>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><Field t={t} label="Active hours"><TextInput value={p.h} onChangeText={(v) => setPart(p.platform, { h: v })} keyboardType="number-pad" placeholder="0" placeholderTextColor={t.muted} style={input} /></Field></View>
              <View style={{ flex: 1 }}><Field t={t} label="+ minutes"><TextInput value={p.m} onChangeText={(v) => setPart(p.platform, { m: v })} keyboardType="number-pad" placeholder="0" placeholderTextColor={t.muted} style={input} /></Field></View>
              <View style={{ flex: 1 }}><Field t={t} label="Orders"><TextInput value={p.orders} onChangeText={(v) => setPart(p.platform, { orders: v })} keyboardType="number-pad" placeholder="0" placeholderTextColor={t.muted} style={input} /></Field></View>
            </View>
            {rules.find((r) => r.platform === p.platform)?.mode !== 'instant' && (
              <View style={[styles.between, { gap: 10 }]}>
                <Text style={{ color: t.text, flex: 1 }}>Cashed out early (instant pay)</Text>
                {p.cashed && <TextInput value={p.fee} onChangeText={(v) => setPart(p.platform, { fee: v })} keyboardType="decimal-pad"
                  placeholder={`fee $${(rules.find((r) => r.platform === p.platform)?.instantFee ?? 0).toFixed(2)}`} placeholderTextColor={t.muted} style={[input, { width: 110 }]} />}
                <Switch value={p.cashed} onValueChange={(v) => setPart(p.platform, { cashed: v })} />
              </View>
            )}
          </View>
        );
      })}

      <View style={styles.row2}>
        <View style={{ flex: 1 }}><Field t={t} label="Km driven"><TextInput value={km} onChangeText={setKm} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Gas price $/L"><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="1.65" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="L/100 km"><TextInput value={eff} onChangeText={setEff} keyboardType="decimal-pad" placeholder="10.5" placeholderTextColor={t.muted} style={input} /></Field></View>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        {fuelCost != null
          ? `Gas ≈ ${kmN && effN ? `${(kmN * effN / 100).toFixed(1)} L · ` : ''}${formatMoney(fuelCost)}${keepImported ? ' (from your sheet)' : ''}`
          : 'Fill in km, gas price ($ per litre) and your car’s L/100 km to work out the gas cost. Price and L/100 km are remembered.'}
      </Text>
      <Field t={t} label="Notes"><TextInput value={notes} onChangeText={setNotes} placeholder="zone, weather, promos…" placeholderTextColor={t.muted} style={input} /></Field>
      <Text style={{ color: t.text, fontSize: 13 }}>
        {[preview.minutes != null && `${formatDuration(preview.minutes)} dash`, preview.activeMinutes != null && `${formatDuration(preview.activeMinutes)} active (${pct(preview.activeShare)})`,
          preview.perHour != null && `${formatMoney(preview.perHour)}/h`, preview.perActiveHour != null && `${formatMoney(preview.perActiveHour)}/active h`,
          preview.perKm != null && `${formatMoney(preview.perKm)}/km`, preview.carCost != null && `${formatMoney(preview.net)} after gas`].filter(Boolean).join(' · ')}
      </Text>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

// ───────────────────────── settings ─────────────────────────
interface RuleDraft { mode: PayoutRule['mode']; weekday: number; fee: string; accountId: string | null }

function SettingsForm({ initial, rules, accounts, usedApps, suggestedCpk, gas90, km90, onClose, onSaved }: {
  initial: GigSettings; rules: PayoutRule[]; accounts: AccountLite[]; usedApps: string[]; suggestedCpk: number | null; gas90: number; km90: number;
  onClose: () => void; onSaved: () => void;
}) {
  const t = useTheme();
  const [target, setTarget] = useState(initial.weekly_target != null ? String(initial.weekly_target) : '');
  const [eff, setEff] = useState(initial.fuel_efficiency != null ? String(initial.fuel_efficiency) : '');
  const [price, setPrice] = useState(initial.fuel_price != null ? String(initial.fuel_price) : '');
  const [cpk, setCpk] = useState(initial.cost_per_km != null ? String(initial.cost_per_km) : '');
  const [planAhead, setPlanAhead] = useState(initial.plan_ahead);
  const [excludeGas, setExcludeGas] = useState(initial.exclude_gig_gas);
  const apps = usedApps.length ? usedApps.filter((a) => a !== 'other') : GIG_PLATFORMS.map((p) => p.key);
  const defaultAccount = accounts.find((a) => a.plan_include)?.id ?? null;
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>(() => Object.fromEntries(apps.map((a) => {
    const r = rules.find((x) => x.platform === a);
    return [a, { mode: r?.mode ?? 'off', weekday: r?.weekday ?? 0, fee: r ? String(r.instantFee || '') : '', accountId: r?.accountId ?? defaultAccount }];
  })));
  const [error, setError] = useState('');
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const n = (s: string) => (s.trim() ? Number(s.replace(/[$,\s]/g, '')) : null);
  const derived = n(eff) && n(price) ? (n(eff)! / 100) * n(price)! : null;
  const setDraft = (a: string, patch: Partial<RuleDraft>) => setDrafts((d) => ({ ...d, [a]: { ...d[a], ...patch } }));
  const payAccounts = accounts.filter((a) => a.type === 'depository');

  const save = async () => {
    const s = await supabase.from('gig_settings').upsert({
      weekly_target: n(target), fuel_efficiency: n(eff), fuel_price: n(price), plan_ahead: planAhead, exclude_gig_gas: excludeGas,
      cost_per_km: derived != null ? Math.round(derived * 1000) / 1000 : n(cpk), updated_at: new Date().toISOString(),
    });
    if (s.error) { setError(s.error.message); return; }
    const r = await supabase.from('gig_platforms').upsert(Object.entries(drafts).map(([platform, d]) => ({
      platform, payout_mode: d.mode, payout_weekday: d.weekday, instant_fee: n(d.fee) ?? 0, account_id: d.accountId,
    })), { onConflict: 'user_id,platform' });
    if (r.error) { setError(r.error.message); return; }
    onSaved(); onClose();
  };

  return (
    <Sheet title="Gig settings" onClose={onClose} footer={<Button title="Save" onPress={save} />}>
      <Field t={t} label="Weekly earnings target"><TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="e.g. 600" placeholderTextColor={t.muted} style={input} /></Field>

      <Text style={[styles.h, { color: t.muted }]}>Gas</Text>
      <View style={styles.row2}>
        <View style={{ flex: 1 }}><Field t={t} label="Fuel efficiency L/100 km"><TextInput value={eff} onChangeText={setEff} keyboardType="decimal-pad" placeholder="e.g. 11.9" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Usual gas price $/L"><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="e.g. 1.65" placeholderTextColor={t.muted} style={input} /></Field></View>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        {derived != null ? `That's about ${formatMoney(derived)} of gas per km. ` : ''}Each new shift starts with these; change the price on a shift when you fill up.
      </Text>
      {derived == null && (
        <Field t={t} label="…or a flat cost per km">
          <TextInput value={cpk} onChangeText={setCpk} keyboardType="decimal-pad" placeholder="e.g. 0.17" placeholderTextColor={t.muted} style={input} />
          {suggestedCpk != null && <Pressable onPress={() => setCpk(String(suggestedCpk))}><Text style={{ color: t.accent, fontSize: 12 }}>Use {formatMoney(suggestedCpk)}/km: {formatMoney(gas90)} of gas ÷ {Math.round(km90)} km in the last 90 days</Text></Pressable>}
        </Field>
      )}

      <View style={styles.between}>
        <Text style={{ color: t.text, flex: 1 }}>Take gig gas out of my Gas spending (the Budget tab counts it as a work cost instead)</Text>
        <Switch value={excludeGas} onValueChange={setExcludeGas} />
      </View>

      <Text style={[styles.h, { color: t.muted }]}>Payouts in the planner</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Weekly: the week's logged earnings (Monday to Sunday) show as income on the day it usually lands the week after; a shift marked “cashed out early” shows that day instead, less its fee. Instant: each shift's pay shows that day, less the fee. The real deposit replaces it when it posts.
      </Text>
      {apps.map((a) => {
        const p = platformByKey(a); const d = drafts[a];
        return (
          <View key={a} style={[styles.part, { borderColor: t.line, backgroundColor: t.card }]}>
            <Text style={{ color: t.text, fontWeight: '700' }}>{p.icon}  {p.name}</Text>
            <Segmented value={d.mode} onChange={(v) => setDraft(a, { mode: v })}
              options={[{ value: 'off', label: 'Not planned' }, { value: 'weekly', label: 'Weekly' }, { value: 'instant', label: 'Instant' }]} />
            {d.mode === 'weekly' && (
              <Field t={t} label="Lands in the bank on">
                <View style={styles.chips}>{DAYS.map((day, i) => <Chip key={day} label={day} on={d.weekday === i} onPress={() => setDraft(a, { weekday: i })} />)}</View>
              </Field>
            )}
            {d.mode !== 'off' && (
              <Field t={t} label={d.mode === 'instant' ? 'Fee per cash-out $' : 'Fee when you cash out early $'}><TextInput value={d.fee} onChangeText={(v) => setDraft(a, { fee: v })} keyboardType="decimal-pad" placeholder="e.g. 1.99" placeholderTextColor={t.muted} style={input} /></Field>
            )}
            {d.mode !== 'off' && (
              <Field t={t} label="Paid into">
                <View style={styles.chips}>
                  {payAccounts.map((acc) => <Chip key={acc.id} label={`${acc.name}${acc.mask ? ` ••${acc.mask}` : ''}`} on={d.accountId === acc.id} onPress={() => setDraft(a, { accountId: acc.id })} />)}
                </View>
              </Field>
            )}
          </View>
        );
      })}
      <View style={styles.between}>
        <Text style={{ color: t.text, flex: 1 }}>Plan ahead with my weekly average (until this week’s shifts are logged)</Text>
        <Switch value={planAhead} onValueChange={setPlanAhead} />
      </View>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}


const monthLabel = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const PLATFORM_COLORS: Record<string, string> = { doordash: '#e5533d', uber: '#3987e5', instacart: '#43a047', skip: '#f29f05', lyft: '#d63fa3', 'naan-kabob': '#8e6bd6', other: '#8a8a84' };
const CHART_H = 150;

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
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
  iconBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  part: { gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  tCell: { textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'], paddingRight: 6 },
  fab: { position: 'absolute', right: 20, bottom: 92, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
