// Pop-up for one account: Details (display name, balance, balance history, planner settings,
// hide, merge) and its recent Transactions.
import Ionicons from '@expo/vector-icons/Ionicons';
import { balanceHistory, formatMoney, shortDate, todayIn } from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Segmented } from '@/components/ui';
import { mergeAccounts } from '@/lib/mergeAccounts';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { signedBalance, type Account } from '@/lib/types';

const today = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export function AccountSheet({ account, accounts, onClose, onChanged }: {
  account: Account | null; accounts: Account[]; onClose: () => void; onChanged: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'details' | 'txns'>('details');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [txns, setTxns] = useState<{ id: string; date: string; amount: number; display_name: string; category_name: string | null }[]>([]);
  const [history, setHistory] = useState<{ date: string; balance: number }[]>([]);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!account) return;
    setTab('details'); setName(account.name); setBalance(''); setMsg(''); setMergeTarget(null); setHistory([]); setTxns([]);
    (async () => {
      // A year of amounts for the history chart (balance now, minus what came after each week).
      const from = new Date(); from.setFullYear(from.getFullYear() - 1);
      const all: { date: string; amount: number }[] = [];
      for (let p = 0; ; p += 1000) {
        const { data } = await supabase.from('transactions').select('date, amount').eq('account_id', account.id)
          .gte('date', from.toISOString().slice(0, 10)).order('date', { ascending: false }).range(p, p + 999);
        all.push(...(data ?? []).map((r) => ({ date: r.date, amount: Number(r.amount) })));
        if (!data || data.length < 1000) break;
      }
      if (account.current_balance != null) setHistory(balanceHistory(signedBalance(account), all, today(), 53, 7));
      const { data } = await supabase.from('transaction_list').select('id, date, amount, display_name, category_name')
        .eq('account_id', account.id).order('date', { ascending: false }).limit(100);
      setTxns((data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })));
    })();
  }, [account?.id]);

  if (!account) return null;
  const owed = account.type === 'credit' || account.type === 'loan';
  const save = async (patch: Record<string, unknown>, note = 'Saved.') => {
    const { error } = await supabase.from('accounts').update(patch).eq('id', account.id);
    setMsg(error ? error.message : note);
    if (!error) onChanged();
  };
  const saveBalance = async () => {
    const v = Number(balance.replace(/[$,\s]/g, ''));
    if (!balance.trim() || isNaN(v)) return;
    const { error } = await supabase.rpc('set_balance_today', { p_account: account.id, p_balance: owed ? -Math.abs(v) : v });
    setMsg(error ? error.message : 'Balance updated.'); setBalance('');
    if (!error) onChanged();
  };
  const merge = async () => {
    if (!mergeTarget) return;
    setBusy(true);
    try {
      const r = await mergeAccounts(account.id, mergeTarget);
      onChanged(); onClose();
      setTimeout(() => alertMsg(`Merged: ${r.linked} matched, ${r.split} rebuilt as splits, ${r.moved} older moved over.`), 0);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        <View style={[styles.head, { borderColor: t.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{account.name}{account.mask ? ` ••${account.mask}` : ''}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{account.kind === 'plaid' ? 'Connected to the bank' : 'Manual · auto balance'}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Ionicons name="close" size={26} color={t.text} /></Pressable>
        </View>
        <View style={{ padding: 12 }}>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'details', label: 'Details' }, { value: 'txns', label: 'Transactions' }]} />
        </View>

        {tab === 'details' ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>{account.current_balance == null ? '—' : formatMoney(signedBalance(account))}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {account.balance_updated_at ? `As of ${new Date(account.balance_updated_at).toLocaleString()}` : 'No balance yet'}
              </Text>
            </View>
            {history.length > 1 && <BalanceChart t={t} points={history} />}

            <Field t={t} label="Display name">
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={name} onChangeText={setName} style={[styles.input, { flex: 1, color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
                <Button title="Save" kind="plain" disabled={!name.trim() || name === account.name} onPress={() => save({ name: name.trim() }, 'Name saved.')} />
              </View>
              {!!account.official_name && account.official_name !== account.name && (
                <Text style={{ color: t.muted, fontSize: 12 }}>The bank calls it {account.official_name}</Text>
              )}
            </Field>

            {account.kind === 'manual' && (
              <Field t={t} label={owed ? 'Amount owing today' : 'Balance today'}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder={account.current_balance == null ? '' : String(Math.abs(Number(account.current_balance)))}
                    placeholderTextColor={t.muted} onSubmitEditing={saveBalance} style={[styles.input, { flex: 1, color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
                  <Button title="Update" kind="plain" disabled={!balance.trim()} onPress={saveBalance} />
                </View>
                <Text style={{ color: t.muted, fontSize: 12 }}>After this, new transactions keep the balance current on their own.</Text>
              </Field>
            )}

            {account.type === 'depository' && (
              <Field t={t} label="Weekly planner">
                <View style={styles.between}>
                  <Text style={{ color: t.text, flex: 1 }}>Plan bills from this account</Text>
                  <Switch value={!!account.plan_include} onValueChange={(v) => save({ plan_include: v })} />
                </View>
                {account.plan_include && (
                  <View style={styles.between}>
                    <Text style={{ color: t.text, flex: 1 }}>Warn below</Text>
                    <TextInput defaultValue={String(account.plan_buffer ?? 0)} keyboardType="decimal-pad"
                      onEndEditing={(e) => save({ plan_buffer: Number(e.nativeEvent.text) || 0 })}
                      onBlur={(e: any) => { const v = Number(e?.target?.value); if (!isNaN(v)) save({ plan_buffer: v }); }}
                      style={[styles.input, { width: 100, textAlign: 'right', color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
                  </View>
                )}
              </Field>
            )}

            <Field t={t} label="Visibility">
              <View style={styles.between}>
                <Text style={{ color: t.text, flex: 1 }}>Hide this account (history stays in reports)</Text>
                <Switch value={account.is_hidden} onValueChange={(v) => save({ is_hidden: v }, v ? 'Hidden.' : 'Shown.')} />
              </View>
            </Field>

            {account.kind === 'manual' && accounts.some((a) => a.kind === 'plaid') && (
              <Field t={t} label="Merge into a connected account">
                <Text style={{ color: t.muted, fontSize: 12 }}>For when this card or account is now linked to the bank. Matching transactions are combined, older ones move over.</Text>
                <View style={styles.chips}>
                  {accounts.filter((a) => a.kind === 'plaid').sort((a, b) => Number(b.type === account.type) - Number(a.type === account.type)).map((a) => (
                    <Chip key={a.id} label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`} on={mergeTarget === a.id} onPress={() => setMergeTarget(mergeTarget === a.id ? null : a.id)} />
                  ))}
                </View>
                {mergeTarget && <Button kind="danger" busy={busy} onPress={merge} title={`Merge into ${accounts.find((a) => a.id === mergeTarget)?.name} (can't be undone)`} />}
              </Field>
            )}
            {!!msg && <Text style={{ color: t.muted }}>{msg}</Text>}
          </ScrollView>
        ) : (
          <FlatList
            data={txns}
            keyExtractor={(r) => r.id}
            ListFooterComponent={txns.length >= 100 ? (
              <Button title="See all in Transactions" kind="plain" style={{ margin: 16 }} onPress={() => { onClose(); router.navigate('/'); }} />
            ) : null}
            renderItem={({ item }) => (
              <Pressable onPress={() => { onClose(); router.push({ pathname: '/transaction/[id]', params: { id: item.id } }); }}
                style={[styles.txn, { borderColor: t.line, backgroundColor: t.card }]}>
                <Text style={{ color: t.muted, width: 52, fontSize: 13 }}>{shortDate(item.date)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text }} numberOfLines={1}>{item.display_name}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{item.category_name ?? 'Uncategorised'}</Text>
                </View>
                <Text style={{ color: item.amount > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(item.amount)}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

function alertMsg(m: string) {
  if (typeof window !== 'undefined' && window.alert) window.alert(m);
}

const Field = ({ t, label, children }: { t: Theme; label: string; children: React.ReactNode }) => (
  <View style={{ gap: 6 }}>
    <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    {children}
  </View>
);

/** Weekly balance for the past year as a thin-column area, low to high, with the range labelled. */
function BalanceChart({ t, points }: { t: Theme; points: { date: string; balance: number }[] }) {
  const { lo, hi } = useMemo(() => {
    const vs = points.map((p) => p.balance);
    const min = Math.min(...vs), max = Math.max(...vs);
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1;
    return { lo: min - pad, hi: max + pad };
  }, [points]);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover == null ? points[points.length - 1] : points[hover];
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.between}>
        <Text style={{ color: t.muted, fontSize: 12 }}>Balance, past year (weekly)</Text>
        <Text style={{ color: t.text, fontSize: 12, fontVariant: ['tabular-nums'] }}>{shortDate(shown.date)} {shown.date.slice(0, 4)} · {formatMoney(shown.balance)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={[styles.chart, { borderColor: t.line }]}>
          {points.map((p, i) => (
            <Pressable key={p.date} onHoverIn={() => setHover(i)} onHoverOut={() => setHover(null)} onPressIn={() => setHover(i)}
              style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              <View style={{ height: `${Math.max(2, ((p.balance - lo) / (hi - lo)) * 100)}%`, backgroundColor: hover === i ? t.accent : t.series1, opacity: hover === i ? 1 : 0.8, marginHorizontal: 0.5, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
            </Pressable>
          ))}
        </View>
        <View style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: t.muted, fontSize: 11 }}>{money0(hi)}</Text>
          <Text style={{ color: t.muted, fontSize: 11 }}>{money0(lo)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chart: { flex: 1, height: 110, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1 },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
