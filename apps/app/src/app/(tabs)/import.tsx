// Import a bank's CSV export into an account Plaid can't reach (Rogers, PC Financial, Amex, …).
// Steps: choose the file(s) → pick or create the account → check the preview → import.
// Several files can be chosen at once; they are then taken one at a time, each with its own account and preview.
// Rows the account already has (same amount within 3 days) are skipped, so overlapping exports are safe.
import { openTransactions } from '@/lib/txnLinks';
import { formatMoney, parseBankCsv, shortDate, type CsvRow, type ParsedCsv } from '@budget-app/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { findDuplicates, importRows } from '@/lib/csvImport';
import { canPickFiles, pickCsvTexts } from '@/lib/pickFile';
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
  const [done, setDone] = useState<string[]>([]);
  // Files chosen together and still to do after the one on screen, and how many were chosen in all.
  const [rest, setRest] = useState<{ name: string; parsed: ParsedCsv }[]>([]);
  const [total, setTotal] = useState(0);
  // The account each kind of file went into this time, so the next file from the same bank starts on it.
  const [used, setUsed] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from('accounts').select('*').eq('is_hidden', false).order('name')
      .then(({ data }) => setAccounts((data ?? []) as Account[]));
  }, []);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  // Opened from the import reminder: the files go into that account unless you pick another.
  const want = useLocalSearchParams<{ account?: string }>().account;
  const wanted = want ? accounts.find((a) => a.id === want) ?? null : null;

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

  // Put one file on screen and suggest its account: the one the last file from this bank went into,
  // else a manual account whose name mentions the bank, else a new one named after it.
  const open = (f: { name: string; parsed: ParsedCsv }, list: Account[] = accounts, went: Record<string, string> = used) => {
    setFile(f);
    const word = f.parsed.label.split(' ')[0].toLowerCase();
    const match = list.find((a) => a.id === went[f.parsed.label]) ?? list.find((a) => a.id === want) ?? list.find((a) => a.kind === 'manual' && a.name.toLowerCase().includes(word));
    setAccountId(match?.id ?? NEW);
    setNewName(f.parsed.format === 'generic' || f.parsed.format === 'headerless' ? '' : f.parsed.label);
    setNewType(TYPES[0]);
    setBalance(''); setShowDupes(false);
  };
  /** Move on to the next chosen file, or finish. */
  const next = (list: Account[] = accounts, went: Record<string, string> = used) => {
    if (rest.length) { open(rest[0], list, went); setRest(rest.slice(1)); } else setFile(null);
  };

  const choose = async () => {
    setError(''); setDone([]);
    try {
      const picked = await pickCsvTexts();
      if (!picked.length) return;
      const good: { name: string; parsed: ParsedCsv }[] = [], bad: string[] = [];
      for (const p of picked) {
        try { const parsed = parseBankCsv(p.text); if (parsed.rows.length) good.push({ name: p.name, parsed }); else bad.push(`${p.name}: no transactions found`); }
        catch (e) { bad.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (bad.length) setError(bad.join('\n'));
      if (!good.length) { setFile(null); setRest([]); setTotal(0); return; }
      // Oldest first, so several months for one account go in in order.
      good.sort((x, y) => (x.parsed.rows.map((r) => r.date).sort()[0] ?? '').localeCompare(y.parsed.rows.map((r) => r.date).sort()[0] ?? ''));
      setTotal(good.length); setRest(good.slice(1)); setUsed({});
      open(good[0], accounts, {});
    } catch (e) {
      setFile(null); setRest([]);
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
        setAccounts((xs) => [...xs, target!].sort((x, y) => x.name.localeCompare(y.name)));
      }
      const added = await importRows(target, preview.add);
      const b = balance.trim() ? Number(balance.replace(/[$,\s]/g, '')) : NaN;
      if (!isNaN(b)) {
        const owed = target.type === 'credit' || target.type === 'loan';
        await supabase.rpc('set_balance_today', { p_account: target.id, p_balance: owed ? -Math.abs(b) : b });
      }
      const line = `${total > 1 ? `${file.name}: ` : ''}Imported ${added} transaction(s) into ${target.name}.` + (preview.duplicates.length ? ` Skipped ${preview.duplicates.length} already there.` : '');
      setDone((d) => [...d, line]);
      const went = { ...used, [file.parsed.label]: target.id };
      setUsed(went);
      next(accounts.some((a) => a.id === target!.id) ? accounts : [...accounts, target], went);
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
        <Text style={[styles.h, { color: t.text }]}>1. Choose the file{total > 1 ? 's' : ''}</Text>
        {wanted && !file && <Text style={{ color: t.text, fontWeight: '600' }}>For {wanted.name}{wanted.mask ? ` ••${wanted.mask}` : ''}</Text>}
        <Text style={{ color: t.muted }}>Download the transactions as CSV from your bank's website. Rogers, PC Financial and American Express are recognised; most other CSVs with date, description and amount columns work too. You can choose several files at once; they are taken one at a time.</Text>
        <Button title={file ? 'Choose different files' : 'Choose CSV files'} kind={file ? 'plain' : 'primary'} onPress={choose} />
        {file && total > 1 && <Text style={{ color: t.muted, fontWeight: '600' }}>File {total - rest.length} of {total}</Text>}
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
              {total > 1 && <Button title={rest.length ? 'Skip this file' : 'Skip this file and finish'} kind="plain" disabled={busy}
                onPress={() => { setDone((d) => [...d, `${file.name}: skipped.`]); next(); }} />}
            </>
          )}
        </Card>
      )}

      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {done.length > 0 && (
        <Card style={{ gap: 8 }}>
          {done.map((d, i) => <Text key={i} style={{ color: t.text }}>{d}</Text>)}
          {!file && <Button title="Review them" onPress={() => openTransactions({ mode: 'review' })} />}
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
