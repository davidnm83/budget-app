import { router, useFocusEffect } from 'expo-router';
import { usePullRefresh } from '@/lib/pullRefresh';
import { setLogosEnabled, useLogos } from '@/lib/logos';
import { UNDER_BAR } from '@/lib/layout';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import PlaidLinkButton from '@/components/PlaidLinkButton';
import { Button, Card, Chip, Segmented } from '@/components/ui';
import { callFunction, supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { SYNC_CHOICES, currency } from '@budget-app/core';
import { COMMON_CURRENCIES, clearSampleData, loadSampleData, saveCurrency } from '@/lib/setup';
import { useConfirm } from '@/components/Confirm';
import { toast } from '@/lib/toast';
import { setPanel } from '@/lib/panels';
import { LockSettings } from '@/components/LockSettings';
import { canExport, exportEverything } from '@/lib/exportAll';
import { accountIsEmpty, describeBackup, readBackup, restoreBackup, type Backup } from '@/lib/restore';
import { pickJsonText } from '@/lib/pickFile';
import { Sheet } from '@/components/Forms';
import { refreshNow } from '@/lib/pullRefresh';
import { setThemeMode, useTheme, useThemeMode } from '@/lib/theme';
import type { PlaidItem } from '@/lib/types';

const STATUS: Record<PlaidItem['status'], string> = { ok: 'Connected', login_required: 'Needs you to sign in again', error: 'Sync error' };

function confirm(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => Alert.alert('Are you sure?', message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Remove', style: 'destructive', onPress: () => resolve(true) },
  ]));
}

export default function Settings() {
  const t = useTheme();
  const logos = useLogos();
  const themeMode = useThemeMode();
  const { session } = useSession();
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState(currency());
  const [exporting, setExporting] = useState('');
  const backup = async () => {
    try { const r = await exportEverything(setExporting); toast(`Downloaded ${r.rows.toLocaleString()} rows from ${r.tables} tables`); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
    finally { setExporting(''); }
  };
  // Restore: pick a file, show what's in it, and (unless the account is empty) ask for the word RESTORE.
  const [pending, setPending] = useState<{ backup: Backup; empty: boolean } | null>(null);
  const [word, setWord] = useState('');
  const [restoring, setRestoring] = useState('');
  const [restoreNotes, setRestoreNotes] = useState<string[]>([]);
  const chooseBackup = async () => {
    try {
      const f = await pickJsonText();
      if (!f) return;
      const b = readBackup(f.text);
      setWord(''); setPending({ backup: b, empty: await accountIsEmpty() });
    } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
  };
  const runRestore = async () => {
    if (!pending) return;
    try {
      // Keep a copy of what's here first, so a restore can itself be undone.
      if (!pending.empty) await exportEverything((m) => setRestoring(`Saving a copy of what's here first. ${m}`));
      const r = await restoreBackup(pending.backup, setRestoring);
      setPending(null); setRestoreNotes(r.notes);
      toast(`Restored ${r.rows.toLocaleString()} rows`);
      load(); refreshNow();
    } catch (e) { toast(`Restore stopped: ${e instanceof Error ? e.message : String(e)}. Run it again with the same file.`, { error: true }); }
    finally { setRestoring(''); }
  };
  // How often the scheduled sync runs for this account (read on its own, so Settings still works on a database that doesn't have the column yet).
  const [syncEvery, setSyncEvery] = useState<number | null>(null);
  useEffect(() => { supabase.from('user_prefs').select('sync_every').maybeSingle().then(({ data }) => setSyncEvery((data as any)?.sync_every ?? null)); }, []);
  const changeSync = async (every: number) => {
    const before = syncEvery;
    setSyncEvery(every);
    const { error } = await supabase.from('user_prefs').upsert({ sync_every: every, updated_at: new Date().toISOString() });
    if (error) { setSyncEvery(before); toast(/sync_every/.test(error.message) ? 'This needs the newest database update (supabase db push).' : error.message, { error: true }); }
    else toast('Saved');
  };
  const changeCurrency = async (c: string) => { try { await saveCurrency(c); setCode(c); } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); } };
  const [ask, confirmUi] = useConfirm();
  const sample = async () => {
    try { const n = await loadSampleData(); toast(`Sample data loaded: ${n} transactions`); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
  };
  const unsample = () => ask({
    title: 'Remove sample data?', action: 'Remove',
    message: 'The “Sample …” accounts and everything in them are deleted. Your own accounts are not touched.',
    run: async () => {
      try { const n = await clearSampleData(); toast(n ? 'Sample data removed' : 'There was no sample data'); }
      catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
    },
  });

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('plaid_items').select('id, item_id, institution_name, status, error_code, last_synced_at').order('institution_name');
    if (error) setMsg(error.message);
    else setItems((data ?? []) as PlaidItem[]);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

  const done = (m: string) => { setMsg(m); load(); };
  const remove = async (it: PlaidItem) => {
    if (!(await confirm(`Disconnect ${it.institution_name}? Its accounts and history stay as manual accounts.`))) return;
    try { await callFunction('plaid-remove', { itemId: it.item_id }); done(`Disconnected ${it.institution_name}.`); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      <Text style={[styles.h, { color: t.text }]}>Appearance</Text>
      <Card style={{ gap: 8 }}>
        <Segmented value={themeMode} onChange={setThemeMode} options={[{ value: 'auto', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Text style={{ color: t.muted, fontSize: 12 }}>Kept on this device.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <Text style={{ color: t.text, flex: 1 }}>Bank and merchant logos</Text>
          <Switch value={logos} onValueChange={setLogosEnabled} />
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>Pictures come from your bank feed, or from DuckDuckGo’s icon service using only the site name (like examplebank.com). Off shows letters and emoji and makes no outside requests for them. Pictures you upload always show.</Text>
      </Card>
      <Text style={[styles.h, { color: t.text }]}>Currency</Text>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {COMMON_CURRENCIES.map((c) => <Chip key={c} label={c} on={currency() === c} onPress={() => changeCurrency(c)} />)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: t.muted }}>Or type a code</Text>
          <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase().slice(0, 3))} maxLength={3} autoCapitalize="characters"
            style={{ color: t.text, borderColor: t.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, width: 70 }} />
          {code.length === 3 && code !== currency() && <Button title="Use" kind="plain" onPress={() => changeCurrency(code)} />}
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>Amounts are shown in one currency. Nothing is converted. Kept with your account.</Text>
      </Card>
      <Text style={[styles.h, { color: t.text }]}>Bank connections</Text>
      <Card style={{ gap: 12 }}>
        {items.length === 0 && <Text style={{ color: t.muted }}>No banks linked yet.</Text>}
        {items.map((it) => (
          <View key={it.id} style={[styles.item, { borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{it.institution_name}</Text>
              <Text style={{ color: it.status === 'ok' ? t.muted : t.danger, fontSize: 13 }}>
                {STATUS[it.status]}{it.status !== 'ok' && it.error_code ? ` (${it.error_code})` : ''}{it.last_synced_at ? ` · last sync ${new Date(it.last_synced_at).toLocaleString()}` : ''}
              </Text>
            </View>
            {it.status !== 'ok' && <PlaidLinkButton itemId={it.item_id} title="Fix" onDone={done} onError={setMsg} />}
            <Button title="Remove" kind="danger" onPress={() => remove(it)} />
          </View>
        ))}
        {session?.user.app_metadata?.demo === true
          ? <Text style={{ color: t.muted, fontSize: 13 }}>This is a demo account, so linking a bank is turned off.</Text>
          : <PlaidLinkButton onDone={done} onError={setMsg} />}
        <Text style={{ color: t.text, fontWeight: '600', marginTop: 4 }}>Sync automatically</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SYNC_CHOICES.map((c) => <Chip key={c.every} label={c.label} on={(syncEvery ?? 24) === c.every} onPress={() => changeSync(c.every)} />)}
        </View>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {(() => { const c = SYNC_CHOICES.find((x) => x.every === (syncEvery ?? 24)); return c?.every === 0 ? 'Nothing syncs on its own.' : `Syncs ${c?.label.toLowerCase()}${c?.about ? ` (${c.about})` : ', counted from 5 AM'}.`; })()} Sync now on the Accounts tab works at any time. Banks usually post new transactions once or twice a day, so syncing more often mostly helps you see them sooner after they post.
        </Text>
      </Card>
      {!!msg && <Text style={{ color: t.muted, marginTop: 12 }}>{msg}</Text>}

      <Text style={[styles.h, { color: t.text }]}>Import</Text>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>Bring in transactions from a bank’s CSV file, or your history from another budgeting app with its categories, notes and splits. Both are safe to run again.</Text>
        <Button title="Import a CSV file" kind="plain" onPress={() => router.push('/import')} />
        <Button title="Import from another app" kind="plain" onPress={() => router.push('/history-import')} />
      </Card>

      <Text style={[styles.h, { color: t.text }]}>Backup</Text>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>Download everything in your account as one JSON file: accounts, transactions, categories, rules, budgets, bills and settings. Bank sign-in tokens are never included.</Text>
        <Button title="Download everything" kind="plain" busy={!!exporting} disabled={!canExport} onPress={backup} />
        {!!exporting && <Text style={{ color: t.muted, fontSize: 12 }}>{exporting}</Text>}
        {!canExport && <Text style={{ color: t.muted, fontSize: 12 }}>Available in the web version.</Text>}
        <Text style={{ color: t.muted }}>Restore replaces everything in this account with the contents of a backup file. Bank links are kept if they still exist here; they are never part of a backup.</Text>
        <Button title="Restore from a backup file" kind="plain" disabled={!canExport || session?.user.app_metadata?.demo === true} onPress={chooseBackup} />
        {restoreNotes.map((n) => <Text key={n} style={{ color: t.muted, fontSize: 12 }}>• {n}</Text>)}
      </Card>
      {pending && (() => {
        const d = describeBackup(pending.backup);
        const ok = pending.empty || word.trim().toUpperCase() === 'RESTORE';
        return (
          <Sheet title="Restore this backup?" onClose={() => { if (!restoring) setPending(null); }} fit>
            <Text style={{ color: t.text, fontWeight: '600' }}>Backup from {d.when}</Text>
            <Text style={{ color: t.muted }}>{d.lines.join(' · ')}</Text>
            {pending.empty
              ? <Text style={{ color: t.muted }}>This account has no accounts or transactions yet, so nothing of yours is replaced.</Text>
              : (
                <>
                  <Text style={{ color: t.danger }}>Everything in this account now is deleted and replaced with the backup: accounts, transactions, categories, rules, budgets, bills and settings. Anything added since the backup was made is lost, including transactions synced since then.</Text>
                  <Text style={{ color: t.muted }}>A copy of what’s here now is downloaded first, so you can restore that if you change your mind.</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>Type RESTORE to go ahead.</Text>
                  <TextInput value={word} onChangeText={setWord} autoCapitalize="characters" placeholder="RESTORE" placeholderTextColor={t.muted}
                    style={{ color: t.text, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: t.card }} />
                </>
              )}
            {!!restoring && <Text style={{ color: t.muted, fontSize: 12 }}>{restoring}</Text>}
            <Button title={pending.empty ? 'Restore' : 'Delete and restore'} kind={pending.empty ? 'primary' : 'danger'} disabled={!ok} busy={!!restoring} onPress={runRestore} />
            <Button title="Cancel" kind="plain" disabled={!!restoring} onPress={() => setPending(null)} />
          </Sheet>
        );
      })()}

      <Text style={[styles.h, { color: t.text }]}>Sample data</Text>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>Made-up accounts named “Sample …” with six months of transactions, budgets and bills, for looking around. Loading only works while you have no transactions of your own.</Text>
        <Button title="Load sample data" kind="plain" onPress={sample} />
        <Button title="Remove sample data" kind="plain" onPress={unsample} />
      </Card>
      {confirmUi}

      <Text style={[styles.h, { color: t.text }]}>Planner</Text>
      <PlannerSettings />

      <LockSettings />

      {Platform.OS === 'web' && (
        <>
          <Text style={[styles.h, { color: t.text }]}>Keyboard shortcuts</Text>
          <Card style={{ gap: 12 }}>
            <Text style={{ color: t.muted }}>On a computer, press ? anywhere to see the shortcuts, or open the guide here.</Text>
            <Button title="Show keyboard shortcuts" kind="plain" onPress={() => setPanel('shortcuts')} />
          </Card>
        </>
      )}

      <Text style={[styles.h, { color: t.text }]}>Account</Text>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>Signed in as {session?.user.email}</Text>
        <Button title="Sign out" kind="plain" onPress={() => supabase.auth.signOut()} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: UNDER_BAR, maxWidth: 640, width: '100%', alignSelf: 'center' },
  h: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});

/** Which accounts the weekly planner covers, and the balance each should stay above (PLN-4, PLN-14). */
function PlannerSettings() {
  const t = useTheme();
  const [accounts, setAccounts] = useState<{ id: string; name: string; mask: string | null; type: string | null; plan_include: boolean; plan_buffer: number }[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('accounts').select('id, name, mask, type, plan_include, plan_buffer').eq('is_hidden', false).order('name');
    setAccounts((data ?? []).map((a: any) => ({ ...a, plan_buffer: Number(a.plan_buffer) })));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const save = async (id: string, patch: Record<string, unknown>) => {
    setAccounts((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } as any : a)));
    await supabase.from('accounts').update(patch).eq('id', id);
  };
  return (
    <Card style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 4 }}>
        The planner covers the accounts that pay your bills. Warn when one would drop below its buffer.
      </Text>
      {accounts.filter((a) => a.type === 'depository').map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
          <Switch value={a.plan_include} onValueChange={(v) => save(a.id, { plan_include: v })} />
          <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{a.name}{a.mask ? ` ••${a.mask}` : ''}</Text>
          {a.plan_include && (
            <>
              <Text style={{ color: t.muted, fontSize: 13 }}>Buffer $</Text>
              <TextInput defaultValue={String(a.plan_buffer)} keyboardType="decimal-pad"
                onEndEditing={(e) => save(a.id, { plan_buffer: Number(e.nativeEvent.text) || 0 })}
                onBlur={(e: any) => { const v = Number(e?.target?.value ?? e?.nativeEvent?.text); if (!isNaN(v)) save(a.id, { plan_buffer: v }); }}
                style={{ color: t.text, borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, width: 80, textAlign: 'right' }} />
            </>
          )}
        </View>
      ))}
    </Card>
  );
}
