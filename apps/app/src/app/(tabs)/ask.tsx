// Ask (IDEA-12): questions about your money, answered by Claude from your own data through read-only lookups
// (see supabase/functions/_shared/ai.ts). The conversation lasts until the app is closed.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/ui';
import { askAi, savedModel, saveModel, useAiOn, type ChatTurn, type ModelChoice } from '@/lib/ai';
import { PAGE_MAX, UNDER_BAR, useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';
import { router } from 'expo-router';

// The conversation, kept while the app is open (leaving the page and coming back keeps it).
let turns: ChatTurn[] = [];
const subs = new Set<() => void>();
const setTurns = (next: ChatTurn[]) => { turns = next; subs.forEach((f) => f()); };
const useTurns = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => turns, () => turns);

const LOOKUP: Record<string, string> = {
  find_transactions: 'transactions', spending_by_category: 'spending by category', budget: 'the budget', accounts: 'accounts',
  upcoming: 'the planner', money_owed: 'money owed',
};
const STARTERS = [
  'How much have I spent on restaurants this month?',
  'What bills are coming up in the next two weeks?',
  'How much do I owe on my cards, and how close am I to the limits?',
  'Where did most of my money go last month?',
];

export default function Ask() {
  const t = useTheme();
  const wide = useWide();
  const on = useAiOn();
  const list = useTurns();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState<ModelChoice>(savedModel);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { const h = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); return () => clearTimeout(h); }, [list.length, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const before = turns;
    setTurns([...before, { role: 'user', text: question }]);
    setText(''); setBusy(true); setError('');
    try {
      const r = await askAi(question, before, model);
      setTurns([...turns, { role: 'assistant', text: r.answer, looked: r.looked }]);
    } catch (e) {
      setTurns(before); setText(question);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const pick = (m: ModelChoice) => { setModel(m); saveModel(m); };

  if (on === false) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={styles.page}>
          <EmptyState icon="chatbubbles-outline" title="Ask isn’t set up"
            text="Asking questions about your money (and reading receipt photos) uses Claude through your own Claude API key. Add the key to the server once; see Settings → AI." action="Open Settings" onAction={() => router.navigate('/settings')} />
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.bar, { borderColor: t.line }]}>
        <Chip label="Quick" on={model === 'haiku'} onPress={() => pick('haiku')} />
        <Chip label="Thorough" on={model === 'sonnet'} onPress={() => pick('sonnet')} />
        <Text style={{ color: t.muted, fontSize: 12, flex: 1 }} numberOfLines={2}>{model === 'haiku' ? 'Claude Haiku: fast, for everyday questions' : 'Claude Sonnet: slower, better for questions that need working out'}</Text>
        {list.length > 0 && <Pressable onPress={() => setTurns([])} hitSlop={8} accessibilityLabel="Start over"><Ionicons name="refresh" size={20} color={t.muted} /></Pressable>}
      </View>
      <ScrollView ref={scroll} contentContainerStyle={[styles.page, { paddingBottom: 16 }]} keyboardShouldPersistTaps="handled">
        {!list.length && (
          <View style={{ gap: 10, paddingTop: 8 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>Ask about your money</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>Answers come from your own transactions, budget, accounts and planner. It can look things up but can’t change anything.</Text>
            {STARTERS.map((s) => (
              <Pressable key={s} onPress={() => send(s)} style={({ hovered }: any) => [styles.starter, { borderColor: t.line, backgroundColor: hovered ? t.line : t.card }]}>
                <Text style={{ color: t.text }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {list.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? { alignSelf: 'flex-end', backgroundColor: t.accent } : { alignSelf: 'flex-start', backgroundColor: t.card, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth }]}>
            <Text style={{ color: m.role === 'user' ? '#fff' : t.text, fontSize: 15, lineHeight: 21 }} selectable>{m.text}</Text>
            {!!m.looked?.length && <Text style={{ color: t.muted, fontSize: 11, marginTop: 4 }}>Looked at {[...new Set(m.looked.map((x) => LOOKUP[x] ?? x))].join(', ')}</Text>}
          </View>
        ))}
        {busy && <View style={[styles.bubble, { alignSelf: 'flex-start', backgroundColor: t.card, flexDirection: 'row', gap: 8, alignItems: 'center' }]}><ActivityIndicator color={t.muted} /><Text style={{ color: t.muted }}>Looking it up…</Text></View>}
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      </ScrollView>
      <View style={[styles.inputRow, { borderColor: t.line, backgroundColor: t.bg, marginBottom: wide ? 12 : UNDER_BAR - 24 }]}>
        <TextInput value={text} onChangeText={setText} placeholder="Ask a question" placeholderTextColor={t.muted} multiline
          onKeyPress={(e: any) => { if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); send(text); } }}
          style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} accessibilityLabel="Question" />
        <Pressable onPress={() => send(text)} disabled={busy || !text.trim()} accessibilityLabel="Send"
          style={[styles.send, { backgroundColor: busy || !text.trim() ? t.line : t.accent }]}>
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, width: '100%', maxWidth: 760, alignSelf: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  starter: { borderWidth: 1, borderRadius: 12, padding: 12 },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, width: '100%', maxWidth: 760, alignSelf: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, maxHeight: 140 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
