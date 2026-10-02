// Move from another budgeting app: choose its CSV export, check the columns and where each account goes, import.
import { PAGE_MAX } from '@/lib/layout';
import { UNDER_BAR } from '@/lib/layout';
import { MAPPING_FIELDS, detectMapping, parseHistory, readTable, shortDate, type HistoryExport, type Mapping } from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { runHistoryImport, suggestAccountChoices, type AccountChoice, type ImportResult } from '@/lib/historyImport';
import { canPickFiles, pickCsvText } from '@/lib/pickFile';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Account } from '@/lib/types';

const year = (iso: string) => `${shortDate(iso)} ${iso.slice(0, 4)}`;

export default function HistoryImport() {
  const t = useTheme();
  const [hist, setHist] = useState<HistoryExport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [choices, setChoices] = useState<Map<string, AccountChoice>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [hideStarter, setHideStarter] = useState(true);
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [file, setFile] = useState<{ text: string; head: string[] } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [showCols, setShowCols] = useState(false);
  const [pick, setPick] = useState<keyof Mapping | null>(null);

  useEffect(() => {
    supabase.from('accounts').select('*').order('name').then(({ data }) => setAccounts((data ?? []) as Account[]));
  }, []);

  const choose = async () => {
    setError(''); setResult(null);
    try {
      const picked = await pickCsvText();
      if (!picked) return;
      const table = readTable(picked.text);
      const m = detectMapping(table.head, table.body);
      setFile({ text: picked.text, head: table.head });
      setMapping(m);
      setShowCols(m.format === 'Other');
      read(picked.text, m);
    } catch (e) {
      setHist(null); setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Reads the file with the given columns; a mapping that doesn't work yet shows why and waits.
  const read = (text: string, m: Mapping) => {
    try {
      const f = parseHistory(text, m);
      setHist(f); setError('');
      setChoices(suggestAccountChoices(f.accounts, accounts));
    } catch (e) {
      setHist(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const remap = (patch: Partial<Mapping>) => {
    if (!file || !mapping) return;
    const m = { ...mapping, ...patch };
    setMapping(m); setPick(null);
    read(file.text, m);
  };

  const run = async () => {
    if (!hist) return;
    setBusy(true); setError('');
    try {
      setResult(await runHistoryImport(hist, { accounts: choices, hideUnusedStarterCategories: hideStarter, learnMerchants: learn }, setProgress));
      setHist(null);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) + ' Nothing is lost: run the import again and it carries on where it stopped.');
    } finally {
      setBusy(false); setProgress('');
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of hist?.categories ?? []) (m.get(c.group) ?? m.set(c.group, []).get(c.group)!).push(c.name);
    return [...m.entries()];
  }, [hist]);

  const label = (c: AccountChoice | undefined) => {
    if (!c || c.kind === 'new') return 'New account';
    if (c.kind === 'skip') return "Don't import";
    const a = accounts.find((x) => x.id === c.accountId);
    return a ? `${a.name}${a.mask ? ` ••${a.mask}` : ''}` : 'New account';
  };
  const set = (name: string, c: AccountChoice) => { setChoices(new Map(choices).set(name, c)); setOpen(null); };
  const chip = (text: string, on: boolean, onPress: () => void) => (
    <Pressable key={text} onPress={onPress} style={[styles.chip, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : 'transparent' }]}>
      <Text style={{ color: on ? '#fff' : t.text, fontSize: 13 }}>{text}</Text>
    </Pressable>
  );

  const dates = hist?.rows.map((r) => r.date).sort() ?? [];
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!canPickFiles && <Text style={{ color: t.danger }}>Importing is only in the web version for now.</Text>}

      <Card style={{ gap: 8 }}>
        <Text style={[styles.h, { color: t.text }]}>1. Your export</Text>
        <Text style={{ color: t.muted }}>Export your transactions from the other app as a CSV file with one row per transaction. Exports from Mint, Monarch, YNAB and Fina are recognised; for anything else you pick the columns.</Text>
        <Button title={file ? 'Choose a different file' : 'Choose CSV file'} kind={file ? 'plain' : 'primary'} onPress={choose} />
        {hist && (
          <Text style={{ color: t.text }}>
            {hist.format === 'Other' ? '' : `${hist.format} export · `}{hist.rows.length.toLocaleString()} transactions from {year(dates[0])} to {year(dates[dates.length - 1])}, {hist.accounts.length} accounts, {hist.categories.length} categories
          </Text>
        )}
      </Card>

      {file && mapping && (
        <Card style={{ gap: 4 }}>
          <Pressable onPress={() => setShowCols(!showCols)} style={styles.acctRow}>
            <Text style={[styles.h, { color: t.text, flex: 1 }]}>2. Columns</Text>
            <Text style={{ color: t.accent }}>{showCols ? 'Hide' : mapping.format === 'Other' ? 'Check' : 'Change'} ▾</Text>
          </Pressable>
          {!showCols && <Text style={{ color: t.muted }}>{mapping.format === 'Other' ? 'Columns were guessed from the header row.' : `Recognised as a ${mapping.format} export.`}</Text>}
          {showCols && (
            <>
              <Text style={{ color: t.muted, marginBottom: 6 }}>Say which column holds what. Use either Amount, or Money out and Money in.</Text>
              {MAPPING_FIELDS.map((f) => (
                <View key={f.key} style={[styles.acct, { borderColor: t.line }]}>
                  <Pressable onPress={() => setPick(pick === f.key ? null : f.key)} style={styles.acctRow}>
                    <Text style={{ color: t.text, flex: 1 }}>{f.label}</Text>
                    <Text style={{ color: (mapping[f.key] as number) >= 0 ? t.accent : t.muted }}>{(mapping[f.key] as number) >= 0 ? file.head[mapping[f.key] as number] || `Column ${(mapping[f.key] as number) + 1}` : 'Not in this file'} ▾</Text>
                  </Pressable>
                  {pick === f.key && (
                    <View style={styles.chips}>
                      {file.head.map((h, i) => chip(h || `Column ${i + 1}`, mapping[f.key] === i, () => remap({ [f.key]: i } as Partial<Mapping>)))}
                      {!f.need && chip('Not in this file', (mapping[f.key] as number) < 0, () => remap({ [f.key]: -1 } as Partial<Mapping>))}
                    </View>
                  )}
                </View>
              ))}
              <View style={[styles.acct, { borderColor: t.line, paddingVertical: 10, gap: 8 }]}>
                <Text style={{ color: t.text }}>Dates are written</Text>
                <View style={styles.chips}>
                  {chip('Year first (2026-03-04)', mapping.dateOrder === 'ymd', () => remap({ dateOrder: 'ymd' }))}
                  {chip('Month first (03/04/2026)', mapping.dateOrder === 'mdy', () => remap({ dateOrder: 'mdy' }))}
                  {chip('Day first (04/03/2026)', mapping.dateOrder === 'dmy', () => remap({ dateOrder: 'dmy' }))}
                </View>
              </View>
              <View style={styles.toggle}>
                <Text style={{ color: t.text, flex: 1 }}>Spending is shown as positive amounts in this file</Text>
                <Switch value={mapping.flip} onValueChange={(v) => remap({ flip: v })} />
              </View>
            </>
          )}
        </Card>
      )}

      {hist && (
        <Card style={{ gap: 4 }}>
          <Text style={[styles.h, { color: t.text }]}>3. Where each account goes</Text>
          <Text style={{ color: t.muted, marginBottom: 6 }}>Matched by the last 4 digits. Transactions the app already has are filled in with the export's category instead of being added twice.</Text>
          {hist.accounts.map((a) => (
            <View key={a.name} style={[styles.acct, { borderColor: t.line }]}>
              <Pressable onPress={() => setOpen(open === a.name ? null : a.name)} style={styles.acctRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text }}>{a.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{a.rows} transactions · since {year(a.first)}</Text>
                </View>
                <Text style={{ color: choices.get(a.name)?.kind === 'skip' ? t.muted : t.accent }}>{label(choices.get(a.name))} ▾</Text>
              </Pressable>
              {open === a.name && (
                <View style={styles.chips}>
                  {accounts.map((x) => chip(`${x.name}${x.mask ? ` ••${x.mask}` : ''}`,
                    choices.get(a.name)?.kind === 'existing' && (choices.get(a.name) as any).accountId === x.id,
                    () => set(a.name, { kind: 'existing', accountId: x.id })))}
                  {chip('New account', choices.get(a.name)?.kind === 'new', () => set(a.name, { kind: 'new' }))}
                  {chip("Don't import", choices.get(a.name)?.kind === 'skip', () => set(a.name, { kind: 'skip' }))}
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {hist && (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.h, { color: t.text }]}>4. Categories</Text>
          <Text style={{ color: t.muted }}>The {hist.categories.length} categories in the export, with a starting group for each. Change them later on the Categories page.</Text>
          {groups.map(([g, names]) => (
            <Text key={g} style={{ color: t.text }}><Text style={{ fontWeight: '600' }}>{g}: </Text>{names.join(', ')}</Text>
          ))}
          <View style={styles.toggle}>
            <Text style={{ color: t.text, flex: 1 }}>Hide the app's starter categories you haven't used</Text>
            <Switch value={hideStarter} onValueChange={setHideStarter} />
          </View>
          <View style={styles.toggle}>
            <Text style={{ color: t.text, flex: 1 }}>Learn merchant names from this history, so new bank transactions get them too</Text>
            <Switch value={learn} onValueChange={setLearn} />
          </View>
        </Card>
      )}

      {hist && (
        <Button title={`Import ${hist.rows.length.toLocaleString()} transactions`} onPress={run} busy={busy} />
      )}
      {!!progress && <Text style={{ color: t.muted }}>{progress}</Text>}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}

      {result && (
        <Card style={{ gap: 6 }}>
          <Text style={[styles.h, { color: t.text }]}>Done</Text>
          <Text style={{ color: t.text }}>{result.added.toLocaleString()} transactions added.</Text>
          {result.matched + result.split > 0 && <Text style={{ color: t.text }}>{result.matched + result.split} already in the app got the export's category{result.split ? ` (${result.split} as splits)` : ''}.</Text>}
          {result.matchedReviewed > 0 && <Text style={{ color: t.text }}>{result.matchedReviewed} you'd already reviewed here were left as they were.</Text>}
          {result.alreadyImported > 0 && <Text style={{ color: t.text }}>{result.alreadyImported} were imported before and skipped.</Text>}
          {result.skipped > 0 && <Text style={{ color: t.text }}>{result.skipped} skipped from accounts you left out.</Text>}
          <Text style={{ color: t.muted }}>
            {result.accountsCreated} new accounts · {result.categoriesAdded} new categories{result.categoriesHidden ? ` · ${result.categoriesHidden} starter categories hidden` : ''}{result.merchantRules ? ` · ${result.merchantRules} merchant names learned` : ''}
          </Text>
          <Text style={{ color: t.muted }}>New accounts start without a balance: tap one on the Accounts tab to set it.</Text>
          <Button title="See your budget" onPress={() => router.navigate('/budget')} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: UNDER_BAR, maxWidth: PAGE_MAX, width: '100%', alignSelf: 'center' },
  h: { fontSize: 16, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  acct: { borderTopWidth: StyleSheet.hairlineWidth },
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
});

