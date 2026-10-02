// First-run setup: pick a currency, then choose how to start (bank, import, sample data or empty).
import { currency } from '@budget-app/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PlaidLinkButton from '@/components/PlaidLinkButton';
import { Button, Card, Chip } from '@/components/ui';
import { COMMON_CURRENCIES, finishSetup, isCurrency, loadSampleData, saveCurrency } from '@/lib/setup';
import { useTheme } from '@/lib/theme';

export default function Setup({ onDone, demo }: { onDone: () => void; demo: boolean }) {
  const t = useTheme();
  const [code, setCode] = useState(currency());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Saves the choices, shows the app, then opens the page for the chosen start.
  const start = async (how: string, then?: string, before?: () => Promise<unknown>) => {
    setError('');
    if (!isCurrency(code.trim().toUpperCase())) { setError('Use a 3-letter currency code, like USD or EUR.'); return; }
    setBusy(how);
    try {
      await saveCurrency(code, false);
      if (before) await before();
      await finishSetup();
      // The app underneath loaded before these choices were made, so on the web start it afresh.
      if (Platform.OS === 'web') { window.location.assign(then ?? '/'); return; }
      onDone();
      if (then) setTimeout(() => router.push(then as any), 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>Welcome</Text>
      <Text style={{ color: t.muted, fontSize: 15 }}>Two quick choices and you're in. Both can be changed later in Settings.</Text>

      <Card style={{ gap: 10 }}>
        <Text style={[styles.h, { color: t.text }]}>1. Currency</Text>
        <View style={styles.chips}>
          {COMMON_CURRENCIES.map((c) => <Chip key={c} label={c} on={code.toUpperCase() === c} onPress={() => setCode(c)} />)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: t.muted }}>Or type a code</Text>
          <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase().slice(0, 3))} autoCapitalize="characters" maxLength={3}
            style={[styles.input, { color: t.text, borderColor: t.line }]} />
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>Amounts are shown in one currency. Nothing is converted.</Text>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={[styles.h, { color: t.text }]}>2. How do you want to start?</Text>
        {!demo && (
          <View style={styles.choice}>
            <Text style={{ color: t.muted, fontSize: 13 }}>Connect a bank and transactions arrive every morning. Needs Plaid set up on the server.</Text>
            <PlaidLinkButton onDone={() => start('bank', '/accounts')} onError={setError} />
          </View>
        )}
        <View style={styles.choice}>
          <Text style={{ color: t.muted, fontSize: 13 }}>Bring your history from Mint, Monarch, YNAB, Fina or any CSV export.</Text>
          <Button title="Import from another app" kind="plain" busy={busy === 'history'} onPress={() => start('history', '/history-import')} />
        </View>
        <View style={styles.choice}>
          <Text style={{ color: t.muted, fontSize: 13 }}>Load a CSV file downloaded from your bank into one account.</Text>
          <Button title="Import a bank file" kind="plain" busy={busy === 'csv'} onPress={() => start('csv', '/import')} />
        </View>
        <View style={styles.choice}>
          <Text style={{ color: t.muted, fontSize: 13 }}>Look around first with made-up accounts and six months of transactions. Remove it from Settings whenever you like.</Text>
          <Button title="Load sample data" kind="plain" busy={busy === 'sample'} onPress={() => start('sample', undefined, loadSampleData)} />
        </View>
        <View style={styles.choice}>
          <Text style={{ color: t.muted, fontSize: 13 }}>Or start with nothing and add accounts yourself.</Text>
          <Button title="Start empty" kind="plain" busy={busy === 'empty'} onPress={() => start('empty', '/accounts')} />
        </View>
      </Card>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 48, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  h: { fontSize: 16, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { gap: 6, paddingTop: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, width: 70, fontSize: 15 },
});
