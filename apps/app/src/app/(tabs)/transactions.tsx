// Transactions tab: every transaction, grouped by day, with search, filters and sorting.
// The check button beside the search shows only unchecked ones (new arrivals, with a count);
// tick the circle to mark one reviewed, or tap the row to change it. With it off you see
// everything, and the circle toggles reviewed. Filters open in a pop-up.
import { useFocusLoad } from '@/lib/focusLoad';
import { today } from '@/lib/plan';
import { Sheet } from '@/components/Forms';
import { Tile } from '@/components/Tile';
import { ROW, LIST, SPLIT_LIST, splitFits, splitSide } from '@/lib/layout';
import { EmptyState, PageSkeleton, RowsSkeleton } from '@/components/States';
import { ALL_TIME, DateRangeBody, type Range } from '@/components/DateRange';
import { toast } from '@/lib/toast';
import { usePullRefresh } from '@/lib/pullRefresh';
import { bankLogo, customPicture, merchantLogo, useLogoVersion, useLogos } from '@/lib/logos';
import { Logo, TxnLogo } from '@/components/Logo';
import { PANEL } from '@/lib/motion';
import { UNDER_BAR } from '@/lib/layout';
import Ionicons from '@expo/vector-icons/Ionicons';
import { seedTxn } from '@/lib/txnCache';
import { PAGE_MAX, useWide } from '@/lib/layout';
import { TransactionEditor } from '@/components/TransactionEditor';
import { ModalFrame } from '@/components/ModalFrame';
import {
  categoryIcon, datePresetRange, dayHeading, formatMoney, groupByDay, searchWords, shortDate, type DatePreset,
} from '@budget-app/core';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, SectionList, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MultiPicker } from '@/components/Picker';
import { IconButton, TopBar } from '@/components/TopBar';
import { Bar, Card, Button, Chip, Empty, Fab } from '@/components/ui';
import { NewTransactionForm } from '@/components/AddForms';
import { loadAccounts } from '@/lib/plan';
import type { Account } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { accountGroup, byAccountGroup } from '@/lib/types';
import { useBackToClose } from '@/lib/useBackToClose';
import { useTheme, type Theme } from '@/lib/theme';

type Mode = 'review' | 'all';
type Direction = 'any' | 'out' | 'in' | 'transfer';
type Sort = 'newest' | 'oldest' | 'largest' | 'smallest' | 'merchant';

interface Row {
  id: string; date: string; amount: number; currency: string; display_name: string; category_name: string | null; category_icon: string | null;
  category_source: string | null; account_name: string; account_mask: string | null; reviewed: boolean;
  split_count: number; is_transfer: boolean; notes: string | null; tags: string[]; pending?: boolean;
}
interface Filters {
  range: Range; direction: Direction; min: string; max: string;
  accounts: string[]; categories: string[]; // 'none' = uncategorised
  merchants: string[];
  sort: Sort;
}

const PAGE = 100;
// This list is long and gets flicked through: build more rows per pass and keep more of them either side of the screen.
const BIG_LIST = { initialNumToRender: 20, maxToRenderPerBatch: 30, updateCellsBatchingPeriod: 16, windowSize: 15 } as const;
const DEFAULTS: Filters = { range: ALL_TIME, direction: 'any', min: '', max: '', accounts: [], categories: [], merchants: [], sort: 'newest' };
const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'largest', label: 'Largest' },
  { key: 'smallest', label: 'Smallest' }, { key: 'merchant', label: 'Merchant A–Z' },
];
const SOURCE_LABEL: Record<string, string> = { rule: 'rule', learned: 'learned', plaid: 'bank', manual: 'you' };

function activeCount(f: Filters) {
  return (f.range.key !== 'all' ? 1 : 0) + (f.direction !== 'any' ? 1 : 0) + (f.min || f.max ? 1 : 0)
    + (f.accounts.length ? 1 : 0) + (f.categories.length ? 1 : 0) + (f.merchants.length ? 1 : 0) + (f.sort !== 'newest' ? 1 : 0);
}

export default function Transactions() {
  const t = useTheme();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ mode?: string; q?: string; account?: string; from?: string; to?: string; label?: string; v?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'review' ? 'review' : 'all');
  const [search, setSearch] = useState(params.q ?? '');
  const wide = useWide();
  const [room, setRoom] = useState(1200); // width available to the list and the pane beside it
  const twoPane = wide && splitFits(room);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState<Account[] | null>(null);
  const searchRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  // A link asking for a view (lib/txnLinks: Home's "To review", a search, a rule's matches, an account,
  // a month) starts from a clean slate: filters and search left from before are cleared, then its own applied.
  useEffect(() => {
    if (!params.v && !params.mode && !params.q) return;
    setMode(params.mode === 'review' ? 'review' : 'all');
    setSearch(params.q ?? ''); setQuery(params.q ?? '');
    setFilters({
      ...DEFAULTS,
      accounts: params.account ? [params.account] : [],
      range: params.from || params.to ? { key: 'link', label: params.label || 'Chosen dates', from: params.from ?? '', to: params.to ?? '' } : DEFAULTS.range,
    });
  }, [params.v, params.mode, params.q, params.account, params.from, params.to]);
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [toReview, setToReview] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string; mask: string | null; icon?: string | null; type?: string | null }[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; group_name: string; icon: string | null }[]>([]);
  const request = useRef(0);

  // Search waits until you pause typing.
  useEffect(() => { const h = setTimeout(() => setQuery(search), 300); return () => clearTimeout(h); }, [search]);

  useEffect(() => {
    supabase.from('accounts').select('id, name, mask, icon, type').eq('is_hidden', false).order('name').then(({ data }) => setAccounts(byAccountGroup(data ?? [])));
    supabase.from('categories').select('id, name, group_name, icon').eq('is_hidden', false).order('sort').order('name').then(({ data }) => setCats(data ?? []));
  }, []);

  const fetchPage = useCallback(async (page: number) => {
    const id = ++request.current;
    setLoading(true);
    const q = filtered(supabase.from('transaction_list')
      .select('id, date, amount, currency, name, merchant, category_id, account_id, display_name, category_name, category_icon, category_source, account_name, account_mask, reviewed, split_count, is_transfer, notes, tags, pending', { count: page === 0 ? 'exact' : undefined }),
      mode, filters, query);
    const { data, error, count } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (id !== request.current) return; // a newer request replaced this one
    setLoading(false);
    if (error) { setError(error.message); return; }
    setError('');
    const list = (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })) as Row[];
    setRows((prev) => (page === 0 ? keepSame(prev, list) : [...prev, ...list]));
    if (page === 0) setTotal(count ?? null);
    setHasMore(list.length === PAGE);
  }, [mode, filters, query]);

  const countToReview = useCallback(async () => {
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('reviewed', false);
    setToReview(count ?? 0);
  }, []);

  const reload = useCallback(() => { fetchPage(0); countToReview(); }, [fetchPage, countToReview]);
  // Keyboard on the web: "/" jumps to search; with a transaction open, ↑ ↓ move through the list and Esc closes it.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (typing || !sel) return;
      if (e.key === 'Escape') setSel(null);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const i = rows.findIndex((r) => r.id === sel), j = i + (e.key === 'ArrowDown' ? 1 : -1);
        if (i >= 0 && rows[j]) { e.preventDefault(); setSel(rows[j].id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, rows]);
  useFocusLoad(reload);
  useLayoutEffect(() => { setOpenId(sel); }, [sel]);
  usePullRefresh(reload);
  useEffect(() => { navigation.setOptions({ tabBarBadge: toReview || undefined }); }, [navigation, toReview]);

  const setReviewed = async (ids: string[], reviewed: boolean, quiet = false) => {
    if (mode === 'review' && reviewed) setRows((r) => r.filter((x) => !ids.includes(x.id)));
    else setRows((r) => r.map((x) => (ids.includes(x.id) ? { ...x, reviewed } : x)));
    setToReview((n) => Math.max(0, n + (reviewed ? -ids.length : ids.length)));
    if (mode === 'review' && reviewed) setTotal((n) => (n == null ? n : n - ids.length));
    const { error } = await supabase.from('transactions')
      .update({ reviewed, reviewed_at: reviewed ? new Date().toISOString() : null }).in('id', ids);
    if (error) { setError(error.message); reload(); }
    else if (!quiet) toast(reviewed ? (ids.length > 1 ? `${ids.length} marked reviewed` : 'Marked reviewed') : 'Marked not reviewed', { undo: async () => { await supabase.from('transactions').update({ reviewed: !reviewed, reviewed_at: !reviewed ? new Date().toISOString() : null }).in('id', ids); } });
  };

  const byDate = filters.sort === 'newest' || filters.sort === 'oldest';
  // A different view (filters, search, to-review or all) gets a fresh list, back at the top. Keeping
  // the old one meant it held on to the old view's scroll position and row measurements, and could
  // show an empty stretch under the date heading until it caught up.
  const listKey = useMemo(() => JSON.stringify([mode, filters, query]), [mode, filters, query]);
  // A day's total leaves out what's still pending, like every other total.
  const sections = useMemo(() => (byDate ? groupByDay(rows).map((g) => (g.data.some((r) => r.pending) ? { ...g, total: Math.round(g.data.reduce((x, r) => x + (r.pending ? 0 : Number(r.amount)), 0) * 100) / 100 } : g)) : []), [rows, byDate]);
  const nFilters = activeCount(filters);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  // Rows only redraw when their own transaction changes: the handlers stay the same function across renders
  // (through a ref), and a reload keeps the row objects that didn't change.
  const toggleRef = useRef((_: Row) => {});
  useLayoutEffect(() => { toggleRef.current = (item: Row) => setReviewed([item.id], !item.reviewed); });
  const onToggle = useCallback((item: Row) => toggleRef.current(item), []);
  const onOpen = useCallback((item: Row) => { seedTxn(item); setSel(item.id); }, []);
  const renderRow = useCallback(({ item }: { item: Row }) => <TxnRow t={t} item={item} showDate={!byDate} onToggle={onToggle} onOpen={onOpen} />, [t, byDate, onToggle, onOpen]);
  const separator = useCallback(() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: 52 }} />, [t]);
  const footer = hasMore ? <Button title="Load more" kind="plain" onPress={() => fetchPage(Math.ceil(rows.length / PAGE))} busy={loading} style={{ margin: 16 }} /> : null;
  const empty = loading ? <RowsSkeleton rows={10} /> : mode === 'review' && !query && !nFilters
    ? <EmptyState icon="checkmark-done-circle-outline" title="All caught up" text="New transactions show up here after each bank sync." action="Show all transactions" onAction={() => setMode('all')} />
    : query || nFilters ? <EmptyState icon="search-outline" title="No transactions match" text="Try a shorter search or fewer filters." action={nFilters ? 'Clear filters' : undefined} onAction={() => setFilters(DEFAULTS)} />
    : <EmptyState icon="receipt-outline" title="No transactions yet" text="Link a bank or import a CSV file to bring them in." action="Open Settings" onAction={() => router.navigate('/settings')} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar>
        <View style={[styles.search, { borderColor: t.line, backgroundColor: t.card }]}>
          <Ionicons name="search" size={16} color={t.muted} />
          <TextInput ref={searchRef} value={search} onChangeText={setSearch} placeholder={wide ? 'Search (press /)' : 'Search'} placeholderTextColor={t.muted}
            style={[{ flex: 1, color: t.text, paddingVertical: 9, fontSize: 15 }, { outlineStyle: 'none' } as any]} autoCorrect={false} />
          {!!search && <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={t.muted} /></Pressable>}
        </View>
        <IconButton icon="checkmark-done" label={mode === 'review' ? 'Showing to review; show all' : 'Show only to review'}
          on={mode === 'review'} badge={toReview} onPress={() => setMode(mode === 'review' ? 'all' : 'review')} />
        <IconButton icon="options-outline" label="Filters and sort" on={nFilters > 0} badge={nFilters} onPress={() => setShowFilters(true)} />
      </TopBar>
      <View style={[styles.status, { borderColor: t.line }]}>
        <Text style={{ color: t.muted, fontSize: 13, flex: 1 }} numberOfLines={1}>
          {mode === 'review' ? 'To review' : 'All'}{total == null ? '' : ` · ${total.toLocaleString()}`}
          {filters.sort !== 'newest' ? ` · ${SORTS.find((x) => x.key === filters.sort)!.label.toLowerCase()}` : ''}
          {nFilters ? ' · filtered' : ''}
        </Text>
        {mode === 'review' && rows.length > 1 && (
          <Pressable onPress={() => setReviewed(rows.map((r) => r.id), true)} hitSlop={8}>
            <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>Mark {rows.length} reviewed</Text>
          </Pressable>
        )}
      </View>
      <FilterSheet visible={showFilters} onClose={() => setShowFilters(false)} t={t} f={filters} set={set}
        accounts={accounts} cats={cats} reset={() => setFilters(DEFAULTS)} total={total}
        onExport={() => exportCsv(mode, filters, query)} />
      {!!error && <Text style={{ color: t.danger, padding: 12 }}>{error}</Text>}

      <View style={[COLUMN, { flex: 1, flexDirection: 'row' }]} onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
      {/* Same rule as Merchants (lib/layout SPLIT): the list keeps its width, the pane beside it narrows, then steps aside. */}
      <View style={wide ? SPLIT_LIST : { flex: 1 }}>
      {byDate ? (
        <SectionList {...LIST} {...BIG_LIST} key={listKey}
          sections={sections}
          keyExtractor={(r) => r.id}
          stickySectionHeadersEnabled
          refreshControl={<RefreshControl refreshing={loading && !rows.length} onRefresh={reload} />}
          renderSectionHeader={({ section }) => (
            <View style={[styles.dayHead, { backgroundColor: t.bg, borderColor: t.line }]}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{dayHeading(section.date, today())}</Text>
              <Text style={{ color: t.muted, fontVariant: ['tabular-nums'] }}>{section.total > 0 ? '+' : ''}{formatMoney(section.total)}</Text>
            </View>
          )}
          renderItem={renderRow}
          ItemSeparatorComponent={separator}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          contentContainerStyle={{ paddingBottom: UNDER_BAR }}
        />
      ) : (
        <FlatList {...LIST} {...BIG_LIST} key={listKey}
          data={rows}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={loading && !rows.length} onRefresh={reload} />}
          renderItem={renderRow}
          ItemSeparatorComponent={separator}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          contentContainerStyle={{ paddingBottom: UNDER_BAR }}
        />
      )}
      </View>
      {!sel && <Fab label="Add a transaction" onPress={() => loadAccounts().then(setAdding, (e) => toast(e instanceof Error ? e.message : String(e), { error: true }))} />}
      {adding && <NewTransactionForm accounts={adding} onClose={() => setAdding(null)} onSaved={() => { toast('Added'); reload(); }} />}
      {!twoPane && sel && (
        <Sheet title="Transaction" scroll={false} onClose={() => setSel(null)}>
          <TransactionEditor key={sel} id={sel} onOpen={setSel} onDone={() => { setSel(null); reload(); }} />
        </Sheet>
      )}
      {twoPane && !sel && <FilterSummary t={t} mode={mode} filters={filters} query={query} stamp={rows.length} />}
      {twoPane && sel && (
        <View style={[styles.side, PANEL, { borderColor: t.line, backgroundColor: t.bg }]}>
          <View style={[styles.sideHead, { borderColor: t.line }]}>
            <Text style={{ color: t.text, fontWeight: '700', flex: 1 }}>Transaction</Text>
            <Pressable onPress={() => setSel(null)} hitSlop={10} accessibilityLabel="Close details"><Ionicons name="close" size={22} color={t.text} /></Pressable>
          </View>
          <TransactionEditor key={sel} id={sel} onOpen={setSel} onDone={() => { setSel(null); reload(); }} />
        </View>
      )}
      </View>
    </View>
  );
}

/** Applies the review switch, search and filters to a transaction_list query, sorted (shared by the list and the CSV export). */
function filtered(q: any, mode: Mode, filters: Filters, query: string) {
  if (mode === 'review') q = q.eq('reviewed', false);
  const { from, to } = filters.range;
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  if (filters.accounts.length) q = q.in('account_id', filters.accounts);
  if (filters.merchants.length) q = q.in('display_name', filters.merchants);
  if (filters.direction === 'out') q = q.lt('amount', 0).eq('is_transfer', false);
  if (filters.direction === 'in') q = q.gt('amount', 0).eq('is_transfer', false);
  if (filters.direction === 'transfer') q = q.eq('is_transfer', true);
  const min = Number(filters.min), max = Number(filters.max);
  if (filters.min && !isNaN(min)) q = q.gte('amount_abs', min);
  if (filters.max && !isNaN(max)) q = q.lte('amount_abs', max);
  // Category and search are each "any of"; when both apply they're combined in one OR group.
  const groups: string[] = [];
  const ids = filters.categories.filter((c) => c !== 'none');
  if (filters.categories.length) {
    const parts = [...(ids.length ? [`category_ids.ov.{${ids.join(',')}}`] : []), ...(filters.categories.includes('none') ? ['category_ids.eq.{}'] : [])];
    groups.push(parts.join(','));
  }
  // Search: every word has to turn up somewhere: the merchant, the bank's text, notes, the category or
  // its group, or the account. So a category's name works as a filter ("work expenses"), and so does
  // an account's ("visa"). A plain number also finds that amount.
  for (const w of searchWords(query)) {
    const cols = ['display_name', 'name', 'notes', 'category_name', 'category_group', 'account_name'].map((c) => `${c}.ilike.*${w}*`);
    const n = Number(w.replace(/^\$/, ''));
    if (/^\$?\d+(\.\d{1,2})?$/.test(w) && Number.isFinite(n)) cols.push(`amount_abs.eq.${n}`);
    groups.push(cols.join(','));
  }
  if (groups.length === 1) q = q.or(groups[0]);
  if (groups.length > 1) q = q.or(`and(${groups.map((g) => `or(${g})`).join(',')})`);
  const order: Record<Sort, [string, boolean][]> = {
    newest: [['date', false], ['id', false]], oldest: [['date', true], ['id', true]],
    largest: [['amount_abs', false], ['date', false]], smallest: [['amount_abs', true], ['date', false]],
    merchant: [['sort_name', true], ['date', false]],
  };
  for (const [col, asc] of order[filters.sort]) q = q.order(col, { ascending: asc });
  return q;
}

/** EXP-1: every transaction matching the current view as a CSV download (web). */
async function exportCsv(mode: Mode, filters: Filters, query: string): Promise<number> {
  const rows: any[] = [];
  for (let p = 0; p < 50; p++) {
    const { data, error } = await filtered(supabase.from('transaction_list')
      .select('date, display_name, name, category_name, category_group, account_name, amount, currency, notes, tags, reviewed, split_count').eq('pending', false), mode, filters, query)
      .range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const cell = (v: unknown) => { const x = v == null ? '' : Array.isArray(v) ? v.join(';') : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const head = ['Date', 'Merchant', 'Description', 'Category', 'Group', 'Account', 'Amount', 'Currency', 'Notes', 'Tags', 'Reviewed', 'Split parts'];
  const csv = [head.join(','), ...rows.map((r) => [r.date, r.display_name, r.name, r.category_name, r.category_group, r.account_name, Number(r.amount).toFixed(2), r.currency, r.notes, r.tags, r.reviewed ? 'yes' : 'no', r.split_count || ''].map(cell).join(','))].join('\n');
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `transactions-${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    await Share.share({ message: csv, title: 'transactions.csv' });
  }
  return rows.length;
}

// The open transaction, for the row highlight. Each row asks whether it is the one, so opening or closing a
// transaction updates two rows instead of every row on screen (that made pop-ups stutter on a phone).
let openId: string | null = null;
const openSubs = new Set<() => void>();
function setOpenId(id: string | null) { if (id !== openId) { openId = id; openSubs.forEach((f) => f()); } }
const useIsOpen = (id: string) => useSyncExternalStore((f) => { openSubs.add(f); return () => { openSubs.delete(f); }; }, () => openId === id, () => false);

/** The new list, reusing the old row object wherever a row is unchanged (so it isn't redrawn). */
function keepSame(prev: Row[], next: Row[]): Row[] {
  if (!prev.length) return next;
  const old = new Map(prev.map((r) => [r.id, r]));
  let same = prev.length === next.length;
  const out = next.map((r, i) => {
    const o = old.get(r.id);
    const keep = o && JSON.stringify(o) === JSON.stringify(r) ? o : r;
    if (keep !== prev[i]) same = false;
    return keep;
  });
  return same ? prev : out;
}

const TxnRow = memo(function TxnRow({ t, item, showDate, onToggle, onOpen }: { t: Theme; item: Row; showDate: boolean; onToggle: (item: Row) => void; onOpen: (item: Row) => void }) {
  const selected = useIsOpen(item.id);
  const logos = useLogos();
  const lv = useLogoVersion();
  const category = item.split_count ? `✂️ Split · ${item.split_count} parts` : item.category_name ? `${categoryIcon(item.category_name, item.category_icon)} ${item.category_name}` : null;
  return (
    <Pressable onPress={() => onOpen(item)}
      style={({ pressed, hovered }: any) => [styles.row, { backgroundColor: pressed || selected ? t.line : hovered ? t.bg : t.card }, item.pending && { opacity: 0.6 }]}>
      {/* Pending at the bank: not counted in totals yet, and nothing to review until it posts. */}
      {item.pending ? <View style={styles.check}><Ionicons name="time-outline" size={22} color={t.muted} /></View> : (
        <Pressable accessibilityLabel={item.reviewed ? 'Mark not reviewed' : 'Mark reviewed'} hitSlop={10} onPress={() => onToggle(item)} style={styles.check}>
          <Ionicons name={item.reviewed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={item.reviewed ? t.accent : t.muted} />
        </Pressable>
      )}
      {logos && <View style={{ marginRight: 10 }}><TxnLogo size={34} name={item.display_name} transfer={item.is_transfer} category={item.category_name} /></View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={[ROW.title, { color: t.text }]}>{item.display_name}</Text>
        <Text numberOfLines={1} style={[ROW.sub, { color: category ? t.text : t.danger }]}>
          {showDate ? <Text style={{ color: t.muted }}>{`${shortDate(item.date)} ${item.date.slice(0, 4)}  ·  `}</Text> : null}
          {item.pending ? <Text style={{ color: t.muted, fontWeight: '700' }}>{'Pending  ·  '}</Text> : null}
          {category ?? 'Uncategorised'}
          {!item.split_count && item.category_source && !item.reviewed ? <Text style={{ color: t.muted }}>{` (${SOURCE_LABEL[item.category_source]})`}</Text> : null}
          <Text style={{ color: t.muted }}>{`  ·  ${item.account_name}${item.account_mask ? ` ••${item.account_mask}` : ''}`}</Text>
        </Text>
        {(!!item.notes || item.tags?.length > 0) && (
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>
            {item.tags?.length ? item.tags.map((x) => `#${x}`).join(' ') + (item.notes ? '  ' : '') : ''}{item.notes ?? ''}
          </Text>
        )}
      </View>
      <Text style={{ color: item.amount > 0 ? t.positive : t.text, fontSize: 16, fontWeight: '600', marginLeft: 8, fontVariant: ['tabular-nums'] }}>
        {item.amount > 0 ? '+' : ''}{formatMoney(item.amount, item.currency)}
      </Text>
    </Pressable>
  );
});

function FilterSheet({ visible, onClose, t, f, set, accounts, cats, reset, total, onExport }: {
  visible: boolean; onClose: () => void; t: Theme; f: Filters; set: (p: Partial<Filters>) => void;
  accounts: { id: string; name: string; mask: string | null; icon?: string | null; type?: string | null }[]; cats: { id: string; name: string; group_name: string; icon: string | null }[]; reset: () => void; total: number | null;
  onExport: () => Promise<number>;
}) {
  const [exporting, setExporting] = useState('');
  const lv = useLogoVersion();
  const insets = useSafeAreaInsets();
  const [picker, setPicker] = useState<null | 'categories' | 'accounts' | 'merchants'>(null);
  useBackToClose(visible, onClose);
  const [merchants, setMerchants] = useState<{ merchant: string; txns: number }[]>([]);
  useEffect(() => {
    if (picker === 'merchants' && !merchants.length) {
      supabase.rpc('merchant_names').then(({ data }) => setMerchants(((data ?? []) as any[]).map((m) => ({ merchant: m.merchant, txns: Number(m.txns) }))));
    }
  }, [picker]);
  const input = [styles.amountInput, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const catName = (id: string) => (id === 'none' ? 'Uncategorised' : cats.find((c) => c.id === id)?.name ?? '');
  const acctName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const summary = (ids: string[], name: (id: string) => string) => (ids.length ? ids.slice(0, 3).map(name).join(', ') + (ids.length > 3 ? ` +${ids.length - 3}` : '') : 'Any');

  return (
    <ModalFrame visible={visible} onClose={onClose}>
      <View style={{ flex: 1 }}>
        <View style={[styles.sheetHead, { borderColor: t.line }]}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>Filters</Text>
          <Pressable onPress={reset} hitSlop={8}><Text style={{ color: t.accent }}>Reset</Text></Pressable>
          <Pressable onPress={onClose} style={[styles.doneBtn, { backgroundColor: t.accent }]}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>{total == null ? 'Done' : `Show ${total.toLocaleString()}`}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Label t={t} text="Sort" />
          <View style={styles.chips}>{SORTS.map((s) => <Chip key={s.key} label={s.label} on={f.sort === s.key} onPress={() => set({ sort: s.key })} />)}</View>
          <Label t={t} text="Dates" />
          <DateRangeBody t={t} value={f.range} onChange={(range) => set({ range })} />
          <Label t={t} text="Type" />
          <View style={styles.chips}>
            {([['any', 'Everything'], ['out', 'Money out'], ['in', 'Money in'], ['transfer', 'Transfers']] as [Direction, string][])
              .map(([k, l]) => <Chip key={k} label={l} on={f.direction === k} onPress={() => set({ direction: k })} />)}
          </View>
          <Label t={t} text="Amount (either direction)" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput value={f.min} onChangeText={(min) => set({ min })} placeholder="Min $" placeholderTextColor={t.muted} keyboardType="decimal-pad" style={input} />
            <Text style={{ color: t.muted }}>to</Text>
            <TextInput value={f.max} onChangeText={(max) => set({ max })} placeholder="Max $" placeholderTextColor={t.muted} keyboardType="decimal-pad" style={input} />
          </View>
          <View style={[styles.pickRows, { borderColor: t.line, backgroundColor: t.card }]}>
            {([
              ['categories', 'Categories', summary(f.categories, catName)],
              ['accounts', 'Accounts', summary(f.accounts, acctName)],
              ['merchants', 'Merchants', summary(f.merchants, (m) => m)],
            ] as const).map(([key, label, value], i) => (
              <Pressable key={key} onPress={() => setPicker(key)} style={[styles.pickRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }]}>
                <Text style={{ color: t.text, fontSize: 15, width: 100 }}>{label}</Text>
                <Text style={{ color: f[key].length ? t.text : t.muted, flex: 1, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
                <Ionicons name="chevron-forward" size={18} color={t.muted} />
              </Pressable>
            ))}
          </View>
          <Button title="Export these to CSV" kind="plain" busy={exporting === '…'} onPress={async () => {
            setExporting('…');
            try { const n = await onExport(); setExporting(`Exported ${n.toLocaleString()} transactions.`); }
            catch (e) { setExporting(e instanceof Error ? e.message : String(e)); }
          }} />
          {!!exporting && exporting !== '…' && <Text style={{ color: t.muted, fontSize: 13 }}>{exporting}</Text>}
        </ScrollView>
      </View>
      <MultiPicker visible={picker === 'categories'} title="Categories" onClose={() => setPicker(null)}
        items={[{ id: 'none', label: 'Uncategorised' }, ...cats.map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))]}
        selected={f.categories} onChange={(categories) => set({ categories })} />
      <MultiPicker visible={picker === 'accounts'} title="Accounts" onClose={() => setPicker(null)}
        items={accounts.map((a) => ({ id: a.id, label: `${a.name}${a.mask ? ` ••${a.mask}` : ''}`, group: accountGroup(a.type), icon: <Logo size={28} name={a.name} uri={customPicture(`account:${a.id}`, lv) ?? (a.icon ? null : bankLogo(a.name, lv))} emoji={a.icon ?? undefined} /> }))}
        selected={f.accounts} onChange={(accounts) => set({ accounts })} />
      <MultiPicker visible={picker === 'merchants'} title="Merchants" onClose={() => setPicker(null)}
        items={merchants.map((m) => ({ id: m.merchant, label: m.merchant, detail: String(m.txns), icon: <Logo size={28} name={m.merchant} uri={merchantLogo(m.merchant, lv)} /> }))}
        selected={f.merchants} onChange={(merchants) => set({ merchants })} />
    </ModalFrame>
  );
}

const Label = ({ t, text }: { t: Theme; text: string }) => (
  <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{text}</Text>
);

const COLUMN = { width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' } as const;

/** Wide screens, nothing selected: what the current view adds up to, and where it went by category. */
function FilterSummary({ t, mode, filters, query, stamp }: { t: Theme; mode: Mode; filters: Filters; query: string; stamp: number }) {
  const [sum, setSum] = useState<{ n: number; inn: number; out: number; cats: [string, number][]; capped: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    setSum(null);
    (async () => {
      const all: { amount: number; category_name: string | null; is_transfer: boolean }[] = [];
      for (let p = 0; p < 10; p++) {
        const { data } = await filtered(supabase.from('transaction_list').select('amount, category_name, is_transfer').eq('pending', false), mode, filters, query).range(p * 1000, p * 1000 + 999);
        all.push(...((data ?? []) as any[]));
        if (!data || data.length < 1000) break;
      }
      if (!live) return;
      const real = all.filter((r) => !r.is_transfer);
      const by = new Map<string, number>();
      for (const r of real) if (Number(r.amount) < 0) by.set(r.category_name ?? 'Uncategorised', (by.get(r.category_name ?? 'Uncategorised') ?? 0) - Number(r.amount));
      setSum({
        n: all.length, capped: all.length >= 10000,
        inn: real.filter((r) => Number(r.amount) > 0).reduce((x, r) => x + Number(r.amount), 0),
        out: -real.filter((r) => Number(r.amount) < 0).reduce((x, r) => x + Number(r.amount), 0),
        cats: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      });
    })();
    return () => { live = false; };
  }, [mode, JSON.stringify(filters), query, stamp === 0]);
  const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
  return (
    <ScrollView style={[styles.side, { borderColor: t.line }]} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>THIS VIEW</Text>
      {!sum ? <PageSkeleton tiles={2} cards={1} /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Tile t={t} label="Transactions" value={`${sum.n.toLocaleString()}${sum.capped ? '+' : ''}`} />
            <Tile t={t} label="Net" value={`${sum.inn - sum.out < 0 ? '−' : '+'}${money0(Math.abs(sum.inn - sum.out))}`} color={sum.inn - sum.out < 0 ? t.series2 : t.accent} />
            <Tile t={t} label="Money in" value={money0(sum.inn)} />
            <Tile t={t} label="Money out" value={money0(sum.out)} />
          </View>
          {sum.cats.length > 0 && (
            <Card style={{ gap: 8 }}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>WHERE IT WENT</Text>
              {sum.cats.map(([name, v]) => (
                <View key={name} style={{ gap: 3 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{name}</Text>
                    <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{money0(v)}</Text>
                  </View>
                  <Bar value={v} max={sum.cats[0][1]} color={t.series1} height={5} />
                </View>
              ))}
            </Card>
          )}
          <Text style={{ color: t.muted, fontSize: 12 }}>Transfers between your accounts are left out of the totals. Select a transaction to see its details here.</Text>
        </>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  // The list keeps at least 400px; the side pane gives up width first and never grows past 420.
  side: { ...splitSide(420), borderLeftWidth: 1 },
  sideHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, height: 40 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  doneBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  pickRows: { borderWidth: 1, borderRadius: 12, marginTop: 4 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 14 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  amountInput: { borderWidth: 1, borderRadius: 8, padding: 8, width: 110 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 16, minHeight: ROW.minHeight },
  check: { width: 52, alignItems: 'center' },
});
