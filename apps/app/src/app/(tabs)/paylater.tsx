// Pay later (buy now, pay later): every plan, what's owed in all and what's coming, and each plan's payments.
import { formatMoney, shortDate, type PayLaterStatus } from '@budget-app/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PayLaterForm, PayLaterRow, PayLaterSheet, payLaterTotals } from '@/components/PayLater';
import { EmptyState } from '@/components/States';
import { Tile } from '@/components/Tile';
import { Card, Fab } from '@/components/ui';
import { PAGE_MAX, UNDER_BAR } from '@/lib/layout';
import { loadPayLaterStatus, syncPayLater, type PayLaterPlan } from '@/lib/payLater';
import { loadAccounts, today } from '@/lib/plan';
import { usePullRefresh } from '@/lib/pullRefresh';
import { useTheme } from '@/lib/theme';
import { afterClose } from '@/lib/useBackToClose';
import type { Account } from '@/lib/types';

export default function PayLaterPage() {
  const t = useTheme();
  const [rows, setRows] = useState<{ plan: PayLaterPlan; status: PayLaterStatus }[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ plan?: PayLaterPlan } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      await syncPayLater().catch(() => 0);
      const [r, a] = await Promise.all([loadPayLaterStatus(), loadAccounts()]);
      setRows(r); setAccounts(a); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setRows([]); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePullRefresh(load);

  const now = today();
  const list = rows ?? [];
  const active = list.filter((r) => !r.status.done), finished = list.filter((r) => r.status.done);
  const tot = payLaterTotals(list, now);
  const shown = list.find((r) => r.plan.id === open);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
        {rows && !list.length && !error && (
          <EmptyState icon="bag-handle-outline" title="No pay later plans" text="Add an Affirm, Klarna, PayPal Pay in 4 or similar plan: its payments show in the planner, each one counts in your budget as it's paid, and what's owed is tracked here."
            action="Add a plan" onAction={() => setForm({})} />
        )}
        {list.length > 0 && (
          <View style={styles.tiles}>
            <Tile t={t} three label="Owing" value={formatMoney(tot.owing)} sub={`${tot.open} plan${tot.open === 1 ? '' : 's'}`} />
            <Tile t={t} three label="Next payment" value={tot.next ? formatMoney(tot.next.amount) : '—'} sub={tot.next ? `${shortDate(tot.next.date)} · ${tot.next.plan.provider}` : 'nothing due'} />
            <Tile t={t} three label="Next 30 days" value={formatMoney(tot.next30)} sub={tot.missed ? `${tot.missed} missed` : undefined} />
          </View>
        )}
        {active.length > 0 && (
          <Card style={{ gap: 0 }}>
            {active.map((r) => <PayLaterRow key={r.plan.id} t={t} plan={r.plan} status={r.status} onPress={() => setOpen(r.plan.id)} />)}
          </Card>
        )}
        {finished.length > 0 && (
          <>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>PAID OFF</Text>
            <Card style={{ gap: 0 }}>
              {finished.map((r) => <PayLaterRow key={r.plan.id} t={t} plan={r.plan} status={r.status} onPress={() => setOpen(r.plan.id)} />)}
            </Card>
          </>
        )}
        {list.length > 0 && (
          <Text style={{ color: t.muted, fontSize: 12 }}>
            Each plan's payments show in the planner as a bill and count in your budget, under what you bought, as they're paid. What's still owed is on the “Pay later” account, so net worth counts it.
          </Text>
        )}
      </ScrollView>
      <Fab label="Add a plan" onPress={() => setForm({})} />
      {shown && <PayLaterSheet plan={shown.plan} status={shown.status} accounts={accounts} onClose={() => setOpen(null)} onChanged={load}
        onEdit={() => { const plan = shown.plan; setOpen(null); afterClose(() => setForm({ plan })); }} />}
      {form && <PayLaterForm plan={form.plan} accounts={accounts} onClose={() => setForm(null)} onSaved={load} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: UNDER_BAR + 80, width: '100%', maxWidth: PAGE_MAX, alignSelf: 'center' },
  tiles: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
