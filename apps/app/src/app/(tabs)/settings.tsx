import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import PlaidLinkButton from '@/components/PlaidLinkButton';
import { Button, Card } from '@/components/ui';
import { callFunction, supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
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

      <Text style={[styles.h, { color: t.text }]}>Account</Text>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>Signed in as {session?.user.email}</Text>
        <Button title="Sign out" kind="plain" onPress={() => supabase.auth.signOut()} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, maxWidth: 640, width: '100%', alignSelf: 'center' },
  h: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
