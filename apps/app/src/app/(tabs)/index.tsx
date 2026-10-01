// Transactions tab: every transaction, grouped by day, with search, filters and sorting.
// "To review" shows only unchecked ones (new arrivals); tick the circle to mark one reviewed,
// or tap the row to change it. "All" shows everything; the circle there toggles reviewed.
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  datePresetRange, dayHeading, formatMoney, groupByDay, searchPattern, shortDate, todayIn, type DatePreset,
} from '@budget-app/core';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Chip, Empty, Segmented } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';

type Mode = 'review' | 'all';
type Direction = 'any' | 'out' | 'in' | 'transfer';
type Sort = 'newest' | 'oldest' | 'largest' | 'smallest' | 'merchant';

interface Row {
  id: string; date: string; amount: number; currency: string; display_name: string; category_name: string | null;
  category_source: string | null; account_name: string; account_mask: string | null; reviewed: boolean;
  split_count: number; is_transfer: boolean; notes: string | null; tags: string[];
}
interface Filters {
  preset: DatePreset; direction: Direction; min: string; max: string;
  accounts: string[]; categories: string[]; // 'none' = uncategorised
  sort: Sort;
}

const PAGE = 100;
const DEFAULTS: Filters = { preset: 'all', direction: 'any', min: '', max: '', accounts: [], categories: [], sort: 'newest' };
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: 'All time' }, { key: 'month', label: 'This month' }, { key: 'lastMonth', label: 'Last month' },
  { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' }, { key: 'year', label: 'This year' }, { key: 'lastYear', label: 'Last year' },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'largest', label: 'Largest' },
  { key: 'smallest', label: 'Smallest' }, { key: 'merchant', label: 'Merchant A–Z' },
];
const SOURCE_LABEL: Record<string, string> = { rule: 'rule', learned: 'learned', plaid: 'bank', manual: 'you' };
const today = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

function activeCount(f: Filters) {
  return (f.preset !== 'all' ? 1 : 0) + (f.direction !== 'any' ? 1 : 0) + (f.min || f.max ? 1 : 0)
    + (f.accounts.length ? 1 : 0) + (f.categories.length ? 1 : 0);
}

export default function Transactions() {
  const t = useTheme();
  const navigation = useNavigation();
  const [mode, setMode] = useState<Mode>('review');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [toReview, setToReview] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string; mask: string | null }[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; group_name: string }[]>([]);
  const request = useRef(0);

  // Search waits until you pause typing.
  useEffect(() => { const h = setTimeout(() => setQuery(search), 300); return () => clearTimeout(h); }, [search]);

  useEffect(() => {
    supabase.from('accounts').select('id, name, mask').eq('is_hidden', false).order('name').then(({ data }) => setAccounts(data ?? []));
    supabase.from('categories').select('id, name, group_name').eq('is_hidden', false).order('sort').order('name').then(({ data }) => setCats(data ?? []));
  }, []);

  const fetchPage = useCallback(async (page: number) => {
    const id = ++request.current;
    setLoading(true);
    let q = supabase.from('transaction_list')
      .select('id, date, amount, currency, display_name, category_name, category_source, account_name, account_mask, reviewed, split_count, is_transfer, notes, tags', { count: page === 0 ? 'exact' : undefined });
    if (mode === 'review') q = q.eq('reviewed', false);
    const { from, to } = datePresetRange(filters.preset, today());
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    if (filters.accounts.length) q = q.in('account_id', filters.accounts);
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
    const pattern = searchPattern(query);
    if (pattern) groups.push(['display_name', 'name', 'notes'].map((c) => `${c}.ilike.${pattern}`).join(','));
    if (groups.length === 1) q = q.or(groups[0]);
    if (groups.length === 2) q = q.or(`and(or(${groups[0]}),or(${groups[1]}))`);

    const order: Record<Sort, [string, boolean][]> = {
      newest: [['date', false], ['id', false]], oldest: [['date', true], ['id', true]],
      largest: [['amount_abs', false], ['date', false]], smallest: [['amount_abs', true], ['date', false]],
      merchant: [['sort_name', true], ['date', false]],
    };
    for (const [col, asc] of order[filters.sort]) q = q.order(col, { ascending: asc });
    const { data, error, count } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (id !== request.current) return; // a newer request replaced this one
    setLoading(false);
    if (error) { setError(error.message); return; }
    setError('');
    const list = (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })) as Row[];
    setRows((prev) => (page === 0 ? list : [...prev, ...list]));
    if (page === 0) setTotal(count ?? null);
    setHasMore(list.length === PAGE);
  }, [mode, filters, query]);

  const countToReview = useCallback(async () => {
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('reviewed', false);
    setToReview(count ?? 0);
  }, []);

  const reload = useCallback(() => { fetchPage(0); countToReview(); }, [fetchPage, countToReview]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useEffect(() => { navigation.setOptions({ tabBarBadge: toReview || undefined }); }, [navigation, toReview]);

  const setReviewed = async (ids: string[], reviewed: boolean) => {
    if (mode === 'review' && reviewed) setRows((r) => r.filter((x) => !ids.includes(x.id)));
    else setRows((r) => r.map((x) => (ids.includes(x.id) ? { ...x, reviewed } : x)));
    setToReview((n) => Math.max(0, n + (reviewed ? -ids.length : ids.length)));
    if (mode === 'review' && reviewed) setTotal((n) => (n == null ? n : n - ids.length));
    const { error } = await supabase.from('transactions')
      .update({ reviewed, reviewed_at: reviewed ? new Date().toISOString() : null }).in('id', ids);
    if (error) { setError(error.message); reload(); }
  };

  const byDate = filters.sort === 'newest' || filters.sort === 'oldest';
  const sections = useMemo(() => (byDate ? groupByDay(rows) : []), [rows, byDate]);
  const nFilters = activeCount(filters);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (key: 'accounts' | 'categories', id: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const renderRow = ({ item }: { item: Row }) => (
    <TxnRow t={t} item={item} showDate={!byDate} onToggle={() => setReviewed([item.id], !item.reviewed)} />
  );
  const footer = hasMore ? <Button title="Load more" kind="plain" onPress={() => fetchPage(Math.ceil(rows.length / PAGE))} busy={loading} style={{ margin: 16 }} /> : null;
  const empty = loading ? null : (
    <Empty text={mode === 'review' && !query && !nFilters ? 'All caught up. New transactions show up here after each sync.' : 'No transactions match.'} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.top, { borderColor: t.line }]}>
        <Segmented<Mode> value={mode} onChange={setMode}
          options={[{ value: 'review', label: toReview ? `To review (${toReview})` : 'To review' }, { value: 'all', label: 'All' }]} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[styles.search, { borderColor: t.line, backgroundColor: t.card }]}>
            <Ionicons name="search" size={16} color={t.muted} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search merchant, description, notes" placeholderTextColor={t.muted}
              style={[{ flex: 1, color: t.text, paddingVertical: 8, fontSize: 15 }, { outlineStyle: 'none' } as any]} autoCorrect={false} />
            {!!search && <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={t.muted} /></Pressable>}
          </View>
          <Pressable onPress={() => setShowFilters(!showFilters)} accessibilityRole="button"
            style={[styles.filterBtn, { borderColor: nFilters || filters.sort !== 'newest' ? t.accent : t.line, backgroundColor: showFilters ? t.accent : t.card }]}>
            <Ionicons name="options-outline" size={18} color={showFilters ? '#fff' : t.text} />
            <Text style={{ color: showFilters ? '#fff' : t.text, fontWeight: '600' }}>{nFilters ? `Filters · ${nFilters}` : 'Filters'}</Text>
          </Pressable>
        </View>
        {showFilters && (
          <FilterPanel t={t} f={filters} set={set} toggle={toggle} accounts={accounts} cats={cats} reset={() => setFilters(DEFAULTS)} />
        )}
        <View style={styles.between}>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {total == null ? ' ' : `${total.toLocaleString()} transaction${total === 1 ? '' : 's'}`}
            {filters.sort !== 'newest' ? ` · ${SORTS.find((s) => s.key === filters.sort)!.label.toLowerCase()}` : ''}
          </Text>
          {mode === 'review' && rows.length > 1 && (
            <Pressable onPress={() => setReviewed(rows.map((r) => r.id), true)} hitSlop={8}>
              <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>Mark {rows.length} shown as reviewed</Text>
            </Pressable>
          )}
        </View>
      </View>
      {!!error && <Text style={{ color: t.danger, padding: 12 }}>{error}</Text>}

      {byDate ? (
        <SectionList
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
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: 52 }} />}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={loading && !rows.length} onRefresh={reload} />}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: 52 }} />}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
        />
      )}
    </View>
  );
}

function TxnRow({ t, item, showDate, onToggle }: { t: Theme; item: Row; showDate: boolean; onToggle: () => void }) {
  const category = item.split_count ? `Split · ${item.split_count} parts` : item.category_name;
  return (
    <Pressable onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.line : t.card }]}>
      <Pressable accessibilityLabel={item.reviewed ? 'Mark not reviewed' : 'Mark reviewed'} hitSlop={10} onPress={onToggle} style={styles.check}>
        <Ionicons name={item.reviewed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={item.reviewed ? t.accent : t.muted} />
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{item.display_name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 13, color: category ? t.text : t.danger }}>
          {showDate ? <Text style={{ color: t.muted }}>{`${shortDate(item.date)} ${item.date.slice(0, 4)}  ·  `}</Text> : null}
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
}

function FilterPanel({ t, f, set, toggle, accounts, cats, reset }: {
  t: Theme; f: Filters; set: (p: Partial<Filters>) => void; toggle: (k: 'accounts' | 'categories', id: string) => void;
  accounts: { id: string; name: string; mask: string | null }[]; cats: { id: string; name: string; group_name: string }[]; reset: () => void;
}) {
  const [showCats, setShowCats] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, typeof cats>();
    for (const c of cats) (m.get(c.group_name) ?? m.set(c.group_name, []).get(c.group_name)!).push(c);
    return [...m.entries()];
  }, [cats]);
  const input = [styles.amountInput, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  return (
    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
      <Label t={t} text="Sort" />
      <View style={styles.chips}>{SORTS.map((s) => <Chip key={s.key} label={s.label} on={f.sort === s.key} onPress={() => set({ sort: s.key })} />)}</View>
      <Label t={t} text="Dates" />
      <View style={styles.chips}>{PRESETS.map((p) => <Chip key={p.key} label={p.label} on={f.preset === p.key} onPress={() => set({ preset: p.key })} />)}</View>
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
      <Label t={t} text="Accounts" />
      <View style={styles.chips}>
        {accounts.map((a) => <Chip key={a.id} label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`} on={f.accounts.includes(a.id)} onPress={() => toggle('accounts', a.id)} />)}
      </View>
      <Pressable onPress={() => setShowCats(!showCats)} style={styles.between}>
        <Label t={t} text={`Categories${f.categories.length ? ` · ${f.categories.length} chosen` : ''}`} />
        <Text style={{ color: t.accent }}>{showCats ? 'Hide' : 'Choose'}</Text>
      </Pressable>
      {showCats && (
        <View style={{ gap: 8 }}>
          <View style={styles.chips}><Chip label="Uncategorised" on={f.categories.includes('none')} onPress={() => toggle('categories', 'none')} /></View>
          {groups.map(([g, list]) => (
            <View key={g} style={{ gap: 4 }}>
              <Text style={{ color: t.muted, fontSize: 12 }}>{g}</Text>
              <View style={styles.chips}>{list.map((c) => <Chip key={c.id} label={c.name} on={f.categories.includes(c.id)} onPress={() => toggle('categories', c.id)} />)}</View>
            </View>
          ))}
        </View>
      )}
      <Button title="Clear filters and sort" kind="plain" onPress={reset} />
    </ScrollView>
  );
}

const Label = ({ t, text }: { t: Theme; text: string }) => (
  <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>{text}</Text>
);

const styles = StyleSheet.create({
  top: { padding: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  amountInput: { borderWidth: 1, borderRadius: 8, padding: 8, width: 110 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 16 },
  check: { width: 52, alignItems: 'center' },
});
