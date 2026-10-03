// Accounts tab: every account grouped by type, with net worth at the top. Tap one for its
// details (name, balance, history, planner settings, merge) in a pop-up.
import { useFocusLoad } from '@/lib/focusLoad';
import { accountIcon, formatMoney } from '@budget-app/core';
import { ROW, LIST } from '@/lib/layout';
import { EmptyState, RowsSkeleton } from '@/components/States';
import { usePullRefresh } from '@/lib/pullRefresh';
import { bankLogo, customPicture, useLogoVersion } from '@/lib/logos';
import { Logo } from '@/components/Logo';
import { UNDER_BAR } from '@/lib/layout';
import { PAGE_MAX } from '@/lib/layout';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { AccountSheet } from '@/components/AccountSheet';
import { IconButton, TopBar } from '@/components/TopBar';
import { Empty } from '@/components/ui';
import { callFunction, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { signedBalance, type Account } from '@/lib/types';

const GROUPS: Record<string, string> = { depository: 'Cash', credit: 'Credit cards', loan: 'Loans', investment: 'Investments' };
const ORDER = ['Cash', 'Credit cards', 'Loans', 'Investments', 'Other'];

export default function Accounts() {
  const t = useTheme();
  const lv = useLogoVersion();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // account_balances = accounts with manual balances worked out (start balance + transactions).
    const { data, error } = await supabase.from('account_balances').select('*').order('name');
    setLoading(false);
    if (error) setMsg(error.message);
    else setAccounts((data ?? []).map((a: any) => ({ ...a, current_balance: a.balance, balance_updated_at: a.balance_as_of, plan_buffer: Number(a.plan_buffer ?? 0) })) as Account[]);
  }, []);
  useFocusLoad(load);
  usePullRefresh(load);

  const syncNow = async () => {
    setSyncing(true); setMsg('');
    try {
      const r = await callFunction<{ added: number; results: { institution: string; status: string }[] }>('plaid-sync');
      const problems = r.results.filter((x) => x.status !== 'ok').map((x) => `${x.institution}: ${x.status.replace('_', ' ')}`);
      setMsg(`${r.added} new transaction(s).` + (problems.length ? ' ' + problems.join(', ') : ''));
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const visible = accounts.filter((a) => showHidden || !a.is_hidden);
  const sections = ORDER.map((title) => {
    const data = visible.filter((a) => (GROUPS[a.type ?? ''] ?? 'Other') === title);
    return { title, data, total: data.reduce((s, a) => s + signedBalance(a), 0) };
  }).filter((s) => s.data.length);
  const shownForTotal = accounts.filter((a) => !a.is_hidden);
  const assets = shownForTotal.filter((a) => signedBalance(a) > 0).reduce((s, a) => s + signedBalance(a), 0);
  const debts = shownForTotal.filter((a) => signedBalance(a) < 0).reduce((s, a) => s + signedBalance(a), 0);
  const hiddenCount = accounts.filter((a) => a.is_hidden).length;
  const open = accounts.find((a) => a.id === openId) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>NET WORTH</Text>
          <Text style={{ color: assets + debts < 0 ? t.danger : t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(assets + debts)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>Assets {formatMoney(assets)}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>Debts {formatMoney(-debts)}</Text>
        </View>
        {syncing ? <View style={styles.spinner}><ActivityIndicator color={t.accent} /></View>
          : <IconButton icon="sync" label="Sync now" onPress={syncNow} />}
      </TopBar>
      {!!msg && <Text style={{ color: t.muted, paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 }}>{msg}</Text>}
      <SectionList {...LIST} style={COLUMN} contentContainerStyle={{ paddingBottom: UNDER_BAR }}
        sections={sections}
        keyExtractor={(a) => a.id}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? <RowsSkeleton rows={6} card /> : <EmptyState icon="wallet-outline" title="No accounts yet" text="Link your bank to bring in accounts and transactions, or import a CSV file." action="Open Settings" onAction={() => router.navigate('/settings')} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.header}>
            <Text style={{ color: t.muted, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 }}>{section.title.toUpperCase()}</Text>
            <Text style={{ color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatMoney(section.total)}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <Pressable onPress={() => setOpenId(item.id)}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.line : t.card, borderColor: t.line, opacity: item.is_hidden ? 0.5 : 1 },
              index === 0 && styles.first, index === section.data.length - 1 && styles.last]}>
            <Logo size={30} name={item.name} uri={customPicture(`account:${item.id}`, lv) ?? (item.icon ? null : bankLogo(item.name, lv))} emoji={accountIcon(item.type, item.icon)} />
            <View style={{ flex: 1 }}>
              <Text style={[ROW.title, { color: t.text }]} numberOfLines={1}>{item.name}{item.mask ? <Text style={{ color: t.muted }}>{`  ••${item.mask}`}</Text> : null}</Text>
            </View>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
              {item.current_balance == null ? '—' : formatMoney(signedBalance(item))}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={hiddenCount ? (
          <Pressable onPress={() => setShowHidden(!showHidden)} style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ color: t.accent }}>{showHidden ? 'Hide' : 'Show'} {hiddenCount} hidden account{hiddenCount === 1 ? '' : 's'}</Text>
          </Pressable>
        ) : null}
      />
      <AccountSheet account={open} accounts={accounts} onClose={() => setOpenId(null)} onChanged={load} />
    </View>
  );
}

const COLUMN = { width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' } as const;
const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, marginHorizontal: 12, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  last: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  spinner: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
