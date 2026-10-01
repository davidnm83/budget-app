// One-time move from Fina: choose the "raw" export, check where each Fina account goes, import.
import { parseFinaExport, shortDate, type FinaExport } from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { runFinaImport, suggestAccountChoices, type AccountChoice, type FinaImportResult } from '@/lib/finaImport';
import { canPickFiles, pickCsvText } from '@/lib/pickFile';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import type { Account } from '@/lib/types';

const year = (iso: string) => `${shortDate(iso)} ${iso.slice(0, 4)}`;

export default function FinaImport() {
  const t = useTheme();
  const [fina, setFina] = useState<FinaExport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [choices, setChoices] = useState<Map<string, AccountChoice>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [hideStarter, setHideStarter] = useState(true);
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<FinaImportResult | null>(null);

  useEffect(() => {
    supabase.from('accounts').select('*').order('name').then(({ data }) => setAccounts((data ?? []) as Account[]));
  }, []);

  const choose = async () => {
    setError(''); setResult(null);
    try {
      const picked = await pickCsvText();
      if (!picked) return;
      const f = parseFinaExport(picked.text);
      setFina(f);
      setChoices(suggestAccountChoices(f.accounts, accounts));
    } catch (e) {
      setFina(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async () => {
    if (!fina) return;
    setBusy(true); setError('');
    try {
      setResult(await runFinaImport(fina, { accounts: choices, hideUnusedStarterCategories: hideStarter, learnMerchants: learn }, setProgress));
      setFina(null);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) + ' Nothing is lost: run the import again and it carries on where it stopped.');
    } finally {
      setBusy(false); setProgress('');
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of fina?.categories ?? []) (m.get(c.group) ?? m.set(c.group, []).get(c.group)!).push(c.name);
    return [...m.entries()];
  }, [fina]);

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

  const dates = fina?.rows.map((r) => r.date).sort() ?? [];
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {!canPickFiles && <Text style={{ color: t.danger }}>The Fina import is only in the web version for now.</Text>}

      <Card style={{ gap: 8 }}>
        <Text style={[styles.h, { color: t.text }]}>1. Your Fina export</Text>
        <Text style={{ color: t.muted }}>In Fina, export your transactions and pick the raw version (dates with years, one row per split part).</Text>
        <Button title={fina ? 'Choose a different file' : 'Choose Fina CSV'} kind={fina ? 'plain' : 'primary'} onPress={choose} />
        {fina && (
          <Text style={{ color: t.text }}>
            {fina.rows.length.toLocaleString()} transactions from {year(dates[0])} to {year(dates[dates.length - 1])}, {fina.accounts.length} accounts, {fina.categories.length} categories
          </Text>
        )}
      </Card>

      {fina && (
        <Card style={{ gap: 4 }}>
          <Text style={[styles.h, { color: t.text }]}>2. Where each account goes</Text>
          <Text style={{ color: t.muted, marginBottom: 6 }}>Matched by the last 4 digits. Transactions the app already has are filled in with Fina's category instead of being added twice.</Text>
          {fina.accounts.map((a) => (
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

      {fina && (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.h, { color: t.text }]}>3. Categories</Text>
          <Text style={{ color: t.muted }}>Your {fina.categories.length} Fina categories, in starting groups. You can regroup them later.</Text>
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

      {fina && (
        <Button title={`Import ${fina.rows.length.toLocaleString()} transactions`} onPress={run} busy={busy} />
      )}
      {!!progress && <Text style={{ color: t.muted }}>{progress}</Text>}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}

      {result && (
        <Card style={{ gap: 6 }}>
          <Text style={[styles.h, { color: t.text }]}>Done</Text>
          <Text style={{ color: t.text }}>{result.added.toLocaleString()} transactions added.</Text>
          {result.matched + result.split > 0 && <Text style={{ color: t.text }}>{result.matched + result.split} already in the app got Fina's category{result.split ? ` (${result.split} as splits)` : ''}.</Text>}
          {result.matchedReviewed > 0 && <Text style={{ color: t.text }}>{result.matchedReviewed} you'd already reviewed here were left as they were.</Text>}
          {result.alreadyImported > 0 && <Text style={{ color: t.text }}>{result.alreadyImported} were imported before and skipped.</Text>}
          {result.skipped > 0 && <Text style={{ color: t.text }}>{result.skipped} skipped from accounts you left out.</Text>}
          <Text style={{ color: t.muted }}>
            {result.accountsCreated} new accounts · {result.categoriesAdded} new categories{result.categoriesHidden ? ` · ${result.categoriesHidden} starter categories hidden` : ''}{result.merchantRules ? ` · ${result.merchantRules} merchant names learned` : ''}
          </Text>
          <Text style={{ color: t.muted }}>New accounts start without a balance: tap one on the Accounts tab to set it.</Text>
          <Button title="See your budget" onPress={() => router.replace('/budget')} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  h: { fontSize: 16, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  acct: { borderTopWidth: StyleSheet.hairlineWidth },
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
});

