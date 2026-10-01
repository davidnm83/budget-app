// Pop-up for one account, with a page that depends on its type:
//   • Overview — loans: payoff estimate, payments and interest to date; credit cards: statement,
//     what's left to pay by the due date, interest estimate, utilisation; cash: this month's
//     cash flow, the last 6 months, and what the planner has coming up. All: balance history.
//   • Details — display name, sync status, balance, card settings, planner, hide, merge.
//   • Transactions — the latest 100.
// The overview is built from small blocks so they can be reused on custom pages later.
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  accountIcon, addDays, balanceHistory, cardCycle, cardStatus, expandPlan, formatMoney, loanSummary, monthName,
  monthlyFlow, shortDate, todayIn, utilization,
} from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bar, Button, Chip, Segmented } from '@/components/ui';
import { mergeAccounts } from '@/lib/mergeAccounts';
import { loadEntries, loadRecurring } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { signedBalance, type Account } from '@/lib/types';
import { afterClose, useBackToClose } from '@/lib/useBackToClose';

const today = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
type Txn = { date: string; amount: number; name: string };

export function statusLine(a: Account): string {
  const ago = (iso: string | null) => {
    if (!iso) return '';
    const h = (Date.now() - new Date(iso).getTime()) / 36e5;
    return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
  };
  const parts = [a.kind === 'plaid' ? `Synced ${ago(a.balance_updated_at)}`.trim() : a.current_balance == null ? 'Manual · no balance yet' : 'Manual · auto balance'];
  if (a.plan_include) parts.push('in planner');
  if (a.is_hidden) parts.push('hidden');
  return parts.join(' · ');
}

export function AccountSheet({ account, accounts, onClose, onChanged }: {
  account: Account | null; accounts: Account[]; onClose: () => void; onChanged: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'overview' | 'details' | 'txns'>('overview');
  const [history, setHistory] = useState<Txn[] | null>(null);
  const [list, setList] = useState<{ id: string; date: string; amount: number; display_name: string; category_name: string | null }[]>([]);
  useBackToClose(!!account, onClose);

  useEffect(() => {
    if (!account) return;
    setTab('overview'); setHistory(null); setList([]);
    (async () => {
      // Loans: all history (payments and interest to date). Others: the past year.
      const from = new Date(); from.setFullYear(from.getFullYear() - 1);
      const all: Txn[] = [];
      for (let p = 0; ; p += 1000) {
        let q = supabase.from('transactions').select('date, amount, name').eq('account_id', account.id);
        if (account.type !== 'loan') q = q.gte('date', from.toISOString().slice(0, 10));
        const { data } = await q.order('date', { ascending: false }).range(p, p + 999);
        all.push(...(data ?? []).map((r) => ({ date: r.date, amount: Number(r.amount), name: r.name })));
        if (!data || data.length < 1000) break;
      }
      setHistory(all);
      const { data } = await supabase.from('transaction_list').select('id, date, amount, display_name, category_name')
        .eq('account_id', account.id).order('date', { ascending: false }).limit(100);
      setList((data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })));
    })();
  }, [account?.id]);

  if (!account) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        <View style={[styles.head, { borderColor: t.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{account.name}{account.mask ? ` ••${account.mask}` : ''}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{statusLine(account)}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Ionicons name="close" size={26} color={t.text} /></Pressable>
        </View>
        <View style={{ padding: 12 }}>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'details', label: 'Details' }, { value: 'txns', label: 'Transactions' }]} />
        </View>
        {tab === 'overview' && (
          <ScrollView contentContainerStyle={styles.page}>
            <View>
              <Text style={{ color: t.muted, fontSize: 11 }}>{account.type === 'credit' || account.type === 'loan' ? 'OWING' : 'BALANCE'}</Text>
              <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {account.current_balance == null ? '—' : formatMoney(Math.abs(signedBalance(account)))}
              </Text>
            </View>
            {history == null ? <Text style={{ color: t.muted }}>Loading…</Text> : (
              <>
                {account.type === 'loan' && <LoanBlock t={t} a={account} txns={history} />}
                {account.type === 'credit' && <CardBlock t={t} a={account} txns={history} onSetUp={() => setTab('details')} />}
                {account.type === 'depository' && <CashBlock t={t} a={account} txns={history} onClose={onClose} />}
                {account.current_balance != null && history.length > 0 && (
                  <BalanceChart t={t} points={balanceHistory(signedBalance(account), history.filter((x) => x.date >= addDays(today(), -371)), today(), 53, 7)} />
                )}
              </>
            )}
          </ScrollView>
        )}
        {tab === 'details' && <DetailsTab t={t} account={account} accounts={accounts} onChanged={onChanged} onClose={onClose} />}
        {tab === 'txns' && (
          <FlatList
            data={list}
            keyExtractor={(r) => r.id}
            ListFooterComponent={list.length >= 100 ? <Button title="See all in Transactions" kind="plain" style={{ margin: 16 }} onPress={() => { onClose(); afterClose(() => router.navigate('/transactions' as any)); }} /> : null}
            renderItem={({ item }) => (
              <Pressable onPress={() => { onClose(); afterClose(() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })); }}
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

// ───────────────────────── overview blocks ─────────────────────────
export function Tile({ t, label, value, sub, warn }: { t: Theme; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: warn ? t.danger : t.line }]}>
      <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: warn ? t.danger : t.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 10 }} numberOfLines={2}>{sub}</Text>}
    </View>
  );
}

const Section = ({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) => (
  <View style={{ gap: 6 }}>
    <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>{title.toUpperCase()}</Text>
    {children}
  </View>
);

/** Loans (LOAN-2, LOAN-3): payoff estimate from the last 2 months, plus totals to date. */
export function LoanBlock({ t, a, txns }: { t: Theme; a: Account; txns: Txn[] }) {
  const owed = Math.abs(signedBalance(a));
  const s = loanSummary(owed, txns, today());
  const years = s.monthsLeft != null ? `${Math.floor(s.monthsLeft / 12)}y ${s.monthsLeft % 12}m` : '';
  return (
    <>
      <Section t={t} title="Payoff estimate">
        {s.status === 'ok' && (
          <View style={styles.tiles}>
            <Tile t={t} label="Paid off" value={monthName(s.payoffDate!.slice(0, 7) + '-01')} sub={`${s.monthsLeft} months (${years})`} />
            <Tile t={t} label="Interest still to pay" value={money0(s.interestLeft!)} sub="at the current pace" />
          </View>
        )}
        {s.status === 'paid-off' && <Text style={{ color: t.text }}>Paid off.</Text>}
        {s.status === 'not-enough-history' && <Text style={{ color: t.muted }}>Not enough data yet: the estimate needs 2 months of payments and interest on this account.</Text>}
        {s.status === 'payments-dont-cover' && <Text style={{ color: t.danger }}>Recent payments don't cover the interest, so the balance isn't going down.</Text>}
        {s.perMonth && (
          <View style={styles.tiles}>
            <Tile t={t} label="Payment / month" value={money0(s.perMonth.payment)} />
            <Tile t={t} label="Interest / month" value={money0(s.perMonth.interest)} />
            <Tile t={t} label="Principal / month" value={money0(s.perMonth.principal)} />
          </View>
        )}
        <Text style={{ color: t.muted, fontSize: 11 }}>Averages of the last 2 months. Months left = −ln(1 − rB/P) ÷ ln(1 + r), with B owed, P payment, r monthly interest ÷ balance.</Text>
      </Section>
      <Section t={t} title={`To date${s.since ? ` (since ${shortDate(s.since)} ${s.since.slice(0, 4)})` : ''}`}>
        <View style={styles.tiles}>
          <Tile t={t} label="Payments" value={money0(s.paymentsToDate)} />
          <Tile t={t} label="Interest" value={money0(s.interestToDate)} />
          <Tile t={t} label="Principal paid" value={money0(s.paymentsToDate - s.interestToDate)} />
        </View>
      </Section>
    </>
  );
}

/** Credit cards: statement and due date, interest estimate, utilisation. */
export function CardBlock({ t, a, txns, onSetUp }: { t: Theme; a: Account; txns: Txn[]; onSetUp: () => void }) {
  const owed = Math.max(0, -signedBalance(a));
  const u = utilization(owed, a.credit_limit);
  const set = a.statement_day && a.due_day;
  const cycle = set ? cardCycle(today(), a.statement_day!, a.due_day!) : null;
  const st = cycle ? cardStatus(owed, txns, cycle.lastClose, cycle.cycleDays, a.apr ?? null) : null;
  return (
    <>
      <Section t={t} title="Utilisation">
        {u == null ? <Text style={{ color: t.muted }}>Add the card's limit in Details to see how much of it you're using.</Text> : (
          <>
            <View style={styles.between}>
              <Text style={{ color: u > 0.7 ? t.danger : t.text, fontWeight: '700' }}>{Math.round(u * 100)}% used{u > 0.7 ? ' · high' : u > 0.3 ? ' · above 30%' : ''}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{money0(owed)} of {money0(a.credit_limit!)} · {money0(a.credit_limit! - owed)} available</Text>
            </View>
            <Bar value={owed} max={a.credit_limit!} color={u > 0.7 ? t.danger : u > 0.3 ? t.series2 : t.accent} />
            <Text style={{ color: t.muted, fontSize: 11 }}>Under 30% is generally better for your credit score.</Text>
          </>
        )}
      </Section>
      <Section t={t} title="Statement">
        {!cycle || !st ? (
          <Pressable onPress={onSetUp}><Text style={{ color: t.accent }}>Set the statement closing day, due day and interest rate in Details to see what's due and what interest would cost.</Text></Pressable>
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile t={t} label="Left to pay" value={formatMoney(st.leftToPay)} warn={st.leftToPay > 0 && cycle.daysToDue <= 3}
                sub={st.leftToPay > 0 ? `by ${shortDate(cycle.due)} (${cycle.daysToDue < 0 ? `${-cycle.daysToDue}d ago` : `in ${cycle.daysToDue}d`})` : 'statement paid'} />
              <Tile t={t} label="Last statement" value={formatMoney(st.statementOwed)} sub={`closed ${shortDate(cycle.lastClose)} · paid ${money0(st.paidSince)}`} />
              <Tile t={t} label="This cycle" value={formatMoney(st.spentThisCycle)} sub={`closes ${shortDate(cycle.nextClose)}`} />
            </View>
            {st.interestIfUnpaid != null ? (
              <Text style={{ color: st.leftToPay > 0 ? t.text : t.muted, fontSize: 13 }}>
                {st.leftToPay > 0
                  ? <>If the {formatMoney(st.leftToPay)} isn't paid by {shortDate(cycle.due)}, expect about <Text style={{ fontWeight: '700' }}>{formatMoney(st.interestIfUnpaid)}</Text> interest next statement (at {a.apr}%).</>
                  : `Nothing owing from the last statement, so no interest so far this cycle.`}
              </Text>
            ) : <Pressable onPress={onSetUp}><Text style={{ color: t.accent, fontSize: 13 }}>Add the interest rate in Details for an interest estimate.</Text></Pressable>}
            <Text style={{ color: t.muted, fontSize: 11 }}>Estimate: daily interest on what's left plus about half of this cycle's spending, for one cycle. Your statement is the final word.</Text>
          </>
        )}
      </Section>
    </>
  );
}

/** Cash accounts: cash flow and what the planner has coming up. */
function CashBlock({ t, a, txns, onClose }: { t: Theme; a: Account; txns: Txn[]; onClose: () => void }) {
  const now = today();
  const flow = monthlyFlow(txns, now, 6);
  const thisMonth = flow[flow.length - 1];
  const max = Math.max(1, ...flow.flatMap((f) => [f.in, f.out]));
  const [coming, setComing] = useState<{ date: string; description: string; amount: number; balance: number }[] | null>(null);
  useEffect(() => {
    (async () => {
      const end = addDays(now, 30);
      const [rec, ent] = await Promise.all([loadRecurring(), loadEntries(addDays(now, -31), addDays(end, 31))]);
      let bal = signedBalance(a);
      setComing(expandPlan(rec, ent, addDays(now, 1), end).filter((p) => p.accountId === a.id)
        .map((p) => { bal += p.amount; return { date: p.date, description: p.description, amount: p.amount, balance: bal }; }));
    })();
  }, [a.id]);
  const lowest = coming?.length ? coming.reduce((m, c) => (c.balance < m.balance ? c : m)) : null;
  return (
    <>
      <Section t={t} title={`Cash flow · ${monthName(thisMonth.month)}`}>
        <View style={styles.tiles}>
          <Tile t={t} label="In" value={money0(thisMonth.in)} />
          <Tile t={t} label="Out" value={money0(thisMonth.out)} />
          <Tile t={t} label="Net" value={`${thisMonth.in - thisMonth.out < 0 ? '−' : '+'}${money0(Math.abs(thisMonth.in - thisMonth.out))}`} warn={thisMonth.in - thisMonth.out < 0} />
        </View>
        <View style={[styles.between, { justifyContent: 'flex-start', gap: 12 }]}>
          <Legend t={t} color={t.series1} label="In" /><Legend t={t} color={t.series2} label="Out" />
        </View>
        {flow.map((f) => (
          <View key={f.month} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: t.muted, width: 32, fontSize: 12 }}>{monthName(f.month, false).slice(0, 3)}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Bar value={f.in} max={max} color={t.series1} height={5} />
              <Bar value={f.out} max={max} color={t.series2} height={5} />
            </View>
            <Text style={{ color: f.in - f.out < 0 ? t.danger : t.muted, width: 64, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] }}>
              {f.in - f.out < 0 ? '−' : '+'}{money0(Math.abs(f.in - f.out))}
            </Text>
          </View>
        ))}
      </Section>
      <Section t={t} title="Coming up (next 30 days)">
        {coming == null ? <Text style={{ color: t.muted }}>Loading…</Text> : !coming.length ? (
          <Text style={{ color: t.muted }}>Nothing planned from this account. Add bills under Bills & income, or plan entries in the Planner.</Text>
        ) : (
          <>
            {lowest && (
              <Text style={{ color: lowest.balance < Number(a.plan_buffer ?? 0) ? t.danger : t.text, fontSize: 13 }}>
                Lowest point: {formatMoney(lowest.balance)} on {shortDate(lowest.date)}{lowest.balance < Number(a.plan_buffer ?? 0) ? ` (below your ${money0(Number(a.plan_buffer))} buffer)` : ''}
              </Text>
            )}
            {coming.slice(0, 8).map((c, i) => (
              <View key={i} style={[styles.between, { paddingVertical: 2 }]}>
                <Text style={{ color: t.muted, width: 48, fontSize: 12 }}>{shortDate(c.date)}</Text>
                <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{c.description}</Text>
                <Text style={{ color: c.amount > 0 ? t.positive : t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{formatMoney(c.amount)}</Text>
                <Text style={{ color: c.balance < 0 ? t.danger : t.muted, width: 80, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatMoney(c.balance)}</Text>
              </View>
            ))}
            <Pressable onPress={() => { onClose(); afterClose(() => router.navigate('/planner')); }}><Text style={{ color: t.accent, fontSize: 13 }}>Open the Planner</Text></Pressable>
          </>
        )}
      </Section>
    </>
  );
}

const Legend = ({ t, color, label }: { t: Theme; color: string; label: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} /><Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
  </View>
);

// ───────────────────────── details ─────────────────────────
function DetailsTab({ t, account, accounts, onChanged, onClose }: { t: Theme; account: Account; accounts: Account[]; onChanged: () => void; onClose: () => void }) {
  const [name, setName] = useState(account.name);
  const [balance, setBalance] = useState('');
  const [card, setCard] = useState({
    credit_limit: account.credit_limit != null ? String(account.credit_limit) : '',
    statement_day: account.statement_day ? String(account.statement_day) : '',
    due_day: account.due_day ? String(account.due_day) : '',
    apr: account.apr != null ? String(account.apr) : '',
  });
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [payMatch, setPayMatch] = useState(account.loan_payment_match ?? '');
  const [payFrom, setPayFrom] = useState<string | null>(account.loan_paying_account_id ?? null);
  const [icon, setIcon] = useState(account.icon ?? '');
  const owed = account.type === 'credit' || account.type === 'loan';
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];

  // `key` names the button that saved, so it can show "Saved ✓" for a moment.
  const [flash, setFlash] = useState<string | null>(null);
  const done = (key: string) => { setFlash(key); setTimeout(() => setFlash((f) => (f === key ? null : f)), 2500); };
  const save = async (patch: Record<string, unknown>, note = 'Saved.', key = 'other') => {
    const { error } = await supabase.from('accounts').update(patch).eq('id', account.id);
    setMsg(error ? error.message : note);
    if (!error) { done(key); onChanged(); }
  };
  const label = (key: string, title: string) => (flash === key ? 'Saved ✓' : title);
  const saveBalance = async () => {
    const v = Number(balance.replace(/[$,\s]/g, ''));
    if (!balance.trim() || isNaN(v)) return;
    const { error } = await supabase.rpc('set_balance_today', { p_account: account.id, p_balance: owed ? -Math.abs(v) : v });
    setMsg(error ? error.message : 'Balance updated.'); setBalance('');
    if (!error) { done('balance'); onChanged(); }
  };
  const saveCard = () => {
    const num = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '')) : null);
    const day = (s: string) => { const n = num(s); return n && n >= 1 && n <= 31 ? Math.round(n) : null; };
    save({ credit_limit: num(card.credit_limit), statement_day: day(card.statement_day), due_day: day(card.due_day), apr: num(card.apr) }, 'Card details saved.', 'card');
  };
  const merge = async () => {
    if (!mergeTarget) return;
    setBusy(true);
    try {
      const r = await mergeAccounts(account.id, mergeTarget);
      setMsg(`Merged: ${r.linked} matched, ${r.split} rebuilt as splits, ${r.moved} older moved over.`);
      onChanged(); onClose();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Field t={t} label="Icon and display name">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={icon} onChangeText={(v) => setIcon(v.trim().slice(0, 8))} placeholder={accountIcon(account.type, null)} style={[input, { width: 56, textAlign: 'center', fontSize: 20 }]} />
          <TextInput value={name} onChangeText={setName} style={[input, { flex: 1 }]} />
          <Button title={label('name', 'Save')} kind="plain" disabled={flash !== 'name' && (!name.trim() || (name === account.name && icon === (account.icon ?? '')))} onPress={() => save({ name: name.trim(), icon: icon || null }, 'Saved.', 'name')} />
        </View>
        {!!account.official_name && account.official_name !== account.name && <Text style={{ color: t.muted, fontSize: 12 }}>The bank calls it {account.official_name}</Text>}
      </Field>

      <Field t={t} label="Status">
        <Text style={{ color: t.text }}>{statusLine(account)}</Text>
        {account.balance_updated_at && <Text style={{ color: t.muted, fontSize: 12 }}>Balance as of {new Date(account.balance_updated_at).toLocaleString()}</Text>}
      </Field>

      {account.kind === 'manual' && (
        <Field t={t} label={owed ? 'Amount owing today' : 'Balance today'}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder={account.current_balance == null ? '' : String(Math.abs(Number(account.current_balance)))}
              placeholderTextColor={t.muted} onSubmitEditing={saveBalance} style={[input, { flex: 1 }]} />
            <Button title={label('balance', 'Update')} kind="plain" disabled={flash !== 'balance' && !balance.trim()} onPress={saveBalance} />
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>After this, new transactions keep the balance current on their own.</Text>
        </Field>
      )}

      {account.type === 'loan' && (
        <Field t={t} label="Payments and interest">
          <Text style={{ color: t.muted, fontSize: 12 }}>
            Payments to this loan are copied from the account that pays it: debits whose description contains the text below.
            {account.kind === 'plaid' ? ' Interest is logged when the bank’s balance drops after a payment.' : ' (Interest is logged automatically for connected loans only.)'}
          </Text>
          <TextInput value={payMatch} onChangeText={setPayMatch} autoCapitalize="characters" placeholder="e.g. TD ON-LINE LOANS" placeholderTextColor={t.muted} style={input} />
          <View style={styles.chips}>
            <Chip label="Any account" on={!payFrom} onPress={() => setPayFrom(null)} />
            {accounts.filter((a) => a.type === 'depository').map((a) => <Chip key={a.id} label={a.name} on={payFrom === a.id} onPress={() => setPayFrom(a.id)} />)}
          </View>
          <Button title={label('loan', 'Save')} kind="plain" onPress={() => save({ loan_payment_match: payMatch.trim() || null, loan_paying_account_id: payFrom }, 'Saved. Payments are copied on the next sync.', 'loan')} />
          {account.loan_last_balance_date && (
            <Text style={{ color: t.muted, fontSize: 12 }}>Interest last worked out on {shortDate(account.loan_last_balance_date)} at {formatMoney(Number(account.loan_last_balance))} owing.</Text>
          )}
        </Field>
      )}

      {account.type === 'credit' && (
        <Field t={t} label="Card details">
          <View style={styles.grid}>
            <Small t={t} label="Credit limit $" value={card.credit_limit} onChange={(v) => setCard({ ...card, credit_limit: v })} />
            <Small t={t} label="Interest rate %" value={card.apr} onChange={(v) => setCard({ ...card, apr: v })} />
            <Small t={t} label="Statement closes on day" value={card.statement_day} onChange={(v) => setCard({ ...card, statement_day: v })} />
            <Small t={t} label="Payment due on day" value={card.due_day} onChange={(v) => setCard({ ...card, due_day: v })} />
          </View>
          <Button title={label('card', 'Save card details')} kind="plain" onPress={saveCard} />
          <Text style={{ color: t.muted, fontSize: 12 }}>The limit fills in from the bank when it reports one. Days are days of the month (e.g. 20 and 10).</Text>
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
                style={[input, { width: 100, textAlign: 'right' }]} />
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
  );
}

const Field = ({ t, label, children }: { t: Theme; label: string; children: React.ReactNode }) => (
  <View style={{ gap: 6 }}>
    <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    {children}
  </View>
);

const Small = ({ t, label, value, onChange }: { t: Theme; label: string; value: string; onChange: (v: string) => void }) => (
  <View style={{ flexBasis: '47%', flexGrow: 1, gap: 4 }}>
    <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
  </View>
);

/** Weekly balance for the past year as a thin-column area, low to high, with the range labelled. */
export function BalanceChart({ t, points, title = 'BALANCE, PAST YEAR' }: { t: Theme; points: { date: string; balance: number }[]; title?: string }) {
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
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>{title}</Text>
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
  page: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 90, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  chart: { flex: 1, height: 100, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1 },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});

