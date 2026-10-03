// Rules (IDEA-3): every category rule and merchant-name rule in one place. See them, add, edit
// and delete them, and try a bank description to see which rule would win.
//   • Category rules: "text contains X" (optionally one account and an amount range) → a category.
//   • Merchant names: "text contains X" → the name to show.
// When several rules match, the one with the longest text wins, so there is no order to manage;
// the page shows how many recent transactions each rule actually decides instead.
import Ionicons from '@expo/vector-icons/Ionicons';
import { categoryIcon, formatMoney, guessMerchant, matchRule, merchantFor, normalizeDescription, parseMoney, type CategoryRule } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { accountGroup, byAccountGroup } from '@/lib/types';
import { SinglePicker } from '@/components/Picker';
import { EmptyState, RowsSkeleton } from '@/components/States';
import { Button, Card, Segmented, Fab } from '@/components/ui';
import { LABEL, PAGE_MAX, TYPE, UNDER_BAR } from '@/lib/layout';
import { usePullRefresh } from '@/lib/pullRefresh';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';

interface CatRule { id: string; match_text: string; category_id: string; account_id: string | null; min_amount: number | null; max_amount: number | null }
interface NameRule { id: string; match: string; merchant: string; source: 'manual' | 'learned' }
interface Cat { id: string; name: string; group_name: string; icon: string | null; kind: string }
interface Acct { id: string; name: string; mask: string | null; type: string | null }
interface Recent { name: string; merchant: string | null; amount: number; account_id: string }
type Tab = 'category' | 'merchant';
const RECENT = 1000; // how many of the latest transactions the "decides" counts look at

const asCore = (r: CatRule): CategoryRule => ({ id: r.id, matchText: r.match_text, categoryId: r.category_id, accountId: r.account_id, minAmount: r.min_amount, maxAmount: r.max_amount });

export default function Rules() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('category');
  const [catRules, setCatRules] = useState<CatRule[]>([]);
  const [nameRules, setNameRules] = useState<NameRule[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [probe, setProbe] = useState('');
  const [editCat, setEditCat] = useState<Partial<CatRule> | null>(null);
  const [editName, setEditName] = useState<Partial<NameRule> | null>(null);

  const load = useCallback(async () => {
    const [a, b, c, d, e] = await Promise.all([
      supabase.from('category_rules').select('id, match_text, category_id, account_id, min_amount, max_amount').order('match_text'),
      supabase.from('merchant_rules').select('id, match, merchant, source').order('merchant').order('match'),
      supabase.from('categories').select('id, name, group_name, icon, kind').eq('is_hidden', false).order('group_name').order('name'),
      supabase.from('accounts').select('id, name, mask, type').order('name'),
      supabase.from('transactions').select('name, merchant, amount, account_id').order('date', { ascending: false }).limit(RECENT),
    ]);
    const err = a.error ?? b.error ?? c.error ?? d.error ?? e.error;
    setError(err?.message ?? '');
    if (!a.error) setCatRules((a.data ?? []).map((r: any) => ({ ...r, min_amount: r.min_amount == null ? null : Number(r.min_amount), max_amount: r.max_amount == null ? null : Number(r.max_amount) })));
    if (!b.error) setNameRules((b.data ?? []) as NameRule[]);
    if (!c.error) setCats((c.data ?? []) as Cat[]);
    if (!d.error) setAccounts((d.data ?? []) as Acct[]);
    if (!e.error) setRecent((e.data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })));
    setLoaded(true);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

  const catOf = (id: string) => cats.find((c) => c.id === id);
  const catLabel = (id: string) => { const c = catOf(id); return c ? `${categoryIcon(c.name, c.icon)}  ${c.name}` : 'A hidden or deleted category'; };
  const acctLabel = (id: string | null) => { const a = accounts.find((x) => x.id === id); return a ? a.name + (a.mask ? ` ••${a.mask}` : '') : ''; };

  // For each rule: how many recent transactions it decides (wins), and how many it matches at all.
  const stats = useMemo(() => {
    const core = catRules.map(asCore);
    const wins = new Map<string, number>(), hits = new Map<string, number>();
    const nameWins = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    const norm = nameRules.map((r) => ({ id: r.id, m: normalizeDescription(r.match) }));
    for (const x of recent) {
      const txn = { name: x.name, merchant: x.merchant ?? '', amount: x.amount, accountId: x.account_id };
      const w = matchRule(core, txn);
      if (w?.id) bump(wins, w.id);
      for (const r of core) if (matchRule([r], txn) && r.id) bump(hits, r.id);
      const d = normalizeDescription(x.name);
      let best = '', len = 0;
      for (const r of norm) if (r.m.length >= 3 && r.m.length > len && d.includes(r.m)) { best = r.id; len = r.m.length; }
      if (best) bump(nameWins, best);
    }
    return { wins, hits, nameWins };
  }, [catRules, nameRules, recent]);

  const s = q.trim().toLowerCase();
  const shownCat = catRules.filter((r) => !s || r.match_text.toLowerCase().includes(s) || (catOf(r.category_id)?.name ?? '').toLowerCase().includes(s));
  const shownName = nameRules.filter((r) => !s || r.match.toLowerCase().includes(s) || r.merchant.toLowerCase().includes(s));

  // "Try a description": what the rules would do with this text.
  const tried = useMemo(() => {
    const text = probe.trim();
    if (text.length < 2) return null;
    const nameRule = (() => { const d = normalizeDescription(text); let best: NameRule | null = null, len = 0; for (const r of nameRules) { const m = normalizeDescription(r.match); if (m.length >= 3 && m.length > len && d.includes(m)) { best = r; len = m.length; } } return best; })();
    const merchant = merchantFor(nameRules, text) || guessMerchant(text);
    const txn = { name: text, merchant, amount: 0, accountId: '' };
    const core = catRules.map(asCore);
    const win = matchRule(core.filter((r) => !r.accountId && r.minAmount == null && r.maxAmount == null), txn);
    const narrow = core.filter((r) => (r.accountId || r.minAmount != null || r.maxAmount != null) && matchRule([{ ...r, accountId: null, minAmount: null, maxAmount: null }], txn));
    return { merchant, nameRule, win: win ? catRules.find((r) => r.id === win.id)! : null, narrow: narrow.map((r) => catRules.find((x) => x.id === r.id)!) };
  }, [probe, catRules, nameRules]);

  const detail = (r: CatRule) => [acctLabel(r.account_id), r.min_amount != null && r.max_amount != null ? `${formatMoney(r.min_amount)}–${formatMoney(r.max_amount)}` : r.min_amount != null ? `${formatMoney(r.min_amount)} or more` : r.max_amount != null ? `up to ${formatMoney(r.max_amount)}` : ''].filter(Boolean).join(' · ');
  const used = (wins: number, hits?: number) => !recent.length ? '' : wins ? `decides ${wins}` : hits ? 'always outranked' : 'no recent matches';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'category', label: `Categories (${catRules.length})` }, { value: 'merchant', label: `Merchant names (${nameRules.length})` }]} />
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}

        <Card style={{ gap: 8 }}>
          <Text style={[LABEL, { color: t.muted }]}>TRY A DESCRIPTION</Text>
          <TextInput value={probe} onChangeText={setProbe} placeholder="Paste what the bank shows, e.g. POS CRNR MKT 1077" placeholderTextColor={t.muted} autoCapitalize="characters"
            style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.bg }]} />
          {tried && (
            <View style={{ gap: 6 }}>
              <Line t={t} label="Shown as" value={tried.merchant || '(no name)'} note={tried.nameRule ? `name rule “${tried.nameRule.match}”` : 'no name rule; tidied automatically'} onPress={tried.nameRule ? () => setEditName(tried.nameRule!) : undefined} />
              <Line t={t} label="Category" value={tried.win ? catLabel(tried.win.category_id) : 'No rule matches'} note={tried.win ? `rule “${tried.win.match_text}”` : 'falls back to the category you used last for this merchant'} onPress={tried.win ? () => setEditCat(tried.win!) : undefined} />
              {tried.narrow.map((r) => (
                <Line key={r.id} t={t} label="Also, only for" value={catLabel(r.category_id)} note={`${detail(r)} · rule “${r.match_text}”`} onPress={() => setEditCat(r)} />
              ))}
            </View>
          )}
        </Card>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={[styles.search, { backgroundColor: t.card, borderColor: t.line }]}>
            <Ionicons name="search" size={16} color={t.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder={tab === 'category' ? 'Search rules or categories' : 'Search rules or merchants'} placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: TYPE.body, paddingVertical: 8 }} />
          </View>
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>
          {tab === 'category' ? 'New transactions whose text contains a rule’s words get its category. ' : 'Bank text that contains a rule’s words is shown under the name you chose. '}
          When several rules match, the longest text wins.{recent.length ? ` Counts are from your latest ${recent.length.toLocaleString()} transactions.` : ''}
        </Text>

        {!loaded ? <RowsSkeleton card /> : tab === 'category' ? (
          !shownCat.length ? <EmptyState icon="funnel-outline" title={s ? 'No rules match' : 'No category rules yet'} text={s ? 'Try a shorter search.' : 'Change a transaction’s category and choose “Always use this category”, or add one here.'} /> : (
            <Card style={{ padding: 0 }}>
              {shownCat.map((r, i) => {
                const w = stats.wins.get(r.id) ?? 0, h = stats.hits.get(r.id) ?? 0, d = detail(r);
                return (
                  <Pressable key={r.id} onPress={() => setEditCat(r)} style={({ pressed, hovered }: any) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={1}>“{r.match_text}” <Text style={{ color: t.muted }}>→</Text> {catLabel(r.category_id)}</Text>
                      {!!d && <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>Only {d}</Text>}
                    </View>
                    <Text style={{ color: w ? t.muted : h ? t.danger : t.muted, fontSize: 12 }}>{used(w, h)}</Text>
                  </Pressable>
                );
              })}
            </Card>
          )
        ) : (
          !shownName.length ? <EmptyState icon="storefront-outline" title={s ? 'No rules match' : 'No merchant name rules yet'} text={s ? 'Try a shorter search.' : 'Rename a merchant on the Merchants page, or add a rule here.'} /> : (
            <Card style={{ padding: 0 }}>
              {shownName.map((r, i) => (
                <Pressable key={r.id} onPress={() => setEditName(r)} style={({ pressed, hovered }: any) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { backgroundColor: t.line }]}>
                  <Text style={{ color: t.text, fontSize: 15, flex: 1 }} numberOfLines={1}>“{r.match}” <Text style={{ color: t.muted }}>→</Text> {r.merchant}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{[r.source === 'learned' ? 'learned' : '', used(stats.nameWins.get(r.id) ?? 0)].filter(Boolean).join(' · ')}</Text>
                </Pressable>
              ))}
            </Card>
          )
        )}
      </ScrollView>
      <Fab label="New rule" onPress={() => (tab === 'category' ? setEditCat({}) : setEditName({ source: 'manual' }))} />
      {editCat && <CatRuleEditor t={t} initial={editCat} cats={cats} accounts={accounts} recent={recent} acctLabel={acctLabel} catLabel={catLabel} onClose={() => setEditCat(null)} onSaved={load} />}
      {editName && <NameRuleEditor t={t} initial={editName} recent={recent} onClose={() => setEditName(null)} onSaved={load} />}
    </View>
  );
}

function Line({ t, label, value, note, onPress }: { t: Theme; label: string; value: string; note: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'baseline' }}>
      <Text style={{ color: t.muted, fontSize: 12, width: 92 }}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{value}</Text>
        <Text style={{ color: onPress ? t.accent : t.muted, fontSize: 12 }}>{note}</Text>
      </View>
    </Pressable>
  );
}

function Matches({ t, list }: { t: Theme; list: Recent[] }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 12 }}>{list.length ? `Matches ${list.length} of your recent transactions, for example:` : 'Matches none of your recent transactions.'}</Text>
      {[...new Set(list.map((x) => x.name))].slice(0, 4).map((n) => <Text key={n} style={{ color: t.text, fontSize: 12 }} numberOfLines={1}>{n}</Text>)}
    </View>
  );
}

function CatRuleEditor({ t, initial, cats, accounts, recent, acctLabel, catLabel, onClose, onSaved }: {
  t: Theme; initial: Partial<CatRule>; cats: Cat[]; accounts: Acct[]; recent: Recent[]; acctLabel: (id: string | null) => string; catLabel: (id: string) => string; onClose: () => void; onSaved: () => void;
}) {
  const [text, setText] = useState(initial.match_text ?? '');
  const [categoryId, setCategoryId] = useState(initial.category_id ?? '');
  const [accountId, setAccountId] = useState<string | null>(initial.account_id ?? null);
  const [min, setMin] = useState(initial.min_amount != null ? String(initial.min_amount) : '');
  const [max, setMax] = useState(initial.max_amount != null ? String(initial.max_amount) : '');
  const [pick, setPick] = useState<'cat' | 'acct' | null>(null);
  const changed = useChanged([text, categoryId, accountId, min, max]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, confirmSheet] = useConfirm();
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const amt = (v: string) => (v.trim() ? Math.abs(parseMoney(v)) : null);
  const rule: CategoryRule = { matchText: text, categoryId, accountId, minAmount: amt(min), maxAmount: amt(max) };
  const list = normalizeDescription(text).length < 2 ? [] : recent.filter((x) => matchRule([rule], { name: x.name, merchant: x.merchant ?? '', amount: x.amount, accountId: x.account_id }));

  const save = async () => {
    if (normalizeDescription(text).length < 2) { setError('Give it at least two letters to look for (numbers are ignored).'); return; }
    if (!categoryId) { setError('Choose a category.'); return; }
    const lo = amt(min), hi = amt(max);
    if ((lo != null && isNaN(lo)) || (hi != null && isNaN(hi)) || (lo != null && hi != null && lo > hi)) { setError('Check the amounts.'); return; }
    setBusy(true);
    const row = { match_text: text.trim(), category_id: categoryId, account_id: accountId, min_amount: lo, max_amount: hi };
    const { error } = initial.id ? await supabase.from('category_rules').update(row).eq('id', initial.id) : await supabase.from('category_rules').insert(row);
    setBusy(false);
    if (error) { setError(error.message); return; }
    toast(initial.id ? 'Rule saved' : 'Rule added'); onSaved(); onClose();
  };
  const remove = () => confirm({ title: 'Delete this rule?', message: `New transactions containing “${initial.match_text}” will no longer get this category automatically. Transactions already categorized keep theirs.`, action: 'Delete', run: async () => {
    const { error } = await supabase.from('category_rules').delete().eq('id', initial.id!);
    if (error) { setError(error.message); return; }
    toast('Rule deleted'); onSaved(); onClose();
  } });

  return (
    <Sheet title={initial.id ? 'Category rule' : 'New category rule'} dirty={changed} onClose={onClose}>
      <Field t={t} label="When the text contains" hint="Checked against the merchant name and the bank’s description. Capitals and numbers don’t matter.">
        <TextInput value={text} onChangeText={setText} style={input} autoCapitalize="characters" placeholder="e.g. CRNR MKT" placeholderTextColor={t.muted} />
      </Field>
      <Field t={t} label="Use this category">
        <Pressable onPress={() => setPick('cat')} style={[styles.input, styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
          <Text style={{ color: categoryId ? t.text : t.muted, flex: 1 }}>{categoryId ? catLabel(categoryId) : 'Choose'}</Text>
          <Ionicons name="chevron-down" size={16} color={t.muted} />
        </Pressable>
      </Field>
      <Field t={t} label="Only in this account (optional)">
        <Pressable onPress={() => setPick('acct')} style={[styles.input, styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
          <Text style={{ color: accountId ? t.text : t.muted, flex: 1 }}>{accountId ? acctLabel(accountId) : 'Any account'}</Text>
          <Ionicons name="chevron-down" size={16} color={t.muted} />
        </Pressable>
      </Field>
      <Field t={t} label="Only for amounts between (optional)" hint="Compared without the sign, so 20 covers both −20 and +20.">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput value={min} onChangeText={setMin} style={[input, { flex: 1 }]} keyboardType="decimal-pad" placeholder="at least" placeholderTextColor={t.muted} />
          <Text style={{ color: t.muted }}>and</Text>
          <TextInput value={max} onChangeText={setMax} style={[input, { flex: 1 }]} keyboardType="decimal-pad" placeholder="at most" placeholderTextColor={t.muted} />
        </View>
      </Field>
      <Matches t={t} list={list} />
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Button title={initial.id ? 'Save' : 'Add rule'} onPress={save} busy={busy} style={{ marginTop: 8 }} />
      {!!initial.id && <Button title="Delete rule" kind="danger" onPress={remove} />}
      <SinglePicker visible={pick === 'cat'} title="Category" selected={categoryId || null} onClose={() => setPick(null)}
        items={cats.map((c) => ({ id: c.id, label: `${categoryIcon(c.name, c.icon)}  ${c.name}`, group: c.group_name }))} onPick={(id) => { setCategoryId(id); setPick(null); }} />
      <SinglePicker visible={pick === 'acct'} title="Account" selected={accountId ?? 'any'} onClose={() => setPick(null)}
        items={[{ id: 'any', label: 'Any account' }, ...byAccountGroup(accounts).map((a) => ({ id: a.id, label: acctLabel(a.id), group: accountGroup(a.type) }))]} onPick={(id) => { setAccountId(id === 'any' ? null : id); setPick(null); }} />
      {confirmSheet}
    </Sheet>
  );
}

function NameRuleEditor({ t, initial, recent, onClose, onSaved }: { t: Theme; initial: Partial<NameRule>; recent: Recent[]; onClose: () => void; onSaved: () => void }) {
  const [match, setMatch] = useState(initial.match ?? '');
  const [merchant, setMerchant] = useState(initial.merchant ?? '');
  const changed = useChanged([match, merchant]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, confirmSheet] = useConfirm();
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const m = normalizeDescription(match);
  const list = m.length < 3 ? [] : recent.filter((x) => normalizeDescription(x.name).includes(m));

  const save = async () => {
    if (m.length < 3) { setError('Give it at least three letters to look for (numbers are ignored).'); return; }
    if (!merchant.trim()) { setError('Enter the name to show.'); return; }
    setBusy(true);
    const row = { match: match.trim(), merchant: merchant.trim(), source: 'manual' };
    const { error } = initial.id ? await supabase.from('merchant_rules').update(row).eq('id', initial.id) : await supabase.from('merchant_rules').insert(row);
    setBusy(false);
    if (error) { setError(/duplicate|unique/i.test(error.message) ? 'There is already a rule for that text.' : error.message); return; }
    toast(initial.id ? 'Rule saved' : 'Rule added'); onSaved(); onClose();
  };
  const remove = () => confirm({ title: 'Delete this rule?', message: `New transactions containing “${initial.match}” will no longer be renamed to “${initial.merchant}”. Existing transactions keep their name.`, action: 'Delete', run: async () => {
    const { error } = await supabase.from('merchant_rules').delete().eq('id', initial.id!);
    if (error) { setError(error.message); return; }
    toast('Rule deleted'); onSaved(); onClose();
  } });

  return (
    <Sheet title={initial.id ? 'Merchant name rule' : 'New merchant name rule'} dirty={changed} onClose={onClose}>
      <Field t={t} label="When the bank’s text contains" hint="Capitals, numbers and the city at the end don’t matter.">
        <TextInput value={match} onChangeText={setMatch} style={input} autoCapitalize="characters" placeholder="e.g. CRNR MKT" placeholderTextColor={t.muted} />
      </Field>
      <Field t={t} label="Show it as">
        <TextInput value={merchant} onChangeText={setMerchant} style={input} placeholder="e.g. Corner Market" placeholderTextColor={t.muted} />
      </Field>
      {initial.source === 'learned' && !!initial.id && <Text style={{ color: t.muted, fontSize: 12 }}>This rule was learned from names you used. Saving it makes it one of your own.</Text>}
      <Matches t={t} list={list} />
      <Text style={{ color: t.muted, fontSize: 12 }}>Applies to new transactions as they arrive. To rename ones you already have, use the Merchants page.</Text>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Button title={initial.id ? 'Save' : 'Add rule'} onPress={save} busy={busy} style={{ marginTop: 8 }} />
      {!!initial.id && <Button title="Delete rule" kind="danger" onPress={remove} />}
      {confirmSheet}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 10, paddingBottom: UNDER_BAR, maxWidth: Math.min(PAGE_MAX, 760), width: '100%', alignSelf: 'center' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
});
