// The import-a-CSV reminder (lib/csvReminder): checked when the app opens, when it comes back into view,
// and every few minutes while it stays open, so it shows up soon after each scheduled sync time.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Button } from '@/components/ui';
import { answerReminder, loadReminder, setAccountReminder, type Reminder } from '@/lib/csvReminder';
import { useOffline } from '@/lib/offline';
import { useTheme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import { afterClose } from '@/lib/useBackToClose';

const EVERY_MS = 5 * 60 * 1000;

export function CsvReminder() {
  const t = useTheme();
  const offline = useOffline().offline;
  const [due, setDue] = useState<Reminder | null>(null);

  useEffect(() => {
    if (offline || typeof document === 'undefined') return;
    let live = true;
    const check = () => { if (document.visibilityState === 'visible') loadReminder().then((r) => { if (live && r) setDue((d) => d ?? r); }).catch(() => {}); };
    check();
    const id = setInterval(check, EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => { live = false; clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [offline]);

  if (!due) return null;
  const close = () => { setDue(null); answerReminder().catch(() => {}); };
  const importInto = (id: string) => { close(); afterClose(() => router.push({ pathname: '/import', params: { account: id } } as any)); };
  const stop = async (id: string, name: string) => {
    try {
      await setAccountReminder(id, false);
      const items = due.items.filter((x) => x.account.id !== id);
      if (items.length) setDue({ ...due, items }); else close();
      toast(`No more reminders for ${name}`, { undo: () => setAccountReminder(id, null) });
    } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
  };
  const time = due.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <Sheet title="Time to import" fit onClose={close} footer={<Button title="Later" kind="plain" onPress={close} />}>
      <View style={{ gap: 12 }}>
        <Text style={{ color: t.muted }}>
          The bank sync ran at {time}. {due.items.length === 1 ? 'This account needs' : 'These accounts need'} a CSV file from the bank's website to stay up to date.
        </Text>
        {due.items.map(({ account: a, reason }) => (
          <View key={a.id} style={[styles.row, { borderColor: t.line, backgroundColor: t.card }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{a.name}{a.mask ? ` ••${a.mask}` : ''}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{reason}</Text>
              <Pressable onPress={() => stop(a.id, a.name)} hitSlop={6} accessibilityRole="button">
                <Text style={{ color: t.muted, fontSize: 12, textDecorationLine: 'underline' }}>Don't remind me for this account</Text>
              </Pressable>
            </View>
            <Button title="Import CSV" onPress={() => importInto(a.id)} />
          </View>
        ))}
        <Text style={{ color: t.muted, fontSize: 12 }}>Each account's settings (on the Accounts tab) can turn this reminder on or off. It comes back at the next sync time.</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
});
