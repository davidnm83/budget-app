// Credit score log (VIEW-11): scores you note down from Borrowell (Equifax) or your bank's app
// (TransUnion), as a trend beside card utilisation. Bureaus only open their APIs to lenders, so
// there's no automatic feed. On the Credit cards page and as a Home widget.
import { addMonths, shortDate, toIsoDate } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LineChart } from '@/components/Charts';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { Button, Card, Chip } from '@/components/ui';
import { today } from '@/lib/plan';
import { thisMonth } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { deleteWithUndo, toast } from '@/lib/toast';
import { loadChart } from '@/lib/widgetData';

export interface Score { id: string; date: string; score: number; bureau: 'Equifax' | 'TransUnion' | 'Other'; note: string | null }
const BUREAUS: Score['bureau'][] = ['Equifax', 'TransUnion', 'Other'];

async function loadScores(): Promise<{ scores: Score[]; error: string }> {
  const { data, error } = await supabase.from('credit_scores').select('id, date, score, bureau, note').order('date');
  if (error) return { scores: [], error: /credit_scores/.test(error.message) ? 'The credit score log needs the newest database update (supabase db push).' : error.message };
  return { scores: (data ?? []) as Score[], error: '' };
}

/** The last 12 months of card utilisation, by month (for the table beside the scores). */
async function loadUtil(): Promise<Map<string, number>> {
  try {
    const d = await loadChart({ source: 'utilization', months: 12 });
    const vals = d.series[0]?.values ?? [];
    const first = addMonths(thisMonth(), -(vals.length - 1));
    return new Map(vals.map((v, i) => [addMonths(first, i).slice(0, 7), v]));
  } catch { return new Map(); }
}

export function CreditScoreCard({ refresh = 0, inWidget }: { refresh?: number; inWidget?: boolean }) {
  const t = useTheme();
  const [scores, setScores] = useState<Score[] | null>(null);
  const [util, setUtil] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState('');
  const [logging, setLogging] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => { loadScores().then((r) => { setScores(r.scores); setError(r.error); }); loadUtil().then(setUtil); }, [refresh, n]);
  if (scores == null) return null;
  const last = scores[scores.length - 1];
  const prev = [...scores].reverse().find((s) => last && s.bureau === last.bureau && s.id !== last.id);
  const recent = scores.slice(-12);
  // One row per month: the last score noted that month and the utilisation for it.
  const months = [...new Map(scores.map((s) => [s.date.slice(0, 7), s])).values()].slice(-6).reverse();
  const body = (
    <View style={{ gap: 10 }}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {last ? (
        <View style={styles.between}>
          <View>
            <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{last.score}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{last.bureau} · {shortDate(last.date)} {last.date.slice(0, 4)}</Text>
          </View>
          {prev && <Text style={{ color: last.score >= prev.score ? t.positive : t.danger, fontWeight: '700' }}>{last.score >= prev.score ? '▲' : '▼'} {Math.abs(last.score - prev.score)} since {shortDate(prev.date)}</Text>}
        </View>
      ) : !error && <Text style={{ color: t.muted }}>No scores yet. Note your score from Borrowell or your bank's app once a month to see the trend.</Text>}
      {recent.length >= 2 && <LineChart t={t} labels={recent.map((s) => shortDate(s.date))} series={[{ name: 'Score', values: recent.map((s) => s.score) }]} height={inWidget ? 120 : 160} format={(v) => String(Math.round(v))} legend={false} />}
      {months.length > 0 && !inWidget && (
        <View style={{ gap: 4 }}>
          <View style={styles.between}><Text style={[styles.th, { color: t.muted }]}>Month</Text><Text style={[styles.th, { color: t.muted }]}>Score</Text><Text style={[styles.th, { color: t.muted }]}>Card use</Text></View>
          {months.map((s) => (
            <View key={s.id} style={styles.between}>
              <Text style={[styles.td, { color: t.text }]}>{shortDate(s.date).split(' ')[0]} {s.date.slice(0, 4)}</Text>
              <Text style={[styles.td, { color: t.text }]}>{s.score}</Text>
              <Text style={[styles.td, { color: t.muted }]}>{util.has(s.date.slice(0, 7)) ? `${Math.round(util.get(s.date.slice(0, 7))!)}%` : '–'}</Text>
            </View>
          ))}
        </View>
      )}
      {!inWidget && <Button title="Log a score" kind="plain" onPress={() => setLogging(true)} />}
      {logging && <ScoreSheet scores={scores} onClose={() => setLogging(false)} onSaved={() => setN((x) => x + 1)} />}
    </View>
  );
  return inWidget ? body : <Card style={{ gap: 8 }}><Text style={[styles.h, { color: t.muted }]}>CREDIT SCORE</Text>{body}</Card>;
}

function ScoreSheet({ scores, onClose, onSaved }: { scores: Score[]; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [score, setScore] = useState('');
  const [date, setDate] = useState(today());
  const [bureau, setBureau] = useState<Score['bureau']>(scores[scores.length - 1]?.bureau ?? 'Equifax');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const changed = useChanged([score, note]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const save = async () => {
    const s = Number(score.trim());
    const d = toIsoDate(date);
    if (!Number.isInteger(s) || s < 300 || s > 900) { setError('A Canadian credit score is a whole number from 300 to 900.'); return; }
    if (!d) { setError('That date isn’t a date.'); return; }
    const { error } = await supabase.from('credit_scores').insert({ score: s, date: d, bureau, note: note.trim() || null });
    if (error) setError(error.message); else { toast('Score saved'); onSaved(); onClose(); }
  };
  const remove = async (id: string) => { const err = await deleteWithUndo('credit_scores', id, 'Score deleted'); if (err) setError(err); else onSaved(); };
  return (
    <Sheet title="Log a credit score" fit dirty={changed} onClose={onClose} footer={<Button title="Save" onPress={save} />}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Score"><TextInput value={score} onChangeText={setScore} keyboardType="number-pad" placeholder="e.g. 742" placeholderTextColor={t.muted} style={input} autoFocus /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field></View>
      </View>
      <Field t={t} label="Bureau" hint="Borrowell shows Equifax; most bank apps show TransUnion.">
        <View style={styles.chips}>{BUREAUS.map((b) => <Chip key={b} label={b} on={bureau === b} onPress={() => setBureau(b)} />)}</View>
      </Field>
      <Field t={t} label="Note (optional)"><TextInput value={note} onChangeText={setNote} placeholder="e.g. after paying off the Visa" placeholderTextColor={t.muted} style={input} /></Field>
      {scores.length > 0 && (
        <Field t={t} label="Logged">
          {[...scores].reverse().slice(0, 8).map((s) => (
            <View key={s.id} style={styles.between}>
              <Text style={{ color: t.text, fontSize: 13 }}>{shortDate(s.date)} {s.date.slice(0, 4)} · {s.score} · {s.bureau}</Text>
              <Pressable onPress={() => remove(s.id)} hitSlop={8} accessibilityLabel="Delete score"><Text style={{ color: t.danger }}>Delete</Text></Pressable>
            </View>
          ))}
        </Field>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  h: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  th: { fontSize: 11, fontWeight: '700', flex: 1 },
  td: { fontSize: 13, flex: 1, fontVariant: ['tabular-nums'] },
});
