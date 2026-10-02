// Import a bank's CSV export into an account Plaid can't reach (Rogers, PC Financial, Amex, …).
// Steps: choose the file → pick or create the account → check the preview → import.
// Rows the account already has (same amount within 3 days) are skipped, so overlapping exports are safe.
import { formatMoney, parseBankCsv, shortDate, type CsvRow, type ParsedCsv } from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { findDuplicates, importRows } from '@/lib/csvImport';
import { canPickFiles, pickCsvText } from '@/lib/pickFile';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Account } from '@/lib/types';

const NEW = 'new';
const TYPES = [
  { label: 'Credit card', type: 'credit', subtype: 'credit card' },
  { label: 'Checking', type: 'depository', subtype: 'checking' },
  { label: 'Savings', type: 'depository', subtype: 'savings' },
  { label: 'Loan', type: 'loan', subtype: 'loan' },
];

export default function ImportScreen() {
  const t = useTheme();
  const [file, setFile] = useState<{ name: string; parsed: ParsedCsv } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>(NEW);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState(TYPES[0]);
  const [balance, setBalance] = useState('');
  const [preview, setPreview] = useState<{ add: CsvRow[]; duplicates: CsvRow[] } | null>(null);
  const [showDupes, setShowDupes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    supabase.from('accounts').select('*').eq('is_hidden', false).order('name')
      .then(({ data }) => setAccounts((data ?? []) as Account[]));
  }, []);

  const account = accounts.find((a) => a.id === accountId) ?? null;

  // Re-check duplicates whenever the file or the chosen account changes.
  useEffect(() => {
    setPreview(null);
    if (!file) return;
    if (!account) { setPreview({ add: file.parsed.rows, duplicates: [] }); return; }
    let live = true;
    findDuplicates(account.id, file.parsed.rows)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [file, account?.id]);

  const choose = async () => {
    setError(''); setDone('');
    try {
      const picked = await pickCsvText();
      if (!picked) return;
      const parsed = parseBankCsv(picked.text);
      if (!parsed.rows.length) throw new Error('No transactions found in that file.');
      setFile({ name: picked.name, parsed });
      // Suggest an account: a manual one whose name mentions the bank, else a new one named after it.
      const word = parsed.label.split(' ')[0].toLowerCase();
      const match = accounts.find((a) => a.kind === 'manual' && a.name.toLowerCase().includes(word));
      setAccountId(match?.id ?? NEW);
      setNewName(parsed.format === 'generic' || parsed.format === 'headerless' ? '' : parsed.label);
      setNewType(TYPES[0]);
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runImport = async () => {
    if (!file || !preview) return;
    setBusy(true); setError('');
    try {
      let target = account;
      if (!target) {
        if (!newName.trim()) throw new Error('Give the new account a name.');
        const { data, error } = await supabase.from('accounts')
          .insert({ name: newName.trim(), kind: 'manual', type: newType.type, subtype: newType.subtype })
          .select('*').single();
        if (error) throw new Error(error.message);
        target = data as Account;
      }
      const added = await importRows(target, preview.add);
      const b = balance.trim() ? Number(balance.replace(/[$,\s]/g, '')) : NaN;
      if (!isNaN(b)) {
        const owed = target.type === 'credit' || target.type === 'loan';
        await supabase.rpc('set_balance_today', { p_account: target.id, p_balance: owed ? -Math.abs(b) : b });
      }
      setDone(`Imported ${added} transaction(s) into ${target.name}.` + (preview.duplicates.length ? ` Skipped ${preview.duplicates.length} already there.` : ''));
      setFile(null);
      setBalance('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress}
      style={[styles.chip, { borderColor: selected ? t.accent : t.line, backgroundColor: selected ? t.accent : 'transparent' }]}>
      <Text style={{ color: selected ? '#fff' : t.text }}>{label}</Text>
    </Pressable>
  );
  const isCredit = (account?.type ?? newType.type) === 'credit' || (account?.type ?? newType.type) === 'loan';
  const dates = file?.parsed.rows.map((r) => r.date).sort() ?? [];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 116 }}>
      {!canPickFiles && <Text style={{ color: t.danger }}>CSV import is only in the web version for now.</Text>}

      <Card style={{ gap: 8 }}>
        <Text style={[styles.h, { color: t.text }]}>1. Choose the file</Text>
        <Text style={{ color: t.muted }}>Download the transactions as CSV from your bank's website. Rogers, PC Financial and American Express are recognised; most other CSVs with date, description and amount columns work too.</Text>
        <Button title={file ? 'Choose a different file' : 'Choose CSV file'} kind={file ? 'plain' : 'primary'} onPress={choose} />
        {file && (
          <Text style={{ color: t.text }}>
            {file.name}: {file.parsed.label}, {file.parsed.rows.length} transactions, {shortDate(dates[0])} – {shortDate(dates[dates.length - 1])}
            {file.parsed.skipped ? ` (${file.parsed.skipped} pending or unreadable rows left out)` : ''}
          </Text>
        )}
      </Card>

      {file && (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.h, { color: t.text }]}>2. Which account?</Text>
          <View style={styles.chips}>
            {accounts.map((a) => chip(a.name + (a.mask ? ` ••${a.mask}` : ''), a.id === accountId, () => setAccountId(a.id)))}
            {chip('+ New account', accountId === NEW, () => setAccountId(NEW))}
          </View>
          {accountId === NEW && (
            <>
              <TextInput value={newName} onChangeText={setNewName} placeholder="Account name, e.g. Rogers Mastercard"
                placeholderTextColor={t.muted} style={[styles.input, { color: t.text, borderColor: t.line }]} />
              <View style={styles.chips}>{TYPES.map((x) => chip(x.label, x === newType, () => setNewType(x)))}</View>
            </>
          )}
          {account?.kind === 'plaid' && (
            <Text style={{ color: t.muted }}>This account is synced by Plaid. Rows it already has are skipped, so only older history gets added.</Text>
          )}
          <TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad"
            placeholder={isCredit ? 'Current amount owing (optional)' : 'Current balance (optional)'}
            placeholderTextColor={t.muted} style={[styles.input, { color: t.text, borderColor: t.line }]} />
        </Card>
      )}

      {file && (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.h, { color: t.text }]}>3. Check and import</Text>
          {!preview ? <Text style={{ color: t.muted }}>Checking for duplicates…</Text> : (
            <>
              <Text style={{ color: t.text }}>
                {preview.add.length} new · {preview.duplicates.length} already in this account
              </Text>
              {preview.add.slice(0, 100).map((r, i) => <Row key={i} r={r} />)}
              {preview.add.length > 100 && <Text style={{ color: t.muted }}>…and {preview.add.length - 100} more</Text>}
              {!!preview.duplicates.length && (
                <Pressable onPress={() => setShowDupes(!showDupes)}>
                  <Text style={{ color: t.accent }}>{showDupes ? 'Hide' : 'Show'} the {preview.duplicates.length} skipped</Text>
                </Pressable>
              )}
              {showDupes && preview.duplicates.map((r, i) => <Row key={'d' + i} r={r} muted />)}
              <Button title={`Import ${preview.add.length} transaction(s)`} onPress={runImport} busy={busy}
                disabled={!preview.add.length && !balance.trim()} />
            </>
          )}
        </Card>
      )}

      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {!!done && (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: t.text }}>{done}</Text>
          <Button title="Review them" onPress={() => router.navigate('/transactions' as any)} />
        </Card>
      )}
    </ScrollView>
  );
}

function Row({ r, muted }: { r: CsvRow; muted?: boolean }) {
  const t = useTheme();
  const color = muted ? t.muted : t.text;
  return (
    <View style={[styles.row, { borderColor: t.line }]}>
      <Text style={{ color: t.muted, width: 52 }}>{shortDate(r.date)}</Text>
      <Text style={{ color, flex: 1 }} numberOfLines={1}>{r.name}</Text>
      <Text style={{ color: r.amount > 0 && !muted ? t.positive : color, fontVariant: ['tabular-nums'] }}>{formatMoney(r.amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 16, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
