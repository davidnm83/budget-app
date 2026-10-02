import { router, useFocusEffect } from 'expo-router';
import { UNDER_BAR } from '@/lib/layout';
import { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import PlaidLinkButton from '@/components/PlaidLinkButton';
import { Button, Card, Segmented } from '@/components/ui';
import { callFunction, supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
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
  const themeMode = useThemeMode();
  const { session } = useSession();
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('plaid_items').select('id, item_id, institution_name, status, error_code, last_synced_at').order('institution_name');
    if (error) setMsg(error.message);
    else setItems((data ?? []) as PlaidItem[]);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
      </Card>
      <Text style={[styles.h, { color: t.text }]}>Bank connections</Text>
      <Card style={{ gap: 12 }}>
        {items.length === 0 && <Text style={{ color: t.muted }}>No banks linked yet.</Text>}
        {items.map((it) => (
          <View key={it.id} style={[styles.item, { borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{it.institution_name}</Text>
              <Text style={{ color: it.status === 'ok' ? t.muted : t.danger, fontSize: 13 }}>
                {STATUS[it.status]}{it.last_synced_at ? ` · last sync ${new Date(it.last_synced_at).toLocaleString()}` : ''}
              </Text>
            </View>
            {it.status !== 'ok' && <PlaidLinkButton itemId={it.item_id} title="Fix" onDone={done} onError={setMsg} />}
            <Button title="Remove" kind="danger" onPress={() => remove(it)} />
          </View>
        ))}
        <PlaidLinkButton onDone={done} onError={setMsg} />
        <Text style={{ color: t.muted, fontSize: 13 }}>New transactions sync every morning at about 5 AM, or use Sync now on the Accounts tab.</Text>
      </Card>
      {!!msg && <Text style={{ color: t.muted, marginTop: 12 }}>{msg}</Text>}

      <Text style={[styles.h, { color: t.text }]}>Import</Text>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>Bring in transactions from a bank’s CSV file, or your Fina history with its categories, notes and splits. Both are safe to run again.</Text>
        <Button title="Import a CSV file" kind="plain" onPress={() => router.push('/import')} />
        <Button title="Import history from Fina" kind="plain" onPress={() => router.push('/fina-import')} />
      </Card>

      <Text style={[styles.h, { color: t.text }]}>Planner</Text>
      <PlannerSettings />

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
