// Widgets for Home and the Budget tab (NAV-2 groundwork, VIEW-2/4/6/8/9). Each one loads its own
// data, so a screen only pays for the widgets it shows. Which ones show, and in what order, is
// kept per user (user_prefs) and changed with the WidgetPicker.
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDays, addMonths, expandPlan, formatDuration, formatMoney, monthEnd, shortDate, totalShifts, weekStart, type Month,
} from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { useTxnSheet } from '@/components/TxnSheet';
import { Bar, Button, Segmented } from '@/components/ui';
import { costPerKm, loadGigSettings, loadShifts } from '@/lib/gig';
import { loadAccounts, loadEntries, loadRecurring, today } from '@/lib/plan';
import { savePrefs } from '@/lib/prefs';
import { loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth } from '@/lib/reports';
import { useTheme, type Theme } from '@/lib/theme';
import { signedBalance, type Account } from '@/lib/types';
import { loadWatch, type Watched } from '@/lib/watch';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export interface WidgetDef { key: string; title: string; about: string; home: boolean; budget: boolean }
export const WIDGETS: WidgetDef[] = [
  { key: 'review', title: 'To review', about: 'New transactions waiting to be checked', home: true, budget: false },
  { key: 'week', title: 'This week', about: 'Cash now, projected end of week, what’s next', home: true, budget: false },
  { key: 'budget', title: 'Budget pace', about: 'This month’s spending against an even pace', home: true, budget: false },
  { key: 'networth', title: 'Net worth', about: 'Assets minus debts, and the change this month', home: true, budget: false },
  { key: 'cash', title: 'Cash position', about: 'Cash, card debt, and what’s left after paying the cards', home: true, budget: true },
  { key: 'runway', title: 'Cash runway', about: 'How many days your cash lasts at your usual daily spending', home: true, budget: true },
  { key: 'avgspend', title: 'Average spending', about: 'Monthly average over 3, 6 or 12 months vs this month', home: true, budget: true },
  { key: 'watch', title: 'Spending watch', about: 'Your watch-list categories against their average', home: true, budget: true },
  { key: 'credit', title: 'Credit cards', about: 'Card debt, utilisation and the next due date', home: true, budget: true },
  { key: 'gig', title: 'Gig work this week', about: 'Earnings, hours and $/hour so far this week', home: true, budget: true },
  { key: 'calendar', title: 'Bills calendar', about: 'This month’s bills and income on a calendar', home: true, budget: true },
  { key: 'nwtypes', title: 'Net worth by type', about: 'Cash, cards, loans and investments', home: true, budget: false },
  { key: 'groups', title: 'Spending by group', about: 'This month by category group, with last month beside it', home: true, budget: true },
];
export const DEFAULT_HOME = ['review', 'week', 'budget', 'networth'];
export const DEFAULT_BUDGET: string[] = [];

/** `after` renders outside the pressable card (pop-ups opened from inside it, so their taps don't reach the card). */
export function CardShell({ t, title, link, onPress, children, after }: { t: Theme; title: string; link?: string; onPress?: () => void; children: ReactNode; after?: ReactNode }) {
  return (
    <>
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: t.card, borderColor: t.line, opacity: pressed && onPress ? 0.85 : 1 }]}>
      <View style={styles.between}>
        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>{title.toUpperCase()}</Text>
        {link && <Text style={{ color: t.accent, fontSize: 12 }}>{link} ›</Text>}
      </View>
      {children}
    </Pressable>
    {after}
    </>
  );
}

export function Mini({ t, label, value, sub, color }: { t: Theme; label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={[styles.mini, { borderColor: color ?? t.line, backgroundColor: color ? color + '12' : 'transparent' }]}>
      <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: color ?? t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

/** Loads once per mount; shows a quiet placeholder while loading and the error if it fails. */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; fn().then((d) => live && setData(d)).catch((e) => live && setError(e instanceof Error ? e.message : String(e))); return () => { live = false; }; }, deps);
  return { data, error };
}

/** One of the self-loading widgets by key (the four Home cards are drawn by Home itself). */
export function Widget({ k, refresh = 0 }: { k: string; refresh?: number }) {
  const t = useTheme();
  switch (k) {
    case 'cash': return <CashPosition t={t} refresh={refresh} />;
    case 'runway': return <Runway t={t} refresh={refresh} />;
    case 'avgspend': return <AvgSpending t={t} refresh={refresh} />;
    case 'watch': return <WatchMini t={t} refresh={refresh} />;
    case 'credit': return <CreditMini t={t} refresh={refresh} />;
    case 'gig': return <GigWeek t={t} refresh={refresh} />;
    case 'calendar': return <BillsCalendar t={t} refresh={refresh} />;
    case 'nwtypes': return <NetWorthByType t={t} refresh={refresh} />;
    case 'groups': return <SpendingByGroup t={t} refresh={refresh} />;
    default: return null;
  }
}

const isCash = (a: Account) => a.type === 'depository' && !a.is_hidden;
const owed = (a: Account) => Math.max(0, -signedBalance(a));

function CashPosition({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(loadAccounts, [refresh]);
  if (!data) return <CardShell t={t} title="Cash position"><Text style={{ color: t.muted }}>Loading…</Text></CardShell>;
  const cash = data.filter(isCash).reduce((s, a) => s + signedBalance(a), 0);
  const cards = data.filter((a) => a.type === 'credit' && !a.is_hidden).reduce((s, a) => s + owed(a), 0);
  const left = cash - cards;
  return (
    <CardShell t={t} title="Cash position" link="Accounts" onPress={() => router.navigate('/accounts')}>
      <View style={styles.tiles}>
        <Mini t={t} label="Cash" value={money0(cash)} sub="chequing + savings" />
        <Mini t={t} label="Card debt" value={money0(cards)} />
        <Mini t={t} label="After cards" value={`${left < 0 ? '−' : ''}${money0(Math.abs(left))}`} color={left < 0 ? t.danger : t.accent} />
      </View>
    </CardShell>
  );
}

function Runway({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(async () => {
    const [accts, months] = await Promise.all([loadAccounts(), loadMonthSummaries(addMonths(thisMonth(), -3), addDays(thisMonth(), -1))]);
    const days = months.reduce((s, m) => s + Number(monthEnd(m.month).slice(8, 10)), 0);
    const spend = months.reduce((s, m) => s + Math.abs(m.spending), 0);
    return { cash: accts.filter(isCash).reduce((s, a) => s + signedBalance(a), 0), daily: days ? spend / days : 0 };
  }, [refresh]);
  if (!data) return <CardShell t={t} title="Cash runway"><Text style={{ color: t.muted }}>Loading…</Text></CardShell>;
  const runway = data.daily > 0 ? data.cash / data.daily : null;
  const color = runway == null ? t.muted : runway < 14 ? t.danger : runway < 30 ? t.series2 : t.accent;
  return (
    <CardShell t={t} title="Cash runway">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ color, fontSize: 26, fontWeight: '700' }}>{runway == null ? '–' : runway < 1 ? '< 1' : Math.floor(runway)}</Text>
        <Text style={{ color: t.muted }}>days of cash at {money0(data.daily)}/day</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 11 }}>{money0(data.cash)} in chequing and savings ÷ your average daily spending over the last 3 months. Income isn’t counted.</Text>
    </CardShell>
  );
}

function AvgSpending({ t, refresh }: { t: Theme; refresh: number }) {
  const [span, setSpan] = useState<'3' | '6' | '12'>('3');
  const { data } = useLoad(() => loadMonthSummaries(addMonths(thisMonth(), -12), monthEnd(thisMonth())), [refresh]);
  const [showTxns, txnSheet] = useTxnSheet();
  if (!data) return <CardShell t={t} title="Average spending"><Text style={{ color: t.muted }}>Loading…</Text></CardShell>;
  const cur = thisMonth();
  const full = data.filter((m) => m.month < cur).sort((a, b) => b.month.localeCompare(a.month)).slice(0, Number(span));
  const avg = full.length ? full.reduce((s, m) => s + Math.abs(m.spending), 0) / full.length : 0;
  const now = data.find((m) => m.month === cur);
  const spent = Math.abs(now?.spending ?? 0);
  const day = Number(today().slice(8, 10)), daysIn = Number(monthEnd(cur).slice(8, 10));
  const projected = spent + (avg / daysIn) * (daysIn - day); // so far + the usual for the days left
  const color = projected > avg * 1.05 ? t.series2 : t.accent;
  return (
    <CardShell t={t} after={txnSheet} title="Average spending" link="Reports" onPress={() => router.push('/reports')}>
      <Segmented value={span} onChange={setSpan} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }]} />
      <View style={styles.tiles}>
        <Mini t={t} label={`Average · ${full.length} mo`} value={money0(avg)} sub="per month" />
        <Pressable style={{ flex: 1 }} onPress={() => showTxns({ title: 'Spending this month', from: cur, to: monthEnd(cur), kind: 'expense' })}>
          <Mini t={t} label="This month" value={money0(spent)} sub={`heading for ${money0(projected)}`} color={color} />
        </Pressable>
      </View>
      <Bar value={projected} max={Math.max(avg, projected)} color={color} />
    </CardShell>
  );
}

function WatchMini({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(() => loadWatch(today()), [refresh]);
  const [showTxns, txnSheet] = useTxnSheet();
  const m = thisMonth();
  const list: Watched[] = data ? [...data.list].sort((a, b) => (b.projected - b.avg3) - (a.projected - a.avg3)).slice(0, 4) : [];
  return (
    <CardShell t={t} after={txnSheet} title="Spending watch" link="Watch list" onPress={() => router.push('/watch' as any)}>
      {!data ? <Text style={{ color: t.muted }}>Loading…</Text> : !list.length ? <Text style={{ color: t.muted }}>Pick categories on the watch list.</Text> : list.map((w) => {
        const up = w.projected > w.avg3;
        return (
          <Pressable key={w.category.id} style={styles.row} onPress={() => showTxns({ title: `${w.category.name} · this month`, from: m, to: monthEnd(m), categoryIds: [w.category.id], noTransfers: true })}>
            <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{w.category.name}</Text>
            <Text style={{ color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{money0(w.thisMonth)} → {money0(w.projected)}</Text>
            <Text style={{ color: up ? t.series2 : t.accent, fontSize: 12, fontWeight: '700', width: 64, textAlign: 'right' }}>{up ? '▲' : '▼'} {money0(Math.abs(w.projected - w.avg3))}</Text>
          </Pressable>
        );
      })}
      <Text style={{ color: t.muted, fontSize: 11 }}>This month so far → where it’s heading, vs the 3-month average.</Text>
    </CardShell>
  );
}

function CreditMini({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(loadAccounts, [refresh]);
  if (!data) return <CardShell t={t} title="Credit cards"><Text style={{ color: t.muted }}>Loading…</Text></CardShell>;
  const cards = data.filter((a) => a.type === 'credit' && !a.is_hidden);
  const total = cards.reduce((s, a) => s + owed(a), 0);
  const lim = cards.filter((a) => a.credit_limit);
  const limit = lim.reduce((s, a) => s + Number(a.credit_limit), 0);
  const u = limit ? lim.reduce((s, a) => s + owed(a), 0) / limit : null;
  const now = today();
  const dueDate = (a: Account) => {
    const d = new Date(now + 'T00:00:00Z'); const day = a.due_day!;
    let c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day));
    if (c.toISOString().slice(0, 10) < now) c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day));
    return c.toISOString().slice(0, 10);
  };
  const next = cards.filter((a) => a.due_day && owed(a) > 0).map((a) => ({ a, due: dueDate(a) })).sort((x, y) => x.due.localeCompare(y.due))[0];
  const color = u == null ? undefined : u > 0.7 ? t.danger : u > 0.3 ? t.series2 : t.accent;
  return (
    <CardShell t={t} title="Credit cards" link="Credit" onPress={() => router.push('/credit' as any)}>
      <View style={styles.tiles}>
        <Mini t={t} label="Owing" value={money0(total)} sub={`${cards.length} cards`} />
        <Mini t={t} label="Utilisation" value={u == null ? '–' : `${Math.round(u * 100)}%`} sub={limit ? `of ${money0(limit)}` : 'add limits'} color={color} />
        <Mini t={t} label="Next due" value={next ? shortDate(next.due) : '–'} sub={next ? next.a.name : ''} />
      </View>
    </CardShell>
  );
}

function GigWeek({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(async () => {
    const w = weekStart(today());
    const [shifts, settings] = await Promise.all([loadShifts(w), loadGigSettings()]);
    return { tot: totalShifts(shifts, costPerKm(settings)), target: settings.weekly_target };
  }, [refresh]);
  if (!data) return <CardShell t={t} title="Gig work this week"><Text style={{ color: t.muted }}>Loading…</Text></CardShell>;
  const { tot, target } = data;
  return (
    <CardShell t={t} title="Gig work this week" link="Gig work" onPress={() => router.push('/gig' as any)}>
      <View style={styles.tiles}>
        <Mini t={t} label="Earned" value={money0(tot.earnings)} sub={target ? `of ${money0(target)}` : `${tot.shifts} shifts`} color={target ? (tot.earnings >= target ? t.accent : t.series2) : undefined} />
        <Mini t={t} label="Time" value={formatDuration(tot.minutes)} sub={tot.activeShare != null ? `${Math.round(tot.activeShare * 100)}% active` : ''} />
        <Mini t={t} label="Per hour" value={tot.perHour != null ? formatMoney(tot.perHour) : '–'} sub={tot.perActiveHour != null ? `${formatMoney(tot.perActiveHour)}/active h` : ''} />
      </View>
      {!!target && <Bar value={tot.earnings} max={target} color={tot.earnings >= target ? t.accent : t.series2} />}
    </CardShell>
  );
}

function BillsCalendar({ t, refresh }: { t: Theme; refresh: number }) {
  const month: Month = thisMonth();
  const end = monthEnd(month);
  const [showTxns, txnSheet] = useTxnSheet();
  const { data } = useLoad(async () => {
    const [rec, ent] = await Promise.all([loadRecurring(), loadEntries(addDays(month, -31), addDays(end, 31))]);
    return expandPlan(rec, ent, month, end).filter((p) => !p.transfer);
  }, [refresh]);
  const now = today();
  const first = new Date(month + 'T00:00:00Z');
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = Number(end.slice(8, 10));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const byDay = new Map<number, number[]>();
  for (const p of data ?? []) { const d = Number(p.date.slice(8, 10)); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(p.amount); }
  const out = (data ?? []).filter((p) => p.amount < 0).reduce((s, p) => s + p.amount, 0);
  const inn = (data ?? []).filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0);
  return (
    <CardShell t={t} after={txnSheet} title={`Bills · ${new Date(month + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' })}`} link="Bills" onPress={() => router.push('/bills')}>
      <View style={styles.calHead}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={i} style={[styles.calCell, { color: t.muted, fontSize: 10 }]}>{d}</Text>)}</View>
      <View style={styles.calGrid}>
        {cells.map((d, i) => {
          const amounts = d ? byDay.get(d) ?? [] : [];
          const o = amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
          const n = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
          const isToday = d && `${month.slice(0, 8)}${String(d).padStart(2, '0')}` === now;
          return (
            <Pressable key={i} disabled={!d} onPress={() => { const day = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`; showTxns({ title: `${shortDate(day)}`, from: day, to: day, noTransfers: true }); }}
              style={[styles.calCell, styles.calBox, { borderColor: isToday ? t.accent : 'transparent' }]}>
              {d ? <Text style={{ color: t.muted, fontSize: 10 }}>{d}</Text> : null}
              {o ? <Text style={{ color: t.danger, fontSize: 9, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{money0(-o).replace('$', '')}</Text> : null}
              {n ? <Text style={{ color: t.positive, fontSize: 9, fontVariant: ['tabular-nums'] }} numberOfLines={1}>+{money0(n).replace('$', '')}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>Bills {money0(-out)} · income {money0(inn)} this month · tap a day for what posted</Text>
    </CardShell>
  );
}

function NetWorthByType({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(loadAccounts, [refresh]);
  if (!data) return <CardShell t={t} title="Net worth by type"><Text style={{ color: t.muted }}>Loading…</Text></CardShell>;
  const vis = data.filter((a) => !a.is_hidden);
  const groups = [
    { label: 'Cash', v: vis.filter((a) => a.type === 'depository').reduce((s, a) => s + signedBalance(a), 0) },
    { label: 'Investments', v: vis.filter((a) => a.type === 'investment').reduce((s, a) => s + signedBalance(a), 0) },
    { label: 'Credit cards', v: vis.filter((a) => a.type === 'credit').reduce((s, a) => s + signedBalance(a), 0) },
    { label: 'Loans', v: vis.filter((a) => a.type === 'loan').reduce((s, a) => s + signedBalance(a), 0) },
  ].filter((g) => g.v);
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.v)));
  return (
    <CardShell t={t} title="Net worth by type" link="Accounts" onPress={() => router.navigate('/accounts')}>
      {groups.map((g) => (
        <View key={g.label} style={{ gap: 3 }}>
          <View style={styles.between}>
            <Text style={{ color: t.text, fontSize: 13 }}>{g.label}</Text>
            <Text style={{ color: g.v < 0 ? t.danger : t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{formatMoney(g.v)}</Text>
          </View>
          <Bar value={Math.abs(g.v)} max={max} color={g.v < 0 ? t.danger : t.accent} height={5} />
        </View>
      ))}
    </CardShell>
  );
}

function SpendingByGroup({ t, refresh }: { t: Theme; refresh: number }) {
  const [showTxns, txnSheet] = useTxnSheet();
  const cur = thisMonth(), last = addMonths(cur, -1);
  const { data } = useLoad(async () => {
    const [cats, rows] = await Promise.all([loadCategories(), loadCategoryMonths(last, cur)]);
    const m = new Map<string, { now: number; prev: number }>();
    for (const r of rows) {
      if (r.kind !== 'expense') continue;
      const g = cats.find((c) => c.id === r.category_id)?.group ?? 'Uncategorised';
      const e = m.get(g) ?? m.set(g, { now: 0, prev: 0 }).get(g)!;
      if (r.month === cur) e.now -= r.total; else e.prev -= r.total;
    }
    return [...m.entries()].map(([group, v]) => ({ group, ...v })).filter((x) => x.now > 0.5 || x.prev > 0.5).sort((a, b) => b.now - a.now);
  }, [refresh]);
  const max = Math.max(1, ...(data ?? []).flatMap((g) => [g.now, g.prev]));
  return (
    <CardShell t={t} after={txnSheet} title="Spending by group" link="Reports" onPress={() => router.push('/reports')}>
      {!data ? <Text style={{ color: t.muted }}>Loading…</Text> : data.slice(0, 10).map((g) => (
        <Pressable key={g.group} style={{ gap: 3 }} onPress={() => showTxns({ title: `${g.group} · this month`, from: cur, to: monthEnd(cur), group: g.group, kind: 'expense' })}>
          <View style={styles.between}>
            <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{g.group}</Text>
            <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{money0(g.now)} <Text style={{ color: t.muted }}>· last {money0(g.prev)}</Text></Text>
          </View>
          <Bar value={g.now} max={max} color={t.series1} height={5} />
        </Pressable>
      ))}
    </CardShell>
  );
}

const HOME_ONLY = ['review', 'week', 'budget', 'networth'];

/**
 * Choose which widgets a screen shows and their order. Home and Budget save to your prefs; a
 * Reports tab passes `save` (and a name field as `header`, plus `onDelete`).
 */
export function WidgetPicker({ place, current, onClose, onSaved, save: saveFn, title, header, onDelete }: {
  place: 'home' | 'budget' | 'report'; current: string[]; onClose: () => void; onSaved: (keys: string[]) => void;
  save?: (keys: string[]) => Promise<void>; title?: string; header?: ReactNode; onDelete?: () => void;
}) {
  const t = useTheme();
  const avail = place === 'report' ? WIDGETS.filter((w) => !HOME_ONLY.includes(w.key)) : WIDGETS.filter((w) => w[place]);
  const [on, setOn] = useState<string[]>(current.filter((k) => avail.some((w) => w.key === k)));
  const [error, setError] = useState('');
  const order = [...on, ...avail.map((w) => w.key).filter((k) => !on.includes(k))];
  const move = (k: string, d: -1 | 1) => setOn((list) => {
    const i = list.indexOf(k), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const save = async () => {
    try {
      if (saveFn) await saveFn(on);
      else await savePrefs(place === 'home' ? { home_widgets: on } : { budget_widgets: on });
      onSaved(on); onClose();
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Sheet title={title ?? (place === 'home' ? 'Home widgets' : 'Budget widgets')} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {onDelete ? <Button title="Delete tab" kind="danger" onPress={onDelete} /> : null}
        <Button title="Save" onPress={save} style={{ flex: 1 }} />
      </View>}>
      {header}
      <Text style={{ color: t.muted, fontSize: 13 }}>Turn widgets on or off; arrows change the order.{place === 'budget' ? ' They show above your budget.' : ''}</Text>
      {order.map((k) => {
        const w = avail.find((x) => x.key === k)!; const active = on.includes(k);
        return (
          <View key={k} style={[styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: active ? t.text : t.muted, fontWeight: '600' }}>{w.title}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{w.about}</Text>
            </View>
            {active && (
              <>
                <Pressable onPress={() => move(k, -1)} hitSlop={6} accessibilityLabel={`Move ${w.title} up`}><Ionicons name="chevron-up" size={20} color={t.accent} /></Pressable>
                <Pressable onPress={() => move(k, 1)} hitSlop={6} accessibilityLabel={`Move ${w.title} down`}><Ionicons name="chevron-down" size={20} color={t.accent} /></Pressable>
              </>
            )}
            <Switch value={active} onValueChange={(v) => setOn((list) => (v ? [...list, k] : list.filter((x) => x !== k)))} />
          </View>
        );
      })}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  mini: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  calHead: { flexDirection: 'row' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, alignItems: 'center' },
  calBox: { minHeight: 38, paddingVertical: 2, borderWidth: 1, borderRadius: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
});
