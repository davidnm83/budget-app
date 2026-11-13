// Adding transactions to an account from screenshots of the bank's transactions list or a statement (photo or PDF).
// Claude reads the rows (see the `ai` function); screenshots that overlap are merged; rows the account already has
// (same amount within 3 days) and pending ones start unticked. What's added goes through the CSV import, so it gets
// the same merchant names and categories.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMoney, mergeReads, shortDate, type CsvRow } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Button, Chip } from '@/components/ui';
import { readStatementFiles, statementFile } from '@/lib/ai';
import { findDuplicates, importRows } from '@/lib/csvImport';
import { pickFiles } from '@/lib/pickFile';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { toast } from '@/lib/toast';

type Row = CsvRow & { key: string; why: '' | 'already in the account' | 'pending'; on: boolean };

type Acct = { id: string; name: string; type: string | null; mask?: string | null };

/** Opened from Settings → Banks & import: the account to add to is chosen first. */
export function StatementImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTheme();
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [account, setAccount] = useState<Acct | null>(null);
  useEffect(() => {
    supabase.from('accounts').select('id, name, type, mask').eq('is_hidden', false).order('name')
      .then(({ data }) => setAccounts(((data ?? []) as Acct[]).filter((a) => a.type === 'depository' || a.type === 'credit')));
  }, []);
  if (!account) {
    return (
      <Sheet title="Add from a screenshot or statement" onClose={onClose}>
        <Text style={{ color: t.muted }}>Take screenshots of a bank’s transaction list (several are fine, overlapping is fine), or use a statement as a photo or PDF. First, the account they’re from:</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {accounts.map((a) => <Chip key={a.id} label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`} on={false} onPress={() => setAccount(a)} />)}
        </View>
        {!accounts.length && <Text style={{ color: t.muted }}>No bank or card accounts yet.</Text>}
      </Sheet>
    );
  }
  return <ReadInto account={account} onBack={() => setAccount(null)} onClose={onClose} onDone={onDone} />;
}

function ReadInto({ account, onBack, onClose, onDone }: { account: Acct; onBack: () => void; onClose: () => void; onDone: () => void }) {
  const t = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'adding'>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const choose = async () => {
    const files = await pickFiles('image/*,application/pdf,.pdf');
    if (!files.length) return;
    setBusy('reading'); setError(''); setNote('');
    try {
      const prepared = await Promise.all(files.map(statementFile));
      const { reads, legible } = await readStatementFiles(prepared, account.type === 'credit');
      const all = mergeReads(reads.map((r) => r.map((x) => ({ date: x.date, name: x.description, amount: x.amount, pending: x.pending }))));
      const pending = new Set(all.filter((r: any) => r.pending));
      const { add, duplicates } = await findDuplicates(account.id, all.filter((r) => !pending.has(r)));
      const dup = new Set(duplicates);
      const list: Row[] = all.map((r, i) => ({ ...r, key: String(i), why: pending.has(r) ? 'pending' : dup.has(r) ? 'already in the account' : '', on: add.includes(r) }));
      setRows(list);
      if (!list.length) setError('No transactions could be read from that. Try a clearer screenshot, or the statement as a PDF.');
      else if (!legible) setNote('Parts were hard to read: check the dates and amounts against the original.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const chosen = (rows ?? []).filter((r) => r.on);
  const total = chosen.reduce((s, r) => s + r.amount, 0);
  const add = async () => {
    setBusy('adding'); setError('');
    try {
      const n = await importRows(account, chosen.map(({ date, name, amount }) => ({ date, name, amount })));
      toast(`${n} transaction${n === 1 ? '' : 's'} added to ${account.name}`);
      onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(''); }
  };
  const toggle = (key: string) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, on: !r.on } : r)));

  return (
    <Sheet title={`Add from a screenshot · ${account.name}`} dirty={chosen.length > 0 && busy !== 'adding'} onClose={() => { if (busy !== 'adding') onClose(); }}
      footer={rows?.length
        ? <Button title={chosen.length ? `Add ${chosen.length} transaction${chosen.length === 1 ? '' : 's'}` : 'Nothing ticked'} disabled={!chosen.length} busy={busy === 'adding'} onPress={add} />
        : <Button title={busy === 'reading' ? 'Reading…' : 'Choose screenshots or a statement'} busy={busy === 'reading'} onPress={choose} />}>
      {!rows?.length && (
        <>
          <Text style={{ color: t.muted }}>
            The app reads the transactions, and you tick the ones to add. Ones {account.name} already has, and pending ones, start unticked.
          </Text>
          {!busy && <Button title="A different account" kind="plain" onPress={onBack} />}
        </>
      )}
      {busy === 'reading' && <Text style={{ color: t.muted }}>Reading… this takes a few seconds for each file.</Text>}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {!!rows?.length && (
        <>
          <Text style={{ color: t.text }}>
            {rows.length} read · {chosen.length} ticked ({formatMoney(total)}){rows.some((r) => r.why) ? ` · ${rows.filter((r) => r.why === 'already in the account').length} already in the account` : ''}
          </Text>
          {!!note && <Text style={{ color: t.series2 }}>{note}</Text>}
          <View>
            {rows.map((r) => (
              <Pressable key={r.key} onPress={() => toggle(r.key)} accessibilityRole="checkbox" accessibilityState={{ checked: r.on }}
                style={({ hovered }: any) => [styles.row, { borderColor: t.line }, hovered && { backgroundColor: t.line }]}>
                <Ionicons name={r.on ? 'checkbox' : 'square-outline'} size={20} color={r.on ? t.accent : t.muted} />
                <Text style={{ color: t.muted, width: 52, fontSize: 13 }}>{shortDate(r.date)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: r.on ? t.text : t.muted }} numberOfLines={1}>{r.name}</Text>
                  {!!r.why && <Text style={{ color: t.muted, fontSize: 12 }}>{r.why}</Text>}
                </View>
                <Text style={{ color: r.amount > 0 ? t.positive : r.on ? t.text : t.muted, fontVariant: ['tabular-nums'] }}>{formatMoney(r.amount)}</Text>
              </Pressable>
            ))}
          </View>
          <Button title="Read different files" kind="plain" disabled={!!busy} onPress={choose} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
});
