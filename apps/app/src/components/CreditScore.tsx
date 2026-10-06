// Credit score log (VIEW-11): scores you note down from Borrowell (Equifax) or your bank's app
// (TransUnion), as a line per bureau beside card utilisation. Bureaus only open their APIs to
// lenders, so there's no automatic feed. On the Credit cards page; any chart widget can show it too
// (the "Credit score" source).
import { addMonths, shortDate, toIsoDate } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LineChart } from '@/components/Charts';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { Button, Card, Chip } from '@/components/ui';
import { today } from '@/lib/plan';
import { thisMonth } from '@/lib/reports';
import { BUREAUS, loadScores, scoreLines, type Score } from '@/lib/creditScores';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';
import { deleteWithUndo, toast } from '@/lib/toast';
import { loadChart } from '@/lib/widgetData';

/** The last 12 months of card utilisation, by month (for the table beside the scores). */
async function loadUtil(): Promise<Map<string, number>> {
  try {
    const d = await loadChart({ source: 'utilization', months: 12 });
    const vals = d.series[0]?.values ?? [];
    const first = addMonths(thisMonth(), -(vals.length - 1));
    return new Map(vals.map((v, i) => [addMonths(first, i).slice(0, 7), v]));
  } catch { return new Map(); }
}

export function CreditScoreCard({ refresh = 0 }: { refresh?: number }) {
  const t = useTheme();
  const [scores, setScores] = useState<Score[] | null>(null);
  const [util, setUtil] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState('');
  const [logging, setLogging] = useState(false);
  const [n, setN] = useState(0);
  const [only, setOnly] = useState<Score['bureau'] | null>(null);
  const [sel, setSel] = useState<number | null>(null); // highlighted month on the chart
  useEffect(() => { loadScores().then((r) => { setScores(r.scores); setError(r.error); }); loadUtil().then(setUtil); }, [refresh, n]);
  if (scores == null) return null;
  // The last 12 months, a line per bureau (or just the one picked).
  const axis = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth(), i - 11));
  const lines = scoreLines(scores, axis, only ? [only] : undefined);
  const firstCol = Math.max(0, Math.min(...lines.map((l) => l.values.findIndex(Number.isFinite)).filter((i) => i >= 0)));
  const used = BUREAUS.filter((b) => scores.some((s) => s.bureau === b));
  // The headline: the latest score of each bureau shown (the one picked, or all), and how it moved:
  // since the highlighted month, or else since that bureau's score before.
  const heads = (only ? [only] : used).map((b) => {
    const mine = scores.filter((s) => s.bureau === b);
    const last = mine[mine.length - 1];
    const line = lines.find((l) => l.name === b);
    const at = sel != null ? line?.values[firstCol + sel] : undefined;
    const prev = mine[mine.length - 2];
    const was = at != null && Number.isFinite(at) ? { score: at, when: shortDate(axis[firstCol + sel!]).split(' ')[0] } : prev ? { score: prev.score, when: shortDate(prev.date) } : null;
    return { b, last, was };
  }).filter((h) => h.last);
  // One row per month: each bureau's last score that month, and the utilisation for it.
  const months = [...new Set(scores.map((s) => s.date.slice(0, 7)))].slice(-6).reverse()
    .map((m) => ({ m, list: used.map((b) => [...scores].reverse().find((s) => s.bureau === b && s.date.startsWith(m))).filter(Boolean) as Score[] }));
  const body = (
    <View style={{ gap: 10 }}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {heads.length ? (
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          {heads.map(({ b, last, was }) => (
            <View key={b} style={{ flex: 1, minWidth: 130 }}>
              <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{last.score}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{b} · {shortDate(last.date)} {last.date.slice(0, 4)}</Text>
              {was && <Text style={{ color: last.score >= was.score ? t.positive : t.danger, fontWeight: '700', fontSize: 13 }}>{last.score === was.score ? '=' : last.score > was.score ? '▲' : '▼'} {Math.abs(last.score - was.score)} since {was.when}</Text>}
            </View>
          ))}
        </View>
      ) : !error && <Text style={{ color: t.muted }}>No scores yet. Note your score from Borrowell or your bank's app once a month to see the trend.</Text>}
      {used.length > 1 && (
        <View style={styles.chips}>
          <Chip label="All sources" on={!only} onPress={() => setOnly(null)} />
          {used.map((b) => <Chip key={b} label={b} on={only === b} onPress={() => setOnly(b)} />)}
        </View>
      )}
      {scores.length >= 2 && lines.length > 0 && (
        <LineChart t={t} labels={axis.slice(firstCol).map((m) => shortDate(m).split(' ')[0])} series={lines.map((l) => ({ ...l, values: l.values.slice(firstCol) }))}
          height={160} format={(v) => String(Math.round(v))} legend={lines.length > 1} onSel={setSel} />
      )}
      {months.length > 0 && (
        <View style={{ gap: 4 }}>
          <View style={styles.between}><Text style={[styles.th, { color: t.muted }]}>Month</Text><Text style={[styles.th, { color: t.muted }]}>Score</Text><Text style={[styles.th, { color: t.muted }]}>Card use</Text></View>
          {months.map(({ m, list }) => (
            <View key={m} style={styles.between}>
              <Text style={[styles.td, { color: t.text }]}>{shortDate(`${m}-01`).split(' ')[0]} {m.slice(0, 4)}</Text>
              <Text style={[styles.td, { color: t.text }]}>{list.map((s) => (used.length > 1 ? `${s.score} ${s.bureau[0]}` : String(s.score))).join(' · ')}</Text>
              <Text style={[styles.td, { color: t.muted }]}>{util.has(m) ? `${Math.round(util.get(m)!)}%` : '–'}</Text>
            </View>
          ))}
        </View>
      )}
      <Button title="Log a score" kind="plain" onPress={() => setLogging(true)} />
      {logging && <ScoreSheet scores={scores} onClose={() => setLogging(false)} onSaved={() => setN((x) => x + 1)} />}
    </View>
  );
  return <Card style={{ gap: 8 }}><Text style={[styles.h, { color: t.muted }]}>CREDIT SCORE</Text>{body}</Card>;
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
        <Field t={t} label={`Logged · ${scores.length}`}>
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled contentContainerStyle={{ gap: 8 }}>
          {[...scores].reverse().map((s) => (
            <View key={s.id} style={styles.between}>
              <Text style={{ color: t.text, fontSize: 13 }}>{shortDate(s.date)} {s.date.slice(0, 4)} · {s.score} · {s.bureau}</Text>
              <Pressable onPress={() => remove(s.id)} hitSlop={8} accessibilityLabel="Delete score"><Text style={{ color: t.danger }}>Delete</Text></Pressable>
            </View>
          ))}
          </ScrollView>
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
