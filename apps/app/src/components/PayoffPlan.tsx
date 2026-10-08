// Payoff plan (on Credit cards): one monthly amount for all the cards, the minimums paid first and the rest put on
// one card at a time, by highest interest rate (avalanche) or smallest balance (snowball); see core/debts.ts.
// Payment plans keep their own instalments, so they aren't part of it.
import { formatMoney, monthName, parseMoney, payoffPlan, transferProgress, type Debt, type Strategy } from '@budget-app/core';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip } from '@/components/ui';
import type { CardTransfer } from '@/lib/balanceTransfers';
import { ruleFor, type CardMinimum } from '@/lib/cardMinimums';
import { today } from '@/lib/plan';
import type { Theme } from '@/lib/theme';
import { bankBalance, type Account } from '@/lib/types';

const KEY = 'budget.payoff';
const ASSUMED_APR = 20.99;
const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');
const saved = (): { monthly?: string; strategy?: Strategy } => { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
const remember = (v: object) => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...saved(), ...v })); } catch { /* this visit only */ } };
const monthsTo = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
const when = (m: string | null) => (m ? monthName(m, true) : 'never at this pace');

export function PayoffPlan({ t, cards, transfers, minimums }: { t: Theme; cards: Account[]; transfers: CardTransfer[]; minimums: Map<string, CardMinimum> }) {
  const now = today();
  // Each card as owed to the bank (payment plans the bank shows apart keep their own schedule), with its promo
  // balance transfers.
  const debts: Debt[] = useMemo(() => cards.map((a) => {
    const owed = Math.max(0, -bankBalance(a));
    const promos = transfers.filter((x) => x.toAccountId === a.id && !x.closedOn && x.promoEnd && x.promoEnd > now);
    const promo = promos.length ? {
      balance: Math.min(owed, promos.reduce((s, x) => s + transferProgress(x, owed, now).remaining, 0)),
      apr: Math.max(...promos.map((x) => x.promoApr ?? 0)),
      until: promos.map((x) => x.promoEnd!).sort()[0],
    } : null;
    return { id: a.id, name: a.name, balance: owed, apr: a.apr != null ? Number(a.apr) : ASSUMED_APR, rule: ruleFor(minimums, a.id), promo };
  }).filter((d) => d.balance > 0.005), [cards, transfers, minimums, now]);
  const noRate = cards.filter((a) => a.apr == null && Math.max(0, -bankBalance(a)) > 0).map((a) => a.name);

  const minimums0 = payoffPlan(debts, 0, 'minimums', now).minimums;
  const [monthly, setMonthly] = useState(saved().monthly ?? '');
  const [strategy, setStrategy] = useState<Strategy>(saved().strategy === 'snowball' ? 'snowball' : 'avalanche');
  const fallback = Math.ceil((minimums0 + 100) / 50) * 50;
  const typed = parseMoney(monthly);
  const amount = monthly.trim() && !isNaN(typed) ? Math.abs(typed) : fallback;

  const plan = useMemo(() => payoffPlan(debts, amount, strategy, now), [debts, amount, strategy, now]);
  const other = useMemo(() => payoffPlan(debts, amount, strategy === 'avalanche' ? 'snowball' : 'avalanche', now), [debts, amount, strategy, now]);
  const minOnly = useMemo(() => payoffPlan(debts, 0, 'minimums', now), [debts, now]);
  if (!debts.length) return <Text style={{ color: t.muted }}>No card balances to pay off. 🎉</Text>;

  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const byId = new Map(debts.map((d) => [d.id, d]));
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: t.text }}>Each month I can put</Text>
        <TextInput value={monthly} onChangeText={(v) => { setMonthly(v); remember({ monthly: v }); }} placeholder={String(fallback)} placeholderTextColor={t.muted}
          keyboardType="decimal-pad" style={input} accessibilityLabel="Monthly amount for the cards" />
        <Text style={{ color: t.text }}>toward my cards</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Chip label="Highest interest first" on={strategy === 'avalanche'} onPress={() => { setStrategy('avalanche'); remember({ strategy: 'avalanche' }); }} />
        <Chip label="Smallest balance first" on={strategy === 'snowball'} onPress={() => { setStrategy('snowball'); remember({ strategy: 'snowball' }); }} />
      </View>
      {amount < plan.minimums - 0.005 && (
        <Text style={{ color: t.danger, fontSize: 13 }}>That's less than this month's minimums ({formatMoney(plan.minimums)}); the plan pays the minimums anyway.</Text>
      )}

      <View style={[styles.result, { borderColor: t.line }]}>
        <Text style={{ color: t.muted, fontSize: 12 }}>DEBT-FREE</Text>
        <Text style={{ color: plan.months == null ? t.danger : t.text, fontSize: 22, fontWeight: '700' }}>{plan.months == null ? 'Not at this amount' : monthName(plan.debtFree!, true)}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {plan.months == null ? 'It only just covers the interest. Put more toward the cards each month.'
            : `${plan.months} month${plan.months === 1 ? '' : 's'} · ${money0(plan.interest)} in interest on the way`}
        </Text>
      </View>

      {plan.months != null && (
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {minOnly.months == null || (minOnly.interest > plan.interest + 1)
            ? `Minimum payments only: ${minOnly.months == null ? 'never paid off' : `${when(minOnly.debtFree)}, ${money0(minOnly.interest)} in interest`}. This plan saves ${minOnly.months == null ? 'you from that' : `${money0(minOnly.interest - plan.interest)} and ${minOnly.months - plan.months} months`}.`
            : ''}
          {debts.length < 2 ? '' : other.months != null && Math.abs(other.interest - plan.interest) >= 1
            ? ` ${strategy === 'avalanche' ? 'Smallest balance first' : 'Highest interest first'} would cost ${money0(Math.abs(other.interest - plan.interest))} ${other.interest > plan.interest ? 'more' : 'less'}${other.months !== plan.months ? ` and take ${other.months} months` : ''}.`
            : other.months != null ? ' Either order costs about the same here.' : ''}
        </Text>
      )}

      <View style={{ gap: 6 }}>
        {plan.cards.map((c, i) => {
          const d = byId.get(c.id)!;
          return (
            <View key={c.id} style={styles.row}>
              <Text style={{ color: t.muted, width: 18 }}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }} numberOfLines={1}>{c.name}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  {formatMoney(d.balance)} at {d.apr}%{d.promo ? ` (${formatMoney(d.promo.balance)} at ${d.promo.apr}% until ${monthName(d.promo.until.slice(0, 8) + '01', true)})` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: t.text }}>{when(c.paidOff)}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{money0(c.interest)} interest</Text>
              </View>
            </View>
          );
        })}
      </View>
      {plan.promoLeft.map((p) => (
        <Text key={p.id} style={{ color: t.danger, fontSize: 13 }}>
          {p.name}: about {money0(p.left)} of the promo balance would still be owing when its rate ends ({monthName(p.until.slice(0, 8) + '01', true)}), and then charged at the regular rate. About {money0(p.left / Math.max(1, monthsTo(now, p.until)))} more a month until then clears it in time.
        </Text>
      ))}
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Each card's minimum is paid first (its own rule where you've checked a statement, else 3%, at least $10); the rest goes to one card at a time, and a card paid off frees its minimum for the next. Payment plans keep their own instalments and aren't included.
        {noRate.length ? ` No interest rate set for ${noRate.join(', ')}: ${ASSUMED_APR}% is assumed (set it in the card's Details).` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 16, width: 110 },
  result: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
