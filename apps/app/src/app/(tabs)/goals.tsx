// Goals (GOAL-1): saving up to an amount (from an account's balance or money you mark for it) or
// paying a loan or card down to nothing, each with an optional date. A fund that refills each year
// (IDEA-7: insurance, car repairs, gifts) is a savings goal whose date moves on a year once it passes.
import { formatMoney, parseMoney, shortDate, toIsoDate } from '@budget-app/core';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { EmojiField } from '@/components/EmojiPicker';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { EmptyState, PageSkeleton } from '@/components/States';
import { GoalCard } from '@/components/GoalCard';
import { Bar, Button, Card, Chip, Fab, Segmented } from '@/components/ui';
import { useFocusLoad } from '@/lib/focusLoad';
import { addGoalEntry, loadGoals, owedOn, type Goal } from '@/lib/goals';
import { PAGE_MAX, UNDER_BAR } from '@/lib/layout';
import { today } from '@/lib/plan';
import { usePullRefresh } from '@/lib/pullRefresh';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { deleteWithUndo, toast } from '@/lib/toast';
import { signedBalance, type Account } from '@/lib/types';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export default function Goals() {
  const t = useTheme();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const [moving, setMoving] = useState<{ goal: Goal; dir: 1 | -1 } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const load = useCallback(async () => {
    try { const r = await loadGoals(); setGoals(r.goals); setAccounts(r.accounts); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setGoals([]); }
  }, []);
  useFocusLoad(load);
  usePullRefresh(load);

  const open = (goals ?? []).filter((g) => !g.closed_on);
  const done = (goals ?? []).filter((g) => g.closed_on);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {goals == null ? <PageSkeleton tiles={0} cards={3} /> : !open.length && !done.length ? (
          <EmptyState icon="flag-outline" title="No goals yet"
            text="Save up for something, build a fund that refills each year (insurance, car repairs, gifts), or set a date to pay off a loan or card."
            action="New goal" onAction={() => setEditing({})} />
        ) : null}
        {open.map((g) => <GoalCard key={g.id} t={t} g={g} onPress={() => setEditing(g)} onMove={(dir) => setMoving({ goal: g, dir })} />)}
        {done.length > 0 && (
          <Pressable onPress={() => setShowDone(!showDone)} hitSlop={6}>
            <Text style={{ color: t.muted, fontWeight: '600', marginTop: 8 }}>{showDone ? '▾' : '▸'} Done ({done.length})</Text>
          </Pressable>
        )}
        {showDone && done.map((g) => <GoalCard key={g.id} t={t} g={g} onPress={() => setEditing(g)} />)}
      </ScrollView>
      <Fab label="New goal" onPress={() => setEditing({})} />
      {editing && <GoalSheet initial={editing} accounts={accounts} onClose={() => setEditing(null)} onSaved={load} />}
      {moving && <MoneySheet goal={moving.goal} dir={moving.dir} onClose={() => setMoving(null)} onSaved={load} />}
    </View>
  );
}

function MoneySheet({ goal, dir, onClose, onSaved }: { goal: Goal; dir: 1 | -1; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const save = async () => {
    const a = parseMoney(amount);
    if (isNaN(a) || a <= 0) { setError('Enter an amount.'); return; }
    try { await addGoalEntry(goal.id, dir * Math.abs(a), note.trim() || null); toast(dir > 0 ? `${money0(a)} added` : `${money0(a)} spent from ${goal.name}`); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Sheet title={dir > 0 ? `Add to ${goal.name}` : `Spend from ${goal.name}`} fit dirty={!!amount} onClose={onClose} footer={<Button title="Save" onPress={save} />}>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {dir > 0 ? 'Money you set aside for this goal. It stays in your accounts; this keeps count of what is meant for it.' : 'What you paid for out of this fund, so it shows what’s left until it refills.'}
      </Text>
      <Field t={t} label="Amount"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} autoFocus /></Field>
      <Field t={t} label="Note (optional)"><TextInput value={note} onChangeText={setNote} placeholder={dir > 0 ? 'e.g. September' : 'e.g. Brake pads'} placeholderTextColor={t.muted} style={input} /></Field>
      {goal.entries.length > 0 && (
        <Field t={t} label="Recent">
          {goal.entries.slice(0, 6).map((e) => (
            <View key={e.id} style={styles.between}>
              <Text style={{ color: t.muted, fontSize: 13 }}>{shortDate(e.date)}{e.note ? ` · ${e.note}` : ''}</Text>
              <Text style={{ color: e.amount < 0 ? t.text : t.positive, fontSize: 13, fontVariant: ['tabular-nums'] }}>{e.amount > 0 ? '+' : ''}{formatMoney(e.amount)}</Text>
            </View>
          ))}
        </Field>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

function GoalSheet({ initial, accounts, onClose, onSaved }: { initial: Partial<Goal>; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [kind, setKind] = useState<'save' | 'payoff'>(initial.kind ?? 'save');
  const [name, setName] = useState(initial.name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [target, setTarget] = useState(initial.target ? String(initial.target) : '');
  const [date, setDate] = useState(initial.target_date ?? '');
  const [accountId, setAccountId] = useState<string | null>(initial.account_id ?? null);
  const [refills, setRefills] = useState(!!initial.refills);
  const [error, setError] = useState('');
  const changed = useChanged([kind, name, icon, target, date, accountId, refills]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const visible = accounts.filter((a) => !a.is_hidden);
  const savings = visible.filter((a) => a.type === 'depository' || a.type === 'investment');
  const debts = visible.filter((a) => a.type === 'loan' || a.type === 'credit');
  const exists = !!initial.id;

  const save = async () => {
    const d = date.trim() ? toIsoDate(date) : null;
    if (!name.trim()) { setError('Give the goal a name.'); return; }
    if (date.trim() && !d) { setError('That date isn’t a date.'); return; }
    if (refills && !d) { setError('A fund that refills each year needs the date it’s for.'); return; }
    let row: Record<string, unknown>;
    if (kind === 'save') {
      const a = parseMoney(target);
      if (isNaN(a) || a <= 0) { setError('Enter the amount to save.'); return; }
      const acct = visible.find((x) => x.id === accountId);
      // Counting an account: progress starts from its balance today (only when the goal is new or the account changed).
      const startValue = acct && (!exists || initial.account_id !== accountId) ? Math.max(0, signedBalance(acct)) : exists ? initial.start_value ?? 0 : 0;
      row = { kind, name: name.trim(), icon: icon || null, target: a, target_date: d, account_id: acct?.id ?? null, refills, start_value: refills ? 0 : startValue };
    } else {
      const acct = debts.find((x) => x.id === accountId);
      if (!acct) { setError('Pick the loan or card to pay off.'); return; }
      const startValue = !exists || initial.account_id !== accountId ? owedOn(acct) : initial.start_value ?? owedOn(acct);
      row = { kind, name: name.trim(), icon: icon || null, target: 0, target_date: d, account_id: acct.id, refills: false, start_value: startValue };
    }
    const { error } = exists ? await supabase.from('goals').update(row).eq('id', initial.id!) : await supabase.from('goals').insert({ ...row, start_date: today() });
    if (error) setError(/goals/.test(error.message) ? 'Goals need the newest database update (supabase db push).' : error.message);
    else { toast('Saved'); onSaved(); onClose(); }
  };
  const close = async (on: boolean) => {
    const { error } = await supabase.from('goals').update({ closed_on: on ? today() : null }).eq('id', initial.id!);
    if (error) setError(error.message); else { toast(on ? 'Marked done' : 'Reopened'); onSaved(); onClose(); }
  };
  const remove = async () => {
    const err = await deleteWithUndo('goals', initial.id!, 'Goal deleted', { table: 'goal_entries', key: 'goal_id' });
    if (err) setError(err); else { onSaved(); onClose(); }
  };

  return (
    <Sheet title={exists ? 'Edit goal' : 'New goal'} dirty={changed} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {exists && <Button title="Delete" kind="danger" onPress={remove} />}
        {exists && <Button title={initial.closed_on ? 'Reopen' : 'Done'} kind="plain" onPress={() => close(!initial.closed_on)} />}
        <Button title="Save" onPress={save} style={{ flex: 1 }} />
      </View>}>
      <Segmented value={kind} onChange={(k) => { setKind(k); setAccountId(null); }} options={[{ value: 'save', label: 'Save up' }, { value: 'payoff', label: 'Pay off' }]} />
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <Field t={t} label="Icon"><EmojiField value={icon} onChange={setIcon} placeholder={kind === 'save' ? '🎯' : '🏁'} /></Field>
        <View style={{ flex: 1 }}><Field t={t} label="Name"><TextInput value={name} onChangeText={setName} placeholder={kind === 'save' ? 'e.g. Emergency fund' : 'e.g. Car loan gone'} placeholderTextColor={t.muted} style={input} /></Field></View>
      </View>
      {kind === 'save' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Field t={t} label="Amount"><TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} /></Field></View>
            <View style={{ flex: 1 }}><Field t={t} label={refills ? 'Needed by' : 'By (optional)'}><DateField value={date} onChange={setDate} /></Field></View>
          </View>
          <Field t={t} label="What counts" hint={accountId ? 'Progress is that account’s balance, measured from what’s in it today.' : 'Progress is the money you mark for it with Add money; it stays in your accounts.'}>
            <View style={styles.chips}>
              <Chip label="Money I set aside" on={!accountId} onPress={() => setAccountId(null)} />
              {savings.map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => { setAccountId(a.id); setRefills(false); }} />)}
            </View>
          </Field>
          {!accountId && (
            <View style={styles.between}>
              <Text style={{ color: t.text, flex: 1 }}>A fund that refills each year (insurance, repairs, gifts)</Text>
              <Switch value={refills} onValueChange={setRefills} />
            </View>
          )}
        </>
      ) : (
        <>
          <Field t={t} label="Loan or card">
            {debts.length ? <View style={styles.chips}>{debts.map((a) => <Chip key={a.id} label={`${a.name} · ${money0(owedOn(a))}`} on={accountId === a.id} onPress={() => setAccountId(a.id)} />)}</View>
              : <Text style={{ color: t.muted }}>No loans or cards yet.</Text>}
          </Field>
          <Field t={t} label="Paid off by (optional)" hint="Progress is what’s been paid off since the goal started.">
            <DateField value={date} onChange={setDate} />
          </Field>
        </>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: UNDER_BAR + 60, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
});
