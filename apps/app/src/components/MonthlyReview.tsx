// Monthly review (IDEA-13): the first time the app opens in a new month (in its first 10 days), a
// one-screen recap of the month before: money in and out, how the budget went, the biggest changes,
// transactions still to review and how the goals are doing. Also opened from the Budget tab.
import { txnHref } from '@/lib/txnLinks';
import { addMonths, actualFor, biggestChanges, buildBudgetMonth, formatMoney, monthEnd, monthName, type Month } from '@budget-app/core';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Bar, Button } from '@/components/ui';
import { loadGoals, type Goal } from '@/lib/goals';
import { useOffline } from '@/lib/offline';
import { today } from '@/lib/plan';
import { loadPrefs, savePrefs } from '@/lib/prefs';
import { loadBudgets, loadCategories, loadCategoryMonths, loadMonthSummaries, thisMonth, totalsFor } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { afterClose } from '@/lib/useBackToClose';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
const SEEN = 'review:';

// Which month's review is open (anywhere in the app can ask for one).
let openMonth: Month | null = null;
const subs = new Set<() => void>();
export function openReview(month: Month) { openMonth = month; subs.forEach((f) => f()); }
const closeReview = () => { openMonth = null; subs.forEach((f) => f()); };
const useOpenMonth = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => openMonth, () => null);

interface Review {
  month: Month; income: number; spending: number;
  over: { label: string; by: number }[]; under: number; budgeted: number;
  changes: ReturnType<typeof biggestChanges>; toReview: number; goals: Goal[];
}

async function loadReview(month: Month): Promise<Review> {
  const before = addMonths(month, -1);
  const [sums, cats, budgets, rows, unreviewed, goals] = await Promise.all([
    loadMonthSummaries(month, monthEnd(month)),
    loadCategories(),
    loadBudgets(),
    loadCategoryMonths(before, month),
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('reviewed', false).gte('date', month).lte('date', monthEnd(month)),
    loadGoals().then((r) => r.goals.filter((g) => !g.closed_on)).catch(() => [] as Goal[]),
  ]);
  const s = sums[0];
  const view = buildBudgetMonth(cats, budgets.filter((b) => b.month === month), totalsFor(rows, month));
  const lines = view.expenses.filter((l) => l.available > 0);
  const over = lines.filter((l) => l.actual > l.available + 0.5).map((l) => ({ label: l.label, by: l.actual - l.available })).sort((a, b) => b.by - a.by);
  const spent = (m: Month) => new Map(cats.filter((c) => c.kind === 'expense').map((c) => [c.id, actualFor('expense', totalsFor(rows, m).get(c.id) ?? 0)]));
  return {
    month, income: s?.income ?? 0, spending: Math.abs(s?.spending ?? 0),
    over, under: lines.filter((l) => l.actual <= l.available).reduce((x, l) => x + (l.available - l.actual), 0), budgeted: lines.length,
    changes: biggestChanges(cats.filter((c) => c.kind === 'expense' && !c.hidden), spent(month), spent(before), 4),
    toReview: unreviewed.count ?? 0, goals,
  };
}

/** Mounted once at the root: opens last month's review on the first visit of a month, and any review asked for. */
export function MonthlyReview() {
  const offline = useOffline().offline;
  const month = useOpenMonth();
  useEffect(() => {
    // Opened from the "review ready" notification: straight to last month's review.
    if (typeof location !== 'undefined' && /[?&]review=1/.test(location.search)) {
      history.replaceState(history.state, '', location.pathname);
      setTimeout(() => openReview(addMonths(thisMonth(), -1)), 1200);
      return;
    }
    if (offline) return;
    const now = today(), last = addMonths(thisMonth(), -1);
    if (Number(now.slice(8, 10)) > 10) return;
    let live = true, tries = 0;
    loadPrefs().then((p) => {
      if (!live || (p.dismissed_suggestions ?? []).includes(SEEN + last)) return;
      // Wait for other pop-ups (the import reminder, a lock screen) to be out of the way.
      const go = () => { if (!live) return; if (document.querySelector('[aria-modal="true"]') && tries++ < 20) setTimeout(go, 3000); else openReview(last); };
      setTimeout(go, 2500);
    }).catch(() => {});
    return () => { live = false; };
  }, [offline]);
  return month ? <ReviewSheet month={month} /> : null;
}

function ReviewSheet({ month }: { month: Month }) {
  const t = useTheme();
  const [r, setR] = useState<Review | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { loadReview(month).then(setR).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [month]);
  const close = () => {
    closeReview();
    loadPrefs().then((p) => savePrefs({ dismissed_suggestions: [...new Set([...(p.dismissed_suggestions ?? []).filter((k) => !k.startsWith(SEEN)), SEEN + month])] })).catch(() => {});
  };
  const go = (href: any) => { close(); afterClose(() => router.navigate(href)); };
  const net = r ? r.income - r.spending : 0;
  return (
    <Sheet title={`${monthName(month)} in review`} onClose={close}
      footer={<Button title="Done" onPress={close} />}>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {!r && !error && <Text style={{ color: t.muted }}>Adding it up…</Text>}
      {r && (
        <View style={{ gap: 18 }}>
          <View style={styles.tiles}>
            <Tile t={t} label="Money in" value={money0(r.income)} />
            <Tile t={t} label="Spent" value={money0(r.spending)} />
            <Tile t={t} label={net >= 0 ? 'Saved' : 'Over'} value={money0(Math.abs(net))} color={net >= 0 ? t.positive : t.danger} />
          </View>
          <Section t={t} title="Budget">
            {!r.budgeted ? <Text style={{ color: t.muted }}>No budget was set for {monthName(r.month)}.</Text> : !r.over.length
              ? <Text style={{ color: t.text }}>Every budget line stayed within its amount{r.under > 0 ? `, with ${money0(r.under)} left over` : ''}. 🎉</Text>
              : <>
                <Text style={{ color: t.text }}>{r.over.length} of {r.budgeted} lines went over{r.under > 0 ? `; the rest had ${money0(r.under)} left` : ''}.</Text>
                {r.over.slice(0, 4).map((o) => <Row key={o.label} t={t} left={o.label} right={`${money0(o.by)} over`} color={t.danger} />)}
              </>}
          </Section>
          {r.changes.length > 0 && (
            <Section t={t} title={`Biggest changes from ${monthName(addMonths(r.month, -1)).split(' ')[0]}`}>
              {r.changes.map((c) => <Row key={c.id} t={t} left={c.name} right={`${c.change > 0 ? '+' : '−'}${money0(Math.abs(c.change))} (${money0(c.now)})`} color={c.change > 0 ? t.danger : t.positive} />)}
            </Section>
          )}
          {r.goals.length > 0 && (
            <Section t={t} title="Goals">
              {r.goals.slice(0, 5).map((g) => (
                <View key={g.id} style={{ gap: 4 }}>
                  <Row t={t} left={`${g.icon ? `${g.icon} ` : ''}${g.name}`} right={g.progress.done ? 'Done 🎉' : g.progress.onPace === false ? `${money0(g.progress.behind)} behind` : `${Math.round(g.progress.share * 100)}%`} color={g.progress.onPace === false && !g.progress.done ? t.series2 : undefined} />
                  <Bar value={g.progress.share} max={1} color={g.progress.onPace === false ? t.series2 : t.accent} height={6} />
                </View>
              ))}
            </Section>
          )}
          <View style={{ gap: 8 }}>
            {r.toReview > 0 && <Button title={`Review ${r.toReview} transaction${r.toReview === 1 ? '' : 's'} from ${monthName(r.month).split(' ')[0]}`} kind="plain" onPress={() => go(txnHref({ mode: 'review', from: r.month, to: monthEnd(r.month), label: monthName(r.month) }))} />}
            <Button title={`Open ${monthName(r.month).split(' ')[0]}'s budget`} kind="plain" onPress={() => go({ pathname: '/budget', params: { month: r.month } })} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

function Tile({ t, label, value, color }: { t: any; label: string; value: string; color?: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: color ?? t.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
function Section({ t, title, children }: { t: any; title: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{title.toUpperCase()}</Text>{children}</View>;
}
function Row({ t, left, right, color }: { t: any; left: string; right: string; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{left}</Text>
      <Text style={{ color: color ?? t.text, fontVariant: ['tabular-nums'] }}>{right}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
