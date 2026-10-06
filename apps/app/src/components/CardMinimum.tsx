// A card's minimum payment: how it is worked out, and a statement checked against the bank to find the
// card's own rule (banks differ: $10 + interest, 3% with a floor, a share plus interest, rounded up…).
import { formatMoney, minimumPayment, minimumRuleText, parseMoney, shortDate, type MinimumRule } from '@budget-app/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { Button } from '@/components/ui';
import { addCheck, resetMinimum, type CardMinimum } from '@/lib/cardMinimums';
import type { Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';

/** The line under a card's statement: which rule the minimum uses, and a way to check it. */
export function MinimumLine({ t, had, onCheck }: { t: Theme; had: CardMinimum; onCheck: () => void }) {
  return (
    <Text style={{ color: t.muted, fontSize: 12 }}>
      Minimum: {had.rule ? `${minimumRuleText(had.rule)} (from ${had.checks.length} statement${had.checks.length === 1 ? '' : 's'} checked)` : '3% of the balance, at least $10 (an estimate)'}.{' '}
      <Text style={{ color: t.accent, fontWeight: '600' }} onPress={onCheck}>{had.rule ? 'Check another statement' : 'Check against a statement'}</Text>
    </Text>
  );
}

/**
 * Enter what the bank's statement says; the balance and the interest and fees on it start from what the app
 * worked out. The rules that give the bank's minimum (on this and earlier checks) are shown to pick from.
 */
export function MinimumCheckSheet({ t, accountId, had, initial, onClose, onSaved }: {
  t: Theme; accountId: string; had: CardMinimum; initial: { close: string; balance: number; charges: number; plans: number }; onClose: () => void; onSaved: () => void;
}) {
  const [close, setClose] = useState(initial.close);
  const [balance, setBalance] = useState(initial.balance.toFixed(2));
  const [charges, setCharges] = useState(initial.charges.toFixed(2));
  const [plans, setPlans] = useState(initial.plans.toFixed(2));
  const [minimum, setMinimum] = useState('');
  const [result, setResult] = useState<{ fits: MinimumRule[]; saved: MinimumRule | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = useChanged([close, balance, charges, plans, minimum]) && !result;
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const num = (s: string) => parseMoney(s) ?? NaN;
  const check = { close, balance: num(balance), charges: num(charges), minimum: num(minimum), plans: plans.trim() ? num(plans) : 0 };
  const ok = Number.isFinite(check.balance) && Number.isFinite(check.charges) && Number.isFinite(check.plans) && Number.isFinite(check.minimum) && check.minimum > 0;
  const run = async (pick?: MinimumRule) => {
    setBusy(true);
    try {
      const r = await addCheck(accountId, had, check, pick);
      setResult(r); onSaved();
      if (pick) { toast(`Minimum: ${minimumRuleText(pick)}`); onClose(); }
    } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title="Check the minimum payment" dirty={dirty} onClose={onClose}
      footer={result ? <Button title="Done" onPress={onClose} /> : <Button title="Check" disabled={!ok || busy} onPress={() => run()} />}>
      {!result ? (
        <>
          <Text style={{ color: t.muted, fontSize: 13 }}>From one of the card's statements. The app finds the rule that gives the bank's minimum; a second statement (one with interest and one without is best) makes it certain.</Text>
          <Field t={t} label="Statement closing date"><DateField value={close} onChange={setClose} /></Field>
          <Field t={t} label="Statement balance" hint="The new balance (or amount due) on the statement.">
            <TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" style={input} accessibilityLabel="Statement balance" />
          </Field>
          <Field t={t} label="Interest and fees on it" hint="Worked out from the card's transactions; change it to what the statement shows.">
            <TextInput value={charges} onChangeText={setCharges} keyboardType="decimal-pad" style={input} accessibilityLabel="Interest and fees" />
          </Field>
          <Field t={t} label="Payment plan instalments on it" hint="What the statement bills for payment plans this month (0 if none). Many banks add it to the minimum.">
            <TextInput value={plans} onChangeText={setPlans} keyboardType="decimal-pad" style={input} accessibilityLabel="Payment plan instalments" />
          </Field>
          <Field t={t} label="Minimum payment on the statement">
            <TextInput value={minimum} onChangeText={setMinimum} keyboardType="decimal-pad" placeholder="e.g. 35.90" placeholderTextColor={t.muted} style={input} accessibilityLabel="Minimum payment" autoFocus />
          </Field>
        </>
      ) : result.fits.length ? (
        <>
          <Text style={{ color: t.text }}>{result.fits.length === 1 ? 'This rule gives the bank’s minimum, and is saved for this card:' : `${result.fits.length} rules give the bank’s minimum. The first is saved; pick another if you know it, or check another statement to narrow it down.`}</Text>
          {result.fits.slice(0, 6).map((r, i) => (
            <Pressable key={i} onPress={() => run(r)} disabled={busy} style={({ hovered }: any) => [styles.fit, { borderColor: i === 0 ? t.accent : t.line }, hovered && { backgroundColor: t.line }]}>
              <Text style={{ color: t.text, flex: 1 }}>{minimumRuleText(r)}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{formatMoney(minimumPayment(check.balance, r, check.charges, check.plans))}</Text>
            </Pressable>
          ))}
        </>
      ) : (
        <Text style={{ color: t.text }}>
          No usual rule gives {formatMoney(check.minimum)} on {formatMoney(check.balance)} with {formatMoney(check.charges)} of interest and fees{had.checks.length ? ', together with the statements checked before' : ''}. The check of {shortDate(close)} is kept{had.rule ? ` and the card keeps “${minimumRuleText(had.rule)}”` : ' and the estimate stays'}. Check the interest and fees figure: it is the part most often different.
        </Text>
      )}
      {had.checks.length > 0 && !result && (
        <Pressable onPress={async () => { await resetMinimum(accountId); onSaved(); onClose(); toast('Back to the estimate'); }} hitSlop={6}>
          <Text style={{ color: t.danger, fontSize: 13 }}>Forget the {had.checks.length} statement{had.checks.length === 1 ? '' : 's'} checked and go back to the estimate</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  fit: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
});
