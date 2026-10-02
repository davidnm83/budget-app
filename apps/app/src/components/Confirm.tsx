// "Are you sure?" for the few actions that rewrite many things at once and can't be undone
// (merging merchants or categories).
import { useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Button } from '@/components/ui';
import { useTheme } from '@/lib/theme';

export function useConfirm(): [(q: { title: string; message: string; action: string; run: () => unknown }) => void, ReactElement | null] {
  const t = useTheme();
  const [q, setQ] = useState<{ title: string; message: string; action: string; run: () => unknown } | null>(null);
  const el = q ? (
    <Sheet title={q.title} onClose={() => setQ(null)}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Cancel" kind="plain" style={{ flex: 1 }} onPress={() => setQ(null)} />
        <Button title={q.action} style={{ flex: 1 }} onPress={() => { const run = q.run; setQ(null); run(); }} />
      </View>}>
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>{q.message}</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>This can’t be undone.</Text>
    </Sheet>
  ) : null;
  return [setQ, el];
}
