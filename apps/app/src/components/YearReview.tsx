// Year in review: a year's money in and out and what was saved, its best and worst months, where the money went
// against the year before (the same months, for a year still going), the top merchants and how net worth moved.
// Opened from Reports and from December's monthly review.
import { actualFor, addMonths, formatMoney, monthEnd, monthName, type Month } from '@budget-app/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { useTxnSheet } from '@/components/TxnSheet';
import { Bar, Button, Chip } from '@/components/ui';
import { today } from '@/lib/plan';
import { loadCategories, loadCategoryMonths, loadMerchants, loadMonthSummaries, thisMonth, totalsFor, type MerchantTotal } from '@/lib/reports';
import { useTheme, type Theme } from '@/lib/theme';
import { loadChart } from '@/lib/widgetData';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

let openYear: number | null = null;
const subs = new Set<() => void>();
export function openYearReview(year: number) { openYear = year; subs.forEach((f) => f()); }
const setYear = (y: number | null) => { openYear = y; subs.forEach((f) => f()); };
const useOpenYear = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => openYear, () => null);

/** Mounted once at the root, next to the monthly review. */
export function YearReview() {
  const year = useOpenYear();
  return year ? <YearSheet year={year} /> : null;
}

interface Data {
  year: number; months: Month[]; partial: boolean; ongoing: boolean; upTo: string;
  income: number; spending: number; before: { income: number; spending: number } | null;
  best: { month: Month; net: number } | null; worst: { month: Month; net: number } | null;
  byMonth: { month: Month; spending: number; net: number }[];
  cats: { id: string | null; name: string; now: number; then: number }[];
  merchants: MerchantTotal[];
  worth: { start: number; end: number } | null;
  years: number[];
}

async function loadYear(year: number): Promise<Data> {
  const first = `${year}-01-01` as Month;
  const last = thisMonth();
  // The months of the year with something in them, up to this one.
  const all = await loadMonthSummaries();
  // From the first month with anything in it (a year the app started partway through starts there).
  // A year it stopped partway through ends at its last month (this year runs to this month).
  const used = all.filter((s) => s.txns > 0 && s.month >= first && s.month < addMonths(first, 12)).map((s) => s.month).sort();
  const startAt = used[0] ?? first, stopAt = year === Number(last.slice(0, 4)) ? last : used[used.length - 1] ?? addMonths(first, 11);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i)).filter((m) => m >= startAt && m <= stopAt && m <= last);
  const end = months[months.length - 1];
  const partial = months.length < 12;
  const upTo = end === last ? today() : monthEnd(end);
  const prev = months.map((m) => addMonths(m, -12));
  const [cats, rows, merchants, worth] = await Promise.all([
    loadCategories(),
    loadCategoryMonths(prev[0], end),
    loadMerchants(months[0], upTo),
    loadChart({ source: 'networth', view: 'line' }, undefined, { from: months[0], to: upTo }).catch(() => null),
  ]);
  const of = (ms: Month[]) => all.filter((s) => ms.includes(s.month));
  const sum = (ms: Month[]) => of(ms).reduce((x, s) => ({ income: x.income + s.income, spending: x.spending + Math.abs(s.spending) }), { income: 0, spending: 0 });
  const mine = of(months);
  const byMonth = months.map((m) => { const s = mine.find((x) => x.month === m); return { month: m, spending: Math.abs(s?.spending ?? 0), net: (s?.income ?? 0) - Math.abs(s?.spending ?? 0) }; });
  // Best and worst over whole months with something in them (the month still going isn't judged).
  const judged = byMonth.filter((m) => m.month < last && mine.some((x) => x.month === m.month && x.txns > 0));
  const sorted = [...judged].sort((a, b) => b.net - a.net);
  const now = totalsFor(rows, months), then = totalsFor(rows, prev);
  const expense = cats.filter((c) => c.kind === 'expense');
  const catRows = expense.map((c) => ({ id: c.id as string | null, name: c.name, now: actualFor('expense', now.get(c.id) ?? 0), then: actualFor('expense', then.get(c.id) ?? 0) }));
  const loose = actualFor('expense', (now.get(null) ?? 0)), looseThen = actualFor('expense', (then.get(null) ?? 0));
  if (loose > 0.5) catRows.push({ id: null, name: 'Uncategorised', now: loose, then: looseThen });
  const sumWorth = (i: number) => worth?.series.reduce((x, s) => x + (s.values[i] ?? 0), 0) ?? 0;
  const n = worth?.series[0]?.values.length ?? 0;
  const had = sum(prev);
  return {
    year, months, partial, ongoing: end === last, upTo, ...sum(months),
    before: had.income || had.spending ? had : null,
    best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    byMonth,
    cats: catRows.filter((c) => c.now > 0.5).sort((a, b) => b.now - a.now),
    merchants: merchants.slice(0, 6),
    worth: n > 1 ? { start: sumWorth(0), end: sumWorth(n - 1) } : null,
    years: [...new Set(all.filter((s) => s.txns > 0).map((s) => Number(s.month.slice(0, 4))))].sort((a, b) => b - a),
  };
}

function YearSheet({ year }: { year: number }) {
  const t = useTheme();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [allCats, setAllCats] = useState(false);
  useEffect(() => { setD(null); setError(''); loadYear(year).then(setD).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [year]);
  const close = () => setYear(null);
  const [showTxns, txnSheet] = useTxnSheet();
  const net = d ? d.income - d.spending : 0;
  const rate = d && d.income > 0 ? Math.round((net / d.income) * 100) : null;
  const span = d?.partial ? `${monthName(d.months[0], false).slice(0, 3)}–${monthName(d.months[d.months.length - 1], false).slice(0, 3)}` : '';
  const top = d ? (allCats ? d.cats : d.cats.slice(0, 8)) : [];
  const maxCat = Math.max(1, ...top.map((c) => c.now));
  const maxMonth = Math.max(1, ...(d?.byMonth.map((m) => m.spending) ?? [1]));
  const years = d?.years.length ? d.years : [year];
  return (
    <Sheet title={`${year} in review`} onClose={close} footer={<Button title="Done" onPress={close} />}>
      {years.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {years.map((y) => <Chip key={y} label={String(y)} on={y === year} onPress={() => setYear(y)} />)}
        </ScrollView>
      )}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {!d && !error && <Text style={{ color: t.muted }}>Adding it up…</Text>}
      {d && (
        <View style={{ gap: 18 }}>
          {d.partial && <Text style={{ color: t.muted, fontSize: 13 }}>{d.ongoing ? `${year} so far` : year} ({span}){d.before ? `; compared with the same months of ${year - 1}` : ''}.</Text>}
          <View style={styles.tiles}>
            <Tile t={t} label="Money in" value={money0(d.income)} sub={change(d.income, d.before?.income)} />
            <Tile t={t} label="Spent" value={money0(d.spending)} sub={change(d.spending, d.before?.spending)} />
            <Tile t={t} label={net >= 0 ? 'Saved' : 'Over'} value={money0(Math.abs(net))} color={net >= 0 ? t.positive : t.danger} sub={rate != null && net >= 0 ? `${rate}% of income` : undefined} />
          </View>
          {d.before && (
            <Text style={{ color: t.text }}>
              {(() => {
                const was = d.before.income - d.before.spending;
                const diff = net - was;
                return Math.abs(diff) < 1 ? `You saved about the same as ${year - 1}.` : `You saved ${money0(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${d.partial ? `the same months of ${year - 1}` : year - 1} (${was >= 0 ? `${money0(was)} saved` : `${money0(-was)} over`}).`;
              })()}
            </Text>
          )}

          <Section t={t} title="Month by month">
            {d.byMonth.map((m) => (
              <View key={m.month} style={styles.row}>
                <Text style={{ color: t.muted, width: 34, fontSize: 13 }}>{monthName(m.month, false).slice(0, 3)}</Text>
                <View style={{ flex: 1 }}><Bar value={m.spending} max={maxMonth} color={t.series2} height={8} /></View>
                <Text style={{ color: t.text, width: 72, textAlign: 'right', fontVariant: ['tabular-nums'], fontSize: 13 }}>{money0(m.spending)}</Text>
                <Text style={{ color: m.net >= 0 ? t.positive : t.danger, width: 72, textAlign: 'right', fontVariant: ['tabular-nums'], fontSize: 13 }}>{m.net >= 0 ? '+' : '−'}{money0(Math.abs(m.net))}</Text>
              </View>
            ))}
            <Text style={{ color: t.muted, fontSize: 12 }}>Spent, and what was left after spending (+) or over (−).</Text>
            {d.best && <Row t={t} left={`Best month: ${monthName(d.best.month, false)}`} right={`${d.best.net >= 0 ? '+' : '−'}${money0(Math.abs(d.best.net))}`} color={d.best.net >= 0 ? t.positive : t.danger} />}
            {d.worst && <Row t={t} left={`Hardest month: ${monthName(d.worst.month, false)}`} right={`${d.worst.net >= 0 ? '+' : '−'}${money0(Math.abs(d.worst.net))}`} color={d.worst.net < 0 ? t.danger : undefined} />}
          </Section>

          {d.cats.length > 0 && (
            <Section t={t} title="Where it went">
              {top.map((c) => {
                const p = pct(c.now, c.then);
                return (
                  <View key={c.id ?? 'none'} style={{ gap: 3 }}>
                    <Row t={t} left={c.name} right={money0(c.now)}
                      note={!d.before ? undefined : c.then < 0.5 ? 'new' : p == null || Math.abs(p) < 5 ? 'about the same' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`}
                      noteColor={p != null && p >= 5 && c.then >= 0.5 ? t.danger : p != null && p <= -5 ? t.positive : t.muted}
                      onPress={() => showTxns({ title: `${c.name} · ${year}`, from: d.months[0], to: d.upTo, ...(c.id ? { categoryIds: [c.id] } : { category: 'none' }) })} />
                    <Bar value={c.now} max={maxCat} color={t.accent} height={5} />
                  </View>
                );
              })}
              {d.cats.length > 8 && <Button title={allCats ? 'Fewer' : `All ${d.cats.length} categories`} kind="plain" onPress={() => setAllCats(!allCats)} />}
              {d.before && (() => {
                const ups = d.cats.filter((c) => c.then >= 0.5 && c.now - c.then > 0).sort((a, b) => (b.now - b.then) - (a.now - a.then))[0];
                const downs = d.cats.filter((c) => c.then >= 0.5 && c.now - c.then < 0).sort((a, b) => (a.now - a.then) - (b.now - b.then))[0];
                return (
                  <Text style={{ color: t.muted, fontSize: 13 }}>
                    {ups ? `Up the most: ${ups.name} (+${money0(ups.now - ups.then)}).` : ''}{downs ? ` Down the most: ${downs.name} (−${money0(downs.then - downs.now)}).` : ''}
                  </Text>
                );
              })()}
            </Section>
          )}

          {d.merchants.length > 0 && (
            <Section t={t} title="Top places">
              {d.merchants.map((m) => <Row key={m.merchant} t={t} left={m.merchant} onPress={() => showTxns({ title: `${m.merchant} · ${year}`, from: d.months[0], to: d.upTo, merchant: m.merchant, kind: 'expense' })} right={money0(Math.abs(m.total))} note={`${m.txns}×`} noteColor={t.muted} />)}
            </Section>
          )}

          {d.worth && (
            <Section t={t} title="Net worth">
              <Row t={t} left={`${monthName(d.months[0], false).slice(0, 3)} → ${d.ongoing ? 'now' : monthName(d.months[d.months.length - 1], false).slice(0, 3)}`} right={`${money0(d.worth.start)} → ${money0(d.worth.end)}`} />
              <Text style={{ color: d.worth.end >= d.worth.start ? t.positive : t.danger }}>
                {d.worth.end >= d.worth.start ? 'Up' : 'Down'} {money0(Math.abs(d.worth.end - d.worth.start))} over the year{d.ongoing ? ' so far' : ''}.
              </Text>
            </Section>
          )}
        </View>
      )}
      {txnSheet}
    </Sheet>
  );
}

function change(now: number, before: number | undefined) {
  if (before == null || !before) return undefined;
  const p = pct(now, before)!;
  return Math.abs(p) < 1 ? 'same as before' : `${p > 0 ? '+' : '−'}${Math.abs(p)}% on last year`;
}

function Tile({ t, label, value, color, sub }: { t: Theme; label: string; value: string; color?: string; sub?: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: color ?? t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 11 }}>{sub}</Text>}
    </View>
  );
}
function Section({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{title.toUpperCase()}</Text>{children}</View>;
}
function Row({ t, left, right, color, note, noteColor, onPress }: { t: Theme; left: string; right: string; color?: string; note?: string; noteColor?: string; onPress?: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={{ color: t.text, flex: 1 }} numberOfLines={1} onPress={onPress}>{left}</Text>
      {!!note && <Text style={{ color: noteColor ?? t.muted, fontSize: 12 }}>{note}</Text>}
      <Text style={{ color: color ?? t.text, fontVariant: ['tabular-nums'] }}>{right}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
