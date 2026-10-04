// Nightly backups (PLT-8) in Settings: the copies the server keeps (the last 7 nights and the first
// of each month for a year), each to download or restore, and Back up now.
import { shortDate } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { readBackup, type Backup } from '@/lib/restore';
import { callFunction, supabase } from '@/lib/supabase';
import type { Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';

interface Saved { date: string; size: number | null; path: string }

async function listBackups(): Promise<{ list: Saved[]; error: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { list: [], error: '' };
  const { data, error } = await supabase.storage.from('backups').list(uid, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  if (error) return { list: [], error: /bucket/i.test(error.message) ? 'Nightly backups need the newest database update (supabase db push).' : error.message };
  return {
    list: (data ?? []).filter((f: any) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name)).map((f: any) => ({ date: f.name.slice(0, 10), size: f.metadata?.size ?? null, path: `${uid}/${f.name}` }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    error: '',
  };
}

async function fetchBackup(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from('backups').download(path);
  if (error || !data) throw new Error(error?.message ?? 'The backup couldn’t be downloaded.');
  return data;
}

export function NightlyBackups({ t, onRestore }: { t: Theme; onRestore: (b: Backup) => void }) {
  const [list, setList] = useState<Saved[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => { listBackups().then((r) => { setList(r.list); setError(r.error); }); }, [n]);

  const now = async () => {
    setBusy(true);
    try { const r = await callFunction<{ rows: number }>('backup'); toast(`Backed up ${r.rows.toLocaleString()} row${r.rows === 1 ? '' : 's'}`); setN((x) => x + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const download = async (s: Saved) => {
    try {
      const url = URL.createObjectURL(await fetchBackup(s.path));
      const a = document.createElement('a'); a.href = url; a.download = `budget-backup-${s.date}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const restore = async (s: Saved) => {
    try { onRestore(readBackup(await (await fetchBackup(s.path)).text())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const shown = all ? list ?? [] : (list ?? []).slice(0, 3);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: t.muted }}>A copy is also saved on the server every night at 3 AM, privately: the last 7 nights and the first of each month for a year.</Text>
      {!!error && <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text>}
      {list && !list.length && !error && <Text style={{ color: t.muted, fontSize: 13 }}>None yet; the first one is made tonight, or now with Back up now.</Text>}
      {shown.map((s) => (
        <View key={s.date} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: t.text, flex: 1 }}>{shortDate(s.date)} {s.date.slice(0, 4)}{s.size ? <Text style={{ color: t.muted, fontSize: 12 }}>{`  ${s.size < 1048576 ? `${Math.max(1, Math.round(s.size / 1024))} KB` : `${(s.size / 1048576).toFixed(1)} MB`}`}</Text> : null}</Text>
          <Pressable onPress={() => download(s)} hitSlop={6}><Text style={{ color: t.accent }}>Download</Text></Pressable>
          <Pressable onPress={() => restore(s)} hitSlop={6}><Text style={{ color: t.accent }}>Restore</Text></Pressable>
        </View>
      ))}
      {(list?.length ?? 0) > 3 && <Pressable onPress={() => setAll(!all)} hitSlop={6}><Text style={{ color: t.muted, fontSize: 13 }}>{all ? 'Show fewer' : `Show all ${list!.length}`}</Text></Pressable>}
      <Button title="Back up now" kind="plain" busy={busy} onPress={now} />
    </View>
  );
}
