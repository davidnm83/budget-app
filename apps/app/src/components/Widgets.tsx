// Widgets for Home and the Budget tab (NAV-2 groundwork, VIEW-2/4/6/8/9). Each one loads its own
// data, so a screen only pays for the widgets it shows. Which ones show, and in what order, is
// kept per user (user_prefs) and changed with the WidgetPicker.
import Ionicons from '@expo/vector-icons/Ionicons';
export { Tile, Tile as Mini } from '@/components/Tile';
import { Tile as Mini } from '@/components/Tile';
import {
  RADAR_CHECKS, RADAR_LIMITS, type RadarSettings,
  addDays, addMonths, balanceHistory, categoryIcon, expandPlan, loanSummary, formatMoney, monthEnd, shortDate, weekStart, type Month,
} from '@budget-app/core';
import { router } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { BalanceChart } from '@/components/AccountSheet';
import { Skeleton } from '@/components/Columns';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { MultiPicker } from '@/components/Picker';
import { loadTxnsFor } from '@/lib/accountTxns';
import { supabase } from '@/lib/supabase';
import { useTxnSheet } from '@/components/TxnSheet';
import { Bar, Button, Chip, LIFT, Segmented } from '@/components/ui';
import { loadAccounts, loadEntries, loadRecurring, today } from '@/lib/plan';
import { loadPrefs, savePrefs } from '@/lib/prefs';
import { loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, type Category } from '@/lib/reports';
import { PRESS, RISE } from '@/lib/motion';
import { useWide } from '@/lib/layout';
import { useTheme, type Theme } from '@/lib/theme';
import { accountGroup, byAccountGroup, signedBalance, type Account } from '@/lib/types';
import { loadWatch, type Watched } from '@/lib/watch';
import { dismissRadar, loadRadar, restoreRadar } from '@/lib/radar';
import { toast } from '@/lib/toast';
import { BarChart, Donut, LineChart, plotChrome } from '@/components/Charts';
import { cfgCategories, loadChart, NO_ACCOUNTS, pickAccounts, SOURCES, SPLITS, SPLIT_LABEL, VIEW_LABEL, type ChartCfg, type ChartData, type ChartView, type Source, type SplitBy } from '@/lib/widgetData';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export interface WidgetDef { key: string; title: string; about: string; home: boolean; budget: boolean; config?: 'spend' | 'chart' | 'text';
  /** Has a chart or a list, so it can be short, medium or tall. */
  sizable?: boolean;
  /** Numbers, a list or a note: as tall as its content unless a size is chosen, then that size, scrolling inside. */
  fits?: boolean }

/** A placed widget is its key, or `key::{json settings}` for the ones with settings of their own (VIEW-15). */
export interface WidgetCfg extends ChartCfg { title?: string; chart?: Chart;
  /** Text widgets: the note itself, and whether it sits in a card or straight on the page. */
  text?: string; plain?: boolean;
  /** Chart widgets: false hides the numbers above a bar or line chart. */
  numbers?: boolean;
  /** Pie: false hides the legend (the ring takes the space; tap a slice for its amount). */
  legend?: boolean;
  /** Chart widgets: what to show and how. */
  view?: ChartView;
  /** Layout: width on wide screens, and chart height. */
  w?: 'half' | 'full'; h?: 's' | 'm' | 'l';
  /** Radar: checks switched off and thresholds changed. */
  radar?: RadarSettings }
/** How a Category spending widget draws: monthly bars, a pie of the categories, or a ranked list. */
export type Chart = 'bars' | 'pie' | 'list';
/**
 * Widgets that used to be their own thing and are now a chart with settings. A layout saved with
 * the old name keeps working: it is read as the matching chart (and saved that way when edited).
 */
const LEGACY: Record<string, WidgetCfg> = {
  nwtypes: { source: 'networth', by: 'type', view: 'list', months: 6, title: 'Net worth by type' },
  avgspend: { source: 'spending', view: 'tiles', months: 3, title: 'Average spending' },
  groups: { source: 'spending', by: 'group', view: 'list', months: 1, title: 'Spending by group' },
  credit: { source: 'carddebt', view: 'tiles', months: 6, title: 'Credit cards' },
  account: { source: 'balance', view: 'line', months: 12, payoff: true },
};
export function parseEntry(e: string): [string, WidgetCfg] {
  const i = e.indexOf('::');
  const key = i < 0 ? e : e.slice(0, i);
  let cfg: WidgetCfg = {};
  if (i >= 0) { try { cfg = JSON.parse(e.slice(i + 2)); } catch { cfg = {}; } }
  return LEGACY[key] ? ['chart', { ...LEGACY[key], ...cfg }] : [key, cfg];
}
/** The widget an entry belongs to ('spend' is the older name for a spending chart). */
export const keyOf = (e: string) => { const k = parseEntry(e)[0]; return k === 'spend' ? 'chart' : k; };
export const makeEntry = (key: string, cfg: WidgetCfg) => `${key}::${JSON.stringify(cfg)}`;
export const WIDGETS: WidgetDef[] = [
  { key: 'radar', title: 'Radar', about: 'What needs attention: a balance about to dip, a late or changed bill, a budget running over, unusual spending', home: true, budget: false, fits: true },
  { key: 'review', title: 'To review', about: 'New transactions waiting to be checked', home: true, budget: false, fits: true },
  { key: 'week', title: 'This week', about: 'Cash now, projected end of week, what’s next', home: true, budget: false, fits: true },
  { key: 'budget', title: 'Budget pace', about: 'This month’s spending against an even pace', home: true, budget: false, fits: true },
  { key: 'networth', title: 'Net worth', about: 'Assets minus debts, and the change this month', home: true, budget: false, fits: true },
  { key: 'cash', title: 'Cash position', about: 'Cash, card debt, and what’s left after paying the cards', home: true, budget: true, fits: true },
  { key: 'runway', title: 'Cash runway', about: 'How many days your cash lasts at your usual daily spending', home: true, budget: true, fits: true },
  { key: 'watch', title: 'Spending watch', about: 'Your watch-list categories against their average', home: true, budget: true, sizable: true },
  { key: 'calendar', title: 'Bills calendar', about: 'This month’s bills and income on a calendar', home: true, budget: true, fits: true },
  { key: 'text', title: 'Text', about: 'A heading and a note of your own: what a page is for, a reminder, a goal', home: true, budget: true, config: 'text', fits: true },
  { key: 'chart', title: 'Chart', about: 'Spending, money in and out, net worth, card debt or an account, for the accounts and categories you choose', home: true, budget: true, config: 'chart', sizable: true },
  { key: 'tags', title: 'Tag totals', about: 'Everything under each tag added up: a trip, a move, a repair', home: true, budget: true, sizable: true },
];
export const DEFAULT_HOME = ['radar', 'review', 'week', 'budget', 'networth'];
export const DEFAULT_BUDGET: string[] = [];

/** `after` renders outside the pressable card (pop-ups opened from inside it, so their taps don't reach the card). */
const HOVER: any = { transform: [{ translateY: -2 }], boxShadow: '0 6px 18px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)' };

/**
 * The height chosen for a widget whose content has no chart to stretch (numbers, a list, a note):
 * undefined = as tall as its content; otherwise its body is that size and scrolls when there's more.
 */
export const FitHeight = createContext<WidgetCfg['h'] | undefined>(undefined);
/** A fixed-height body that scrolls, for FitHeight. */
function Scrolled({ h, children }: { h?: WidgetCfg['h']; children: ReactNode }) {
  if (!h) return <>{children}</>;
  return <ScrollView style={{ height: BODY[h], flexGrow: 0 }} contentContainerStyle={{ gap: 10 }} nestedScrollEnabled showsVerticalScrollIndicator>{children}</ScrollView>;
}

/** A title you gave a widget in its settings; the card shows it in place of its own. */
export const TitleOverride = createContext<string | undefined>(undefined);

export function CardShell({ t, title: own, link, onPress, children, after }: { t: Theme; title: string; link?: string; onPress?: () => void; children: ReactNode; after?: ReactNode }) {
  const title = useContext(TitleOverride) ?? own;
  const h = useContext(FitHeight);
  return (
    <>
    <Pressable onPress={onPress} style={({ pressed, hovered }: any) => [styles.card, LIFT, RISE, PRESS, { backgroundColor: t.card, borderColor: t.line }, hovered && onPress ? HOVER : null, pressed && onPress ? { transform: [{ scale: 0.985 }] } : null]}>
      <View style={styles.between}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{title.toUpperCase()}</Text>
        {link && <Text style={{ color: t.accent, fontSize: 12 }}>{link} ›</Text>}
      </View>
      <Scrolled h={h}>{children}</Scrolled>
    </Pressable>
    {after}
    </>
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
/** `anchor`: the month the page is showing; widgets that can follow it do (charts, bills calendar, spending by group). */
export function Widget(props: { k: string; refresh?: number; anchor?: Month; range?: { from: string; to: string } }) {
  const [k, cfg] = parseEntry(props.k);
  // Charts and accounts use their title themselves; for the rest it replaces the card's heading.
  const own = k === 'chart' || k === 'spend' || k === 'text';
  return <TitleOverride.Provider value={own ? undefined : cfg.title || undefined}><WidgetBody {...props} /></TitleOverride.Provider>;
}

function WidgetBody({ k: entry, refresh = 0, anchor, range }: { k: string; refresh?: number; anchor?: Month; range?: { from: string; to: string } }) {
  const t = useTheme();
  const [k, cfg] = parseEntry(entry);
  switch (k) {
    case 'spend': return <ChartWidget t={t} refresh={refresh} cfg={{ source: 'spending', ...cfg }} anchor={anchor} range={range} />; // the older name for a spending chart
    case 'chart': return <ChartWidget t={t} refresh={refresh} cfg={cfg} anchor={anchor} range={range} />;
    case 'text': return <TextNote t={t} cfg={cfg} />;
    case 'tags': return <TagTotals t={t} refresh={refresh} h={cfg.h} />;
    case 'radar': return <Radar t={t} refresh={refresh} settings={cfg.radar} />;
    case 'cash': return <CashPosition t={t} refresh={refresh} />;
    case 'runway': return <Runway t={t} refresh={refresh} />;
    case 'watch': return <WatchMini t={t} refresh={refresh} h={cfg.h} />;
    case 'calendar': return <BillsCalendar t={t} refresh={refresh} anchor={anchor} />;
    default: return null;
  }
}

/**
 * Heights. A widget that can be Short, Medium or Tall has a body (everything under its title) of
 * exactly this height, whatever it draws: bars, a line, a pie, a list, a table or numbers, with or
 * without the figures on top. So two widgets set to the same size are the same height, and
 * changing what a widget shows never changes how tall it is. What's inside fits itself to the
 * space: a chart's plot takes what is left, a list shows the rows there is room for.
 */
export const BODY = { s: 150, m: 250, l: 370 } as const;
const GAP = 10;

/** The fixed-height body of a sizable widget. */
function Sized({ h, children }: { h?: WidgetCfg['h']; children: ReactNode }) {
  return <View style={{ height: BODY[h ?? 'm'], gap: GAP, overflow: 'hidden' }}>{children}</View>;
}
/** The part of a sized body that takes whatever height the fixed parts leave, and tells its content how much that is. */
function Fill({ children }: { children: (height: number, width: number) => ReactNode }) {
  const [box, setBox] = useState<{ h: number; w: number } | null>(null);
  return (
    <View style={{ flex: 1, minHeight: 0, overflow: 'hidden', gap: GAP }} onLayout={(e) => { const { height, width } = e.nativeEvent.layout; setBox((b) => (b && Math.abs(b.h - height) < 1 && Math.abs(b.w - width) < 1 ? b : { h: height, w: width })); }}>
      {box ? children(box.h, box.w) : null}
    </View>
  );
}
/** How many rows of `rowHeight` (with the usual gap between) fit in `height`; never fewer than one. */
const fit = (height: number, rowHeight: number, gap: number = GAP) => Math.max(1, Math.floor((height + gap) / (rowHeight + gap)));

/** Any chart widget: a source of data drawn as bars, a line, a pie, a ranked list, a table or plain numbers. */
function ChartWidget({ t, refresh, cfg, anchor, range }: { t: Theme; refresh: number; cfg: WidgetCfg; anchor?: Month; range?: { from: string; to: string } }) {
  const [showTxns, txnSheet] = useTxnSheet();
  const wide = useWide(); // phones have room for two figures above a chart, wide screens for three
  const source: Source = cfg.source ?? 'spending';
  const allowed = SOURCES[source].views;
  const want: ChartView = cfg.view ?? cfg.chart ?? allowed[0];
  const view = allowed.includes(want) ? want : allowed[0];
  const { data, error } = useLoad(() => loadChart(cfg, anchor, range), [refresh, JSON.stringify(cfg), anchor, range?.from, range?.to]);
  const title = cfg.title || cfg.group || data?.title || SOURCES[source].title;
  if (!data) return <CardShell t={t} title={title}><Sized h={cfg.h}>{error ? <Text style={{ color: t.danger }}>{error}</Text> : <Skeleton color={t.track} />}</Sized></CardShell>;
  const open = (i: number) => { const q = data.drill?.(i); if (q) showTxns({ title: `${title} · ${data.labels[i]}`, ...q }); };
  const openPart = (b: ChartData['breakdown'][number]) => (b.query ? () => showTxns({ title: `${b.label} · ${data.period}`, from: data.from, to: data.to, ...b.query }) : undefined);
  const fmt = data.percent ? (v: number) => `${Math.round(v)}%` : money0;
  const tone = data.outline ? (data.outline.good ? t.accent : t.series2) : undefined;
  const legend = !data.stacked || data.series.length <= 4;
  const period = <Text style={{ color: t.muted, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>{data.period}</Text>;
  return (
    <CardShell t={t} after={txnSheet} title={title}>
      <Sized h={cfg.h}>
        {data.empty ? <Text style={{ color: t.muted }}>{data.empty}</Text>
          : view === 'tiles' ? <><Fill>{() => <View style={styles.tiles}>{data.tiles.map((x) => <Mini key={x.label} t={t} label={x.label} value={x.value} sub={x.sub} />)}</View>}</Fill>{period}</>
          : view === 'pie' ? (
            <Fill>{(h, w) => <Donut t={t} slices={data.breakdown.map((b) => ({ label: b.label, value: b.value, onPress: openPart(b) }))} format={fmt} note={data.period}
              width={w} height={h} legend={cfg.legend !== false} />}</Fill>
          ) : view === 'list' ? (
            <>
              <Fill>{(h) => (data.breakdown.length ? data.breakdown.slice(0, fit(h, 25)).map((b) => (
                <Pressable key={b.label} style={{ gap: 3, height: 25 }} onPress={openPart(b)} disabled={!b.query}>
                  <View style={styles.between}>
                    <Text style={{ color: t.text, fontSize: 13, lineHeight: 17, flex: 1 }} numberOfLines={1}>{b.label}</Text>
                    <Text style={{ color: t.text, fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'] }}>{fmt(b.value)}</Text>
                  </View>
                  <Bar value={Math.abs(b.value)} max={Math.max(...data.breakdown.map((x) => Math.abs(x.value)))} color={b.value < 0 ? t.series2 : t.series[0]} height={5} />
                </Pressable>
              )) : <Text style={{ color: t.muted }}>Nothing to show {data.period}.</Text>)}</Fill>
              {period}
            </>
          ) : view === 'table' ? (
            <Fill>{(h) => (
              <View>
                <View style={[styles.trow, { borderColor: t.line }]}>
                  <Text style={{ color: t.muted, fontSize: 12, flex: 1 }}> </Text>
                  {data.series.map((x) => <Text key={x.name} style={[styles.tcell, { color: t.muted, fontSize: 12 }]} numberOfLines={1}>{x.name}</Text>)}
                </View>
                {data.labels.map((l, i) => ({ l, i })).slice(-Math.max(1, fit(h, 30, 0) - 1)).reverse().map(({ l, i }) => (
                  <Pressable key={i} onPress={() => open(i)} style={[styles.trow, { borderColor: t.line, height: 30 }]}>
                    <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{l}</Text>
                    {data.series.map((x) => <Text key={x.name} style={[styles.tcell, { color: t.text, fontSize: 13 }]} numberOfLines={1}>{fmt(x.values[i] ?? 0)}</Text>)}
                  </Pressable>
                ))}
              </View>
            )}</Fill>
          ) : (
            <>
              {!!data.note && <Text style={{ color: t.muted, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>{data.note}</Text>}
              {cfg.h !== 's' && cfg.numbers !== false && <View style={[styles.tiles, { flexWrap: 'nowrap' }]}>{data.tiles.slice(0, wide ? 3 : 2).map((x) => <Mini key={x.label} t={t} label={x.label} value={x.value} sub={x.sub} />)}</View>}
              <Fill>{(h) => {
                const plot = Math.max(48, Math.floor(h - plotChrome(data.series.length, legend)));
                return view === 'line'
                  ? <LineChart t={t} labels={data.labels} series={data.series} height={plot} format={fmt} refLine={data.refLine} onPick={data.drill ? open : undefined} />
                  : <BarChart t={t} labels={data.labels} series={data.series} height={plot} format={fmt} refLine={data.refLine} onPick={data.drill ? open : undefined}
                      stacked={data.stacked} legend={legend}
                      barColor={data.outline && !data.stacked ? (i) => (i === data.outline!.i ? tone : undefined) : undefined}
                      outline={data.outline ? { i: data.outline.i, value: data.outline.value, color: tone! } : undefined} />;
              }}</Fill>
            </>
          )}
      </Sized>
    </CardShell>
  );
}

const monthShort = (m: string) => new Date(m + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });

const isCash = (a: Account) => a.type === 'depository' && !a.is_hidden;
const owed = (a: Account) => Math.max(0, -signedBalance(a));

/** What needs attention right now, most urgent first. Each line opens the page behind it; × hides it until the facts change. */
function Radar({ t, refresh, settings }: { t: Theme; refresh: number; settings?: RadarSettings }) {
  const [again, setAgain] = useState(0);
  const [all, setAll] = useState(false);
  const { data, error } = useLoad(() => loadRadar(settings), [refresh, again, JSON.stringify(settings ?? {})]);
  if (error) return <CardShell t={t} title="Radar"><Text style={{ color: t.muted, fontSize: 13 }}>{error}</Text></CardShell>;
  if (!data) return <CardShell t={t} title="Radar"><Skeleton color={t.track} /></CardShell>;
  const LOOK = { act: { icon: 'alert-circle', color: t.danger }, heads: { icon: 'warning', color: t.series2 }, info: { icon: 'information-circle', color: t.muted } } as const;
  const shown = all ? data.cards : data.cards.slice(0, 4);
  const hide = async (id: string) => {
    try { await dismissRadar(id, data.ids); setAgain((n) => n + 1); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
  };
  const bringBack = async () => { try { await restoreRadar(); setAgain((n) => n + 1); } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); } };
  return (
    <CardShell t={t} title="Radar">
      {!data.cards.length && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="checkmark-circle" size={20} color={t.accent} />
          <Text style={{ color: t.text, fontSize: 15 }}>Nothing needs attention</Text>
        </View>
      )}
      {shown.map((c, i) => (
        <Pressable key={c.id} onPress={() => router.navigate(c.href as any)} accessibilityRole="link"
          style={({ pressed, hovered }: any) => [{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: t.line }, (pressed || hovered) && { opacity: 0.75 }]}>
          <Ionicons name={LOOK[c.severity].icon} size={18} color={LOOK[c.severity].color} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{c.title}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{c.text}</Text>
          </View>
          <Pressable onPress={(e: any) => { e?.stopPropagation?.(); hide(c.id); }} hitSlop={10} accessibilityLabel={`Dismiss: ${c.title}`}><Ionicons name="close" size={16} color={t.muted} /></Pressable>
        </Pressable>
      ))}
      {(data.cards.length > 4 || data.hidden > 0) && (
        <View style={styles.between}>
          {data.cards.length > 4 ? <Pressable onPress={() => setAll(!all)} hitSlop={8}><Text style={{ color: t.accent, fontSize: 12 }}>{all ? 'Show fewer' : `${data.cards.length - 4} more`}</Text></Pressable> : <View />}
          {data.hidden > 0 && <Pressable onPress={bringBack} hitSlop={8}><Text style={{ color: t.muted, fontSize: 12 }}>{data.hidden} dismissed · show again</Text></Pressable>}
        </View>
      )}
    </CardShell>
  );
}

function CashPosition({ t, refresh }: { t: Theme; refresh: number }) {
  const { data } = useLoad(loadAccounts, [refresh]);
  if (!data) return <CardShell t={t} title="Cash position"><Skeleton color={t.track} /></CardShell>;
  const cash = data.filter(isCash).reduce((s, a) => s + signedBalance(a), 0);
  const cards = data.filter((a) => a.type === 'credit' && !a.is_hidden).reduce((s, a) => s + owed(a), 0);
  const left = cash - cards;
  return (
    <CardShell t={t} title="Cash position" link="Accounts" onPress={() => router.navigate('/accounts')}>
      <View style={styles.tiles}>
        <Mini t={t} label="Cash" value={money0(cash)} sub="checking + savings" />
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
  if (!data) return <CardShell t={t} title="Cash runway"><Skeleton color={t.track} /></CardShell>;
  const runway = data.daily > 0 ? data.cash / data.daily : null;
  const color = runway == null ? t.muted : runway < 14 ? t.danger : runway < 30 ? t.series2 : t.accent;
  return (
    <CardShell t={t} title="Cash runway">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ color, fontSize: 26, fontWeight: '700' }}>{runway == null ? '–' : runway < 1 ? '< 1' : Math.floor(runway)}</Text>
        <Text style={{ color: t.muted }}>days of cash at {money0(data.daily)}/day</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>{money0(data.cash)} in checking and savings ÷ your average daily spending over the last 3 months. Income isn’t counted.</Text>
    </CardShell>
  );
}

/** Your own words on a page. Lines starting with "- " become a list; a blank line starts a new paragraph. */
function TextNote({ t, cfg }: { t: Theme; cfg: WidgetCfg }) {
  const h = useContext(FitHeight);
  const lines = (cfg.text ?? '').split('\n');
  const body = (
    <View style={{ gap: 4 }}>
      {!!cfg.title && <Text style={{ color: t.text, fontSize: cfg.plain ? 18 : 15, fontWeight: '700' }}>{cfg.title}</Text>}
      {!cfg.title && !cfg.text?.trim() && <Text style={{ color: t.muted }}>Empty note. Use Edit layout, then the gear, to write it.</Text>}
      {lines.map((l, i) => (l.trim() === '' ? <View key={i} style={{ height: 6 }} />
        : /^\s*[-•]\s+/.test(l) ? <View key={i} style={{ flexDirection: 'row', gap: 8 }}><Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>•</Text><Text style={{ color: t.text, fontSize: 14, lineHeight: 20, flex: 1 }}>{l.replace(/^\s*[-•]\s+/, '')}</Text></View>
        : <Text key={i} style={{ color: t.text, fontSize: 14, lineHeight: 20 }}>{l}</Text>))}
    </View>
  );
  return cfg.plain ? <View style={{ paddingHorizontal: 4, paddingVertical: 6 }}><Scrolled h={h}>{body}</Scrolled></View> : <View style={[styles.card, LIFT, { backgroundColor: t.card, borderColor: t.line }]}><Scrolled h={h}>{body}</Scrolled></View>;
}

// IDEA-14: each tag as a project total. Transfers between your accounts are left out.
function TagTotals({ t, refresh, h }: { t: Theme; refresh: number; h?: WidgetCfg['h'] }) {
  const [showTxns, txnSheet] = useTxnSheet();
  const { data } = useLoad(async () => {
    const by = new Map<string, { tag: string; n: number; total: number; first: string; last: string; ids: string[] }>();
    for (let p = 0; p < 5; p++) {
      const { data: rows, error } = await supabase.from('transactions').select('id, date, amount, tags, is_transfer').neq('tags', '{}').order('date', { ascending: false }).range(p * 1000, p * 1000 + 999);
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as { id: string; date: string; amount: number; tags: string[]; is_transfer: boolean }[]) {
        if (r.is_transfer) continue;
        for (const tag of r.tags ?? []) {
          const x = by.get(tag) ?? { tag, n: 0, total: 0, first: r.date, last: r.date, ids: [] };
          x.n++; x.total += Number(r.amount); x.ids.push(r.id);
          if (r.date < x.first) x.first = r.date;
          if (r.date > x.last) x.last = r.date;
          by.set(tag, x);
        }
      }
      if (!rows || rows.length < 1000) break;
    }
    return [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [refresh]);
  const list = data ?? [];
  const span = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}${a.slice(0, 4) !== b.slice(0, 4) || b.slice(0, 4) !== today().slice(0, 4) ? ` ${b.slice(0, 4)}` : ''}`);
  return (
    <CardShell t={t} after={txnSheet} title="Tag totals">
      <Sized h={h}>
      {!data ? <Skeleton color={t.track} /> : !list.length ? <Text style={{ color: t.muted }}>Add a tag to a few transactions (a trip, a move, a repair) and its total shows up here.</Text> : <Fill>{(room) => list.slice(0, fit(room, 32)).map((x) => (
        <Pressable key={x.tag} style={[styles.row, { height: 32 }]} onPress={() => showTxns({ title: `#${x.tag}`, from: x.first, to: x.last, ids: x.ids })}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 13 }} numberOfLines={1}>#{x.tag}</Text>
            <Text style={{ color: t.muted, fontSize: 11 }} numberOfLines={1}>{x.n} {x.n === 1 ? 'transaction' : 'transactions'} · {span(x.first, x.last)}</Text>
          </View>
          <Text style={{ color: x.total > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'], fontWeight: '600' }}>{formatMoney(x.total)}</Text>
        </Pressable>
      ))}</Fill>}
      </Sized>
    </CardShell>
  );
}

function WatchMini({ t, refresh, h }: { t: Theme; refresh: number; h?: WidgetCfg['h'] }) {
  const { data } = useLoad(() => loadWatch(today()), [refresh]);
  const [showTxns, txnSheet] = useTxnSheet();
  const m = thisMonth();
  const list: Watched[] = data ? [...data.list].sort((a, b) => (b.projected - b.avg3) - (a.projected - a.avg3)) : [];
  return (
    <CardShell t={t} after={txnSheet} title="Spending watch" link="Watch list" onPress={() => router.push('/reports?tab=watch' as any)}>
      <Sized h={h}>
      {!data ? <Skeleton color={t.track} /> : !list.length ? <Text style={{ color: t.muted }}>Pick categories on the watch list.</Text> : <Fill>{(room) => list.slice(0, fit(room, 18)).map((w) => {
        const up = w.projected > w.avg3;
        return (
          <Pressable key={w.category.id} style={[styles.row, { height: 18 }]} onPress={() => showTxns({ title: `${w.category.name} · this month`, from: m, to: monthEnd(m), categoryIds: [w.category.id], noTransfers: true })}>
            <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{w.category.name}</Text>
            <Text style={{ color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{money0(w.thisMonth)} → {money0(w.projected)}</Text>
            <Text style={{ color: up ? t.series2 : t.accent, fontSize: 12, fontWeight: '700', width: 64, textAlign: 'right' }}>{up ? '▲' : '▼'} {money0(Math.abs(w.projected - w.avg3))}</Text>
          </Pressable>
        );
      })}</Fill>}
      <Text style={{ color: t.muted, fontSize: 12, lineHeight: 16 }} numberOfLines={2}>This month so far → where it’s heading, vs the 3-month average.</Text>
      </Sized>
    </CardShell>
  );
}

function BillsCalendar({ t, refresh, anchor }: { t: Theme; refresh: number; anchor?: Month }) {
  const month: Month = anchor ?? thisMonth();
  const end = monthEnd(month);
  const [showTxns, txnSheet] = useTxnSheet();
  const { data } = useLoad(async () => {
    const [rec, ent] = await Promise.all([loadRecurring(), loadEntries(addDays(month, -31), addDays(end, 31))]);
    return expandPlan(rec, ent, month, end).filter((p) => !p.transfer);
  }, [refresh, month]);
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
    <CardShell t={t} after={txnSheet} title={`Bills · ${new Date(month + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' })}`} link="Bills" onPress={() => router.navigate({ pathname: '/planner', params: { view: 'bills' } } as any)}>
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
              {o ? <Text style={{ color: t.danger, fontSize: 9, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{money0(-o).replace(/^(-?)[^\d]+/, '$1')}</Text> : null}
              {n ? <Text style={{ color: t.positive, fontSize: 9, fontVariant: ['tabular-nums'] }} numberOfLines={1}>+{money0(n).replace(/^[^\d]+/, '')}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>Bills {money0(-out)} · income {money0(inn)} this month · tap a day for what posted</Text>
    </CardShell>
  );
}

export function entryLabel(e: string): string {
  const [k, c] = parseEntry(e);
  const w = WIDGETS.find((x) => x.key === keyOf(e));
  if (!w) return k;
  if (!w.config) return c.title ? `${c.title} (${w.title})` : w.title;
  if (w.config === 'text') return `Text: ${c.title || (c.text ?? '').split('\n')[0].slice(0, 30) || 'empty'}`;
  const src = SOURCES[c.source ?? 'spending'];
  const view = c.view ?? c.chart ?? src.views[0];
  return `${c.title || c.group || src.title} · ${VIEW_LABEL[view].toLowerCase()}`;
}

/** Ready-made charts: each fills in the settings below, which can then be changed. */
export const PRESETS: { name: string; cfg: WidgetCfg }[] = [
  { name: 'Spending', cfg: { source: 'spending', view: 'bars', months: 6 } },
  { name: 'Spending by category', cfg: { source: 'spending', view: 'pie', months: 1 } },
  { name: 'Spending by group', cfg: { source: 'spending', by: 'group', view: 'list', months: 1 } },
  { name: 'Average spending', cfg: { source: 'spending', view: 'tiles', months: 3 } },
  { name: 'Money in and out', cfg: { source: 'cashflow', view: 'bars', months: 12 } },
  { name: 'Net worth', cfg: { source: 'networth', view: 'line', months: 12 } },
  { name: 'Net worth by type', cfg: { source: 'networth', by: 'type', view: 'list', months: 6 } },
  { name: 'Credit cards', cfg: { source: 'carddebt', view: 'tiles', months: 6 } },
  { name: 'Account balance', cfg: { source: 'balance', view: 'line', months: 12 } },
  { name: 'Watch a category', cfg: { source: 'spending', view: 'bars', months: 6, pace: true } },
  { name: 'Spending, stacked by category', cfg: { source: 'spending', view: 'bars', months: 6, stack: true } },
  { name: 'This period vs the one before', cfg: { source: 'spending', view: 'bars', months: 6, compare: true } },
  { name: 'Income', cfg: { source: 'income', view: 'bars', months: 12 } },
  { name: 'Savings rate', cfg: { source: 'savings', view: 'bars', months: 12 } },
  { name: 'Card utilisation', cfg: { source: 'utilization', view: 'line', months: 12 } },
];

/** Settings for one widget. Charts: what to show, for which accounts and categories, and how it's drawn. */
export function WidgetSettings({ kind, cfg, onDone, onClose, widget }: { kind: 'spend' | 'chart' | 'basic' | 'text'; widget?: string; cfg: WidgetCfg; onDone: (c: WidgetCfg) => void; onClose: () => void }) {
  const t = useTheme();
  const chart = kind === 'chart' || kind === 'spend';
  const def = WIDGETS.find((w) => w.key === widget);
  const [watch, setWatch] = useState<string[] | null>(null);
  const [pickWatch, setPickWatch] = useState(false);
  useEffect(() => { if (widget === 'watch') loadPrefs().then((p) => setWatch(p.watch_categories ?? [])).catch(() => setWatch([])); }, [widget]);
  const [title, setTitle] = useState(cfg.title ?? '');
  const [months, setMonths] = useState(cfg.months ?? 6);
  const [source, setSource] = useState<Source>(cfg.source ?? 'spending');
  const [view, setView] = useState<ChartView>(cfg.view ?? cfg.chart ?? 'bars');
  const [ids, setIds] = useState<string[] | null>(cfg.categoryIds ?? null);
  const [accs, setAccs] = useState<string[] | null>(cfg.accountIds ?? null);
  const [by, setBy] = useState<SplitBy | undefined>(cfg.by);
  const [avgLine, setAvgLine] = useState(!!cfg.avg);
  const [numbers, setNumbers] = useState(cfg.numbers !== false);
  const [legend, setLegend] = useState(cfg.legend !== false);
  const [payoff, setPayoff] = useState(cfg.payoff !== false);
  const [stack, setStack] = useState(!!cfg.stack);
  const [compare, setCompare] = useState(!!cfg.compare);
  const [pace, setPace] = useState(!!cfg.pace);
  const [text, setText] = useState(cfg.text ?? '');
  const [plain, setPlain] = useState(!!cfg.plain);
  const [radar, setRadar] = useState<RadarSettings>(cfg.radar ?? {});
  const changed = useChanged([title, months, source, view, ids, accs, by, avgLine, numbers, legend, payoff, stack, compare, pace, text, plain, radar]);
  const radarNum = (k: 'unusualPct' | 'unusualMin' | 'cardPct' | 'runwayDays', v: string) => setRadar((r) => { const n = Number(v); const { [k]: _old, ...rest } = r; return v.trim() && isFinite(n) && n >= 0 ? { ...rest, [k]: n } : rest; });
  const [pick, setPick] = useState(false);
  const [pickAcc, setPickAcc] = useState(false);
  const { data } = useLoad(async () => {
    const [cats, accounts] = await Promise.all([loadCategories(), loadAccounts()]);
    return { cats: cats.filter((c) => c.kind !== 'transfer' && !c.hidden), accounts: accounts.filter((a) => !a.is_hidden) };
  });
  // A template's group or names, or an older single-account setting, become a real selection the first time it's opened here.
  const selected = ids ?? (data ? cfgCategories(cfg, data.cats).map((c) => c.id) : []);
  const pool = data ? (source === 'carddebt' ? data.accounts.filter((a) => a.type === 'credit') : data.accounts) : [];
  const chosen = (accs ?? (data ? pickAccounts(cfg, data.accounts).map((a) => a.id) : [])).filter((id) => pool.some((a) => a.id === id));
  const views = SOURCES[source].views;
  const shown = views.includes(view) ? view : views[0];
  const splits = (SPLITS[source] ?? []);
  const split = by && splits.includes(by) ? by : splits[0];
  const drawn = shown === 'bars' || shown === 'line';
  const catSource = source === 'spending' || source === 'income';
  const canStack = drawn && catSource;
  const canCompare = drawn && source !== 'cashflow';
  const canPace = shown === 'bars' && source === 'spending' && months > 1;
  const oneLoan = source === 'balance' && chosen.length === 1 && pool.find((a) => a.id === chosen[0])?.type === 'loan';
  const preset = (p: typeof PRESETS[number]) => {
    setSource(p.cfg.source!); setView(p.cfg.view!); setMonths(p.cfg.months ?? 6); setBy(p.cfg.by); setAvgLine(false);
    setStack(!!p.cfg.stack); setCompare(!!p.cfg.compare); setPace(!!p.cfg.pace);
    if (!p.cfg.pace) setIds([]);
    if (!title.trim() || PRESETS.some((x) => x.name === title.trim())) setTitle(p.name);
  };
  const input = { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15, color: t.text, borderColor: t.line, backgroundColor: t.card };
  const keep = { w: cfg.w, h: cfg.h };
  const done = () => onDone(kind === 'basic'
    ? { ...keep, title: title.trim() || undefined, ...(widget === 'radar' && (radar.off?.length || Object.keys(radar).some((k) => k !== 'off')) ? { radar: { ...radar, off: radar.off?.length ? radar.off : undefined } } : {}) }
    : kind === 'text' ? { ...keep, title: title.trim() || undefined, text: text.trim() || undefined, ...(plain ? { plain: true } : {}) }
    : {
      ...keep, title: title.trim() || undefined, source, view: shown, months,
      ...(catSource && selected.length ? { categoryIds: selected } : {}),
      ...(canStack && stack ? { stack: true } : {}),
      ...(canCompare && compare && !(canStack && stack) ? { compare: true } : {}),
      ...(canPace && pace ? { pace: true } : {}),
      ...(chosen.length ? { accountIds: chosen } : {}),
      ...(splits.length > 1 && split !== splits[0] ? { by: split } : {}),
      ...(avgLine && drawn ? { avg: true } : {}),
      ...(numbers ? {} : { numbers: false }),
      ...(shown === 'pie' && !legend ? { legend: false } : {}),
      ...(oneLoan && !payoff ? { payoff: false } : {}),
    });
  const chips = { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } as const;
  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={set} />
    </View>
  );
  return (
    <Sheet title={kind === 'basic' ? def?.title ?? 'Widget' : kind === 'text' ? 'Text' : 'Chart'} dirty={changed} onClose={onClose} footer={<Button title="Done" onPress={done} />}>
      {kind === 'text' ? (
        <>
          <Field t={t} label="Text" hint="Start a line with a dash for a list. Leave a line empty for a new paragraph.">
            <TextInput value={text} onChangeText={setText} multiline placeholder="Write anything: what this page is for, a goal, a reminder" placeholderTextColor={t.muted} style={[input, { minHeight: 120, textAlignVertical: 'top' }]} />
          </Field>
          {toggle('No card behind it (sits on the page like a heading)', plain, setPlain)}
        </>
      ) : chart ? (
        <>
          <Field t={t} label="Start from" hint="A ready-made chart. Everything below can still be changed.">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {PRESETS.map((p) => <Chip key={p.name} label={p.name} on={false} onPress={() => preset(p)} />)}
            </ScrollView>
          </Field>
          <Field t={t} label="Show" hint={SOURCES[source].about}>
            <View style={chips}>
              {(Object.keys(SOURCES) as Source[]).map((k) => <Chip key={k} label={SOURCES[k].title} on={source === k} onPress={() => setSource(k)} />)}
            </View>
          </Field>
          <Field t={t} label="As">
            <View style={chips}>
              {views.map((v) => <Chip key={v} label={VIEW_LABEL[v]} on={shown === v} onPress={() => setView(v)} />)}
            </View>
          </Field>
          <Field t={t} label="Over">
            <View style={chips}>{[1, 3, 6, 12, 24].map((m) => <Chip key={m} label={m === 1 ? 'This month' : `${m} months`} on={months === m} onPress={() => setMonths(m)} />)}</View>
          </Field>
          {!NO_ACCOUNTS.includes(source) && <Field t={t} label="Accounts" hint={chosen.length ? pool.filter((a) => chosen.includes(a.id)).map((a) => a.name).join(' · ') : source === 'balance' ? 'Choose one account, or several to add together.' : source === 'carddebt' ? 'All cards. Choose cards to narrow it.' : 'All accounts. Choose accounts to narrow it.'}>
            <Button kind="plain" title={chosen.length ? `${chosen.length} chosen · change` : 'Choose accounts'} onPress={() => setPickAcc(true)} />
          </Field>}
          {catSource && (
            <Field t={t} label="Categories" hint={selected.length ? data?.cats.filter((c) => selected.includes(c.id)).map((c) => c.name).join(' · ') : source === 'income' ? 'All income. Choose categories to narrow it.' : 'All spending. Choose categories to narrow it.'}>
              <Button kind="plain" title={selected.length ? `${selected.length} chosen · change` : 'Choose categories'} onPress={() => setPick(true)} />
            </Field>
          )}
          {splits.length > 1 && (shown === 'pie' || shown === 'list' || (canStack && stack)) && (
            <Field t={t} label="Split by">
              <View style={chips}>{splits.map((b) => <Chip key={b} label={SPLIT_LABEL[b]} on={split === b} onPress={() => setBy(b)} />)}</View>
            </Field>
          )}
          {canStack && toggle(`One colour per ${SPLIT_LABEL[split ?? 'category'].toLowerCase()}`, stack, setStack)}
          {canPace && toggle('Where this month is heading, against the 3-month average', pace, setPace)}
          {canCompare && !(canStack && stack) && toggle('Compare with the period before', compare, setCompare)}
          {drawn && toggle('Numbers above the chart', numbers, setNumbers)}
          {shown === 'pie' && toggle('Show the legend (off: tap a slice for its amount)', legend, setLegend)}
          {drawn && source !== 'cashflow' && !(canPace && pace) && toggle('Dashed line at the average', avgLine, setAvgLine)}
          {oneLoan && toggle('Loan payoff date and interest', payoff, setPayoff)}
          {data && <MultiPicker visible={pick} title="Categories" onClose={() => setPick(false)} selected={selected} onChange={setIds}
            items={data.cats.map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group }))} />}
          {data && <MultiPicker visible={pickAcc} title="Accounts" onClose={() => setPickAcc(false)} selected={chosen} onChange={setAccs}
            items={byAccountGroup(pool).map((a) => ({ id: a.id, label: `${a.name}${a.mask ? ` ••${a.mask}` : ''}`, group: accountGroup(a.type) }))} />}
        </>
      ) : (
        <>
          {!!def && <Text style={{ color: t.muted, fontSize: 13 }}>{def.about}.</Text>}
          {widget === 'radar' && (
            <>
              <Field t={t} label="What to watch for">
                {RADAR_CHECKS.map((c) => (
                  <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text }}>{c.label}</Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{c.about}</Text>
                    </View>
                    <Switch value={!(radar.off ?? []).includes(c.key)} onValueChange={(v) => setRadar((r) => ({ ...r, off: v ? (r.off ?? []).filter((x) => x !== c.key) : [...(r.off ?? []), c.key] }))} />
                  </View>
                ))}
              </Field>
              <Field t={t} label="When to speak up" hint="Leave a box empty to use the usual value shown in grey.">
                {([['unusualPct', 'Unusual spending: % above the average', String(50)], ['unusualMin', 'Unusual spending: at least this much above', String(RADAR_LIMITS.unusualMin)],
                  ['cardPct', 'Card use: % of the limit', String(RADAR_LIMITS.cardPct)], ['runwayDays', 'Cash runway: fewer days than', String(RADAR_LIMITS.runwayDays)]] as const).map(([k, label, usual]) => (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 }}>
                    <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
                    <TextInput defaultValue={radar[k] != null ? String(radar[k]) : ''} onChangeText={(v) => radarNum(k, v)} keyboardType="decimal-pad" placeholder={usual} placeholderTextColor={t.muted} accessibilityLabel={label}
                      style={[input, { width: 84, textAlign: 'right' }]} />
                  </View>
                ))}
              </Field>
            </>
          )}
          {widget === 'watch' && (
            <Field t={t} label="Watched categories" hint="The same list as the Spending watch page; changing it here changes it everywhere.">
              <Button kind="plain" title={watch?.length ? `${watch.length} chosen · change` : 'Choose categories'} onPress={() => setPickWatch(true)} />
              {data && watch && <MultiPicker visible={pickWatch} title="Watch list" onClose={() => setPickWatch(false)} selected={watch}
                onChange={(ids) => { setWatch(ids); savePrefs({ watch_categories: ids }).catch(() => {}); }}
                items={data.cats.filter((c) => c.kind === 'expense').map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group }))} />}
            </Field>
          )}
        </>
      )}
      <Field t={t} label={kind === 'text' ? 'Heading (optional)' : 'Title (optional)'}><TextInput value={title} onChangeText={setTitle} placeholder={kind === 'basic' ? def?.title ?? '' : kind === 'text' ? '' : SOURCES[source].title} placeholderTextColor={t.muted} style={input} /></Field>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 10, flexGrow: 1 },
  trow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  tcell: { width: 84, textAlign: 'right', fontVariant: ['tabular-nums'] },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mini: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  bars: { height: 96, flexDirection: 'row', gap: 4 },
  calHead: { flexDirection: 'row' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, alignItems: 'center' },
  calBox: { minHeight: 38, paddingVertical: 2, borderWidth: 1, borderRadius: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
});
