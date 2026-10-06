// Balance transfers on the Credit cards page: each one with what's left of it on the new card and
// what a month clears it before the promo rate ends. Added as it happens (its transactions are linked
// when the banks list them) or after the fact (pick the transactions).
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, findTransferTxns, formatMoney, parseMoney, shortDate, toIsoDate, transferProgress } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { SinglePicker } from '@/components/Picker';
import { Bar, Button, Card, Chip } from '@/components/ui';
import { deleteTransfer, fileTransferPair, linkTransfers, saveTransfer, type CardTransfer } from '@/lib/balanceTransfers';
import { today } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import type { Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import { signedBalance, type Account } from '@/lib/types';

const money0 = (n: number) => formatMoney(Math.round(n)).replace(/\.00$/, '');

export function TransfersCard({ t, transfers, accounts, onChanged }: { t: Theme; transfers: CardTransfer[]; accounts: Account[]; onChanged: () => void }) {
  const [form, setForm] = useState<CardTransfer | 'new' | null>(null);
  const now = today();
  const cards = accounts.filter((a) => a.type === 'credit');
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'A card';
  const owed = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? Math.max(0, -signedBalance(a)) : 0; };
  const shown = transfers.filter((x) => !x.closedOn);
  if (cards.length < 2 && !transfers.length) return null;
  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.between}>
        <Text style={[styles.h, { color: t.muted }]}>BALANCE TRANSFERS</Text>
        <Pressable onPress={() => setForm('new')} hitSlop={8}><Text style={{ color: t.accent, fontWeight: '600' }}>Add a transfer</Text></Pressable>
      </View>
      {!shown.length && <Text style={{ color: t.muted, fontSize: 13 }}>Moving a balance to another card, usually at a low rate for a while? Add it as it happens or afterwards, and see what a month clears it before the rate goes up.</Text>}
      {shown.map((x) => {
        const g = transferProgress(x, owed(x.toAccountId), now);
        const total = x.amount + x.fee;
        return (
          <Pressable key={x.id} onPress={() => setForm(x)} style={({ pressed, hovered }: any) => [{ gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line }, (pressed || hovered) && { opacity: 0.75 }]}>
            <View style={styles.between}>
              <Text style={{ color: t.text, fontWeight: '600', flex: 1 }} numberOfLines={2}>{name(x.fromAccountId)} → {name(x.toAccountId)}</Text>
              <Text style={{ color: t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(g.remaining)} <Text style={{ color: t.muted }}>left of {formatMoney(total)}</Text></Text>
            </View>
            <Bar value={total - g.remaining} max={total} color={g.ended && g.remaining > 0 ? t.danger : t.accent} height={6} />
            <Text style={{ color: g.ended && g.remaining > 0 ? t.danger : t.muted, fontSize: 12 }}>
              {shortDate(x.date)} {x.date.slice(0, 4)}{x.promoApr != null ? ` · ${x.promoApr}%` : ''}{x.promoEnd ? ` until ${shortDate(x.promoEnd)} ${x.promoEnd.slice(0, 4)}` : ''}
              {g.remaining < 1 ? ' · cleared 🎉' : g.ended ? ' · the promo rate has ended' : g.perMonth ? ` · ${money0(g.perMonth)} a month clears it in time` : ''}
              {(!x.outTxnId || !x.inTxnId) ? ' · waiting for its transactions' : ''}
            </Text>
          </Pressable>
        );
      })}
      {form && <TransferForm t={t} initial={form === 'new' ? null : form} cards={cards} onClose={() => setForm(null)} onSaved={onChanged} />}
    </Card>
  );
}

interface Pick { id: string; date: string; amount: number; display_name: string; account_id: string }

function TransferForm({ t, initial, cards, onClose, onSaved }: { t: Theme; initial: CardTransfer | null; cards: Account[]; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(initial?.fromAccountId ?? '');
  const [to, setTo] = useState(initial?.toAccountId ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [fee, setFee] = useState(initial?.fee ? String(initial.fee) : '');
  const [date, setDate] = useState(initial?.date ?? today());
  const [apr, setApr] = useState(initial?.promoApr != null ? String(initial.promoApr) : '');
  const [end, setEnd] = useState(initial?.promoEnd ?? '');
  const [links, setLinks] = useState({ outTxnId: initial?.outTxnId ?? null, inTxnId: initial?.inTxnId ?? null, feeTxnId: initial?.feeTxnId ?? null });
  const [rows, setRows] = useState<Pick[]>([]);
  const [picking, setPicking] = useState<keyof typeof links | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmSheet] = useConfirm();
  const changed = useChanged([from, to, amount, fee, date, apr, end, JSON.stringify(links)]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  const d = toIsoDate(date);
  // Both cards' transactions around the date, to link by hand (after the fact, or when one wasn't found).
  useEffect(() => {
    if (!from || !to || !d) { setRows([]); return; }
    supabase.from('transaction_list').select('id, date, amount, display_name, account_id').in('account_id', [from, to]).eq('pending', false)
      .gte('date', addDays(d, -10)).lte('date', addDays(d, 40)).order('date').limit(300)
      .then(({ data }) => setRows(((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount) }))));
  }, [from, to, d]);
  // What would be linked: the ones picked, else the matches among those rows (shown as found).
  const guess = (() => {
    const a = parseMoney(amount), f = fee.trim() ? parseMoney(fee) : 0;
    if (!d || !from || !to || !(a > 0)) return { out: null, into: null, fee: null };
    return findTransferTxns({ id: 'new', fromAccountId: from, toAccountId: to, amount: a, fee: isNaN(f) ? 0 : f, date: d, promoApr: null, promoEnd: null }, rows);
  })();
  const shownLinks = { outTxnId: links.outTxnId ?? guess.out?.id ?? null, inTxnId: links.inTxnId ?? guess.into?.id ?? null, feeTxnId: links.feeTxnId ?? guess.fee?.id ?? null };
  const label = (id: string | null) => { const r = rows.find((x) => x.id === id); return r ? `${shortDate(r.date)} · ${r.display_name} · ${formatMoney(r.amount)}` : id ? 'Linked' : 'Not linked yet'; };
  const pickList = (k: keyof typeof links) => rows.filter((r) => (k === 'outTxnId' ? r.account_id === from && r.amount > 0 : r.account_id === to && r.amount < 0));

  const save = async () => {
    const a = parseMoney(amount), f = fee.trim() ? parseMoney(fee) : 0, rate = apr.trim() ? Number(apr) : null, e = end ? toIsoDate(end) : null;
    if (!from || !to || from === to) { setError('Pick the card it came from and the card it went to.'); return; }
    if (!(a > 0) || isNaN(f) || f < 0) { setError('Check the amount and the fee.'); return; }
    if (!d) { setError('That date isn’t a date.'); return; }
    if (rate != null && (isNaN(rate) || rate < 0)) { setError('The promo rate is a yearly percentage, like 0 or 1.99.'); return; }
    setBusy(true); setError('');
    try {
      const id = await saveTransfer(initial?.id ?? null, { fromAccountId: from, toAccountId: to, amount: Math.abs(a), fee: Math.abs(f), date: d, promoApr: rate, promoEnd: e, ...shownLinks });
      // File the two sides as a pair now; anything still missing is looked for as the banks list it.
      if (shownLinks.outTxnId !== (initial?.outTxnId ?? null) || shownLinks.inTxnId !== (initial?.inTxnId ?? null)) await fileTransferPair(shownLinks.outTxnId, shownLinks.inTxnId);
      await linkTransfers([{ id, fromAccountId: from, toAccountId: to, amount: Math.abs(a), fee: Math.abs(f), date: d, promoApr: rate, promoEnd: e, ...shownLinks, closedOn: null }]);
      toast(initial ? 'Transfer saved' : 'Transfer added'); onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const remove = () => confirm({ title: 'Delete this transfer?', message: 'Its two transactions stay, no longer paired.', action: 'Delete',
    run: async () => { try { await deleteTransfer(initial!); toast('Transfer deleted'); onSaved(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } } });
  const pct = (p: number) => { const a = parseMoney(amount); if (a > 0) setFee((Math.round(a * p) / 100).toFixed(2)); };

  return (
    <Sheet title={initial ? 'Balance transfer' : 'New balance transfer'} dirty={changed && !busy} onClose={onClose} footer={<Button title="Save" onPress={save} busy={busy} />}>
      <Field t={t} label="From (the card paid off)"><View style={styles.chips}>{cards.map((c) => <Chip key={c.id} label={c.name} on={from === c.id} onPress={() => setFrom(c.id)} />)}</View></Field>
      <Field t={t} label="To (the card that now carries it)"><View style={styles.chips}>{cards.filter((c) => c.id !== from).map((c) => <Chip key={c.id} label={c.name} on={to === c.id} onPress={() => setTo(c.id)} />)}</View></Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Amount moved"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field></View>
      </View>
      <Field t={t} label="Fee" hint="What the new card charges for the transfer.">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={[input, { flex: 1 }]} accessibilityLabel="Fee" />
          {[1, 3, 5].map((p) => <Chip key={p} label={`${p}%`} on={false} onPress={() => pct(p)} />)}
        </View>
      </Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Promo rate (% a year)"><TextInput value={apr} onChangeText={setApr} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Promo ends"><DateField value={end} onChange={setEnd} min={d ?? undefined} /></Field></View>
      </View>
      <Field t={t} label="Its transactions" hint="Found by themselves when the banks list them; pick them here if it happened a while ago or one wasn’t found.">
        {([['outTxnId', `Credit on ${cards.find((c) => c.id === from)?.name ?? 'the old card'}`], ['inTxnId', `Charge on ${cards.find((c) => c.id === to)?.name ?? 'the new card'}`], ['feeTxnId', 'The fee']] as const).map(([k, what]) => (
          <Pressable key={k} onPress={() => (from && to ? setPicking(k) : setError('Pick both cards first.'))} style={[styles.pick, { borderColor: t.line, backgroundColor: t.card }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.muted, fontSize: 12 }}>{what}</Text>
              <Text style={{ color: shownLinks[k] ? t.text : t.muted }} numberOfLines={1}>{label(shownLinks[k])}{!links[k] && shownLinks[k] ? '  (found)' : ''}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={t.muted} />
          </Pressable>
        ))}
      </Field>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      {initial && <Button title="Delete transfer" kind="danger" disabled={busy} onPress={remove} />}
      <SinglePicker visible={!!picking} title="Transaction" selected={picking ? links[picking] ?? 'none' : null} onClose={() => setPicking(null)}
        items={[{ id: 'none', label: 'Not linked' }, ...(picking ? pickList(picking) : []).map((r) => ({ id: r.id, label: `${shortDate(r.date)} · ${r.display_name}`, detail: formatMoney(r.amount) }))]}
        onPick={(id) => { if (picking) setLinks((l) => ({ ...l, [picking]: id === 'none' ? null : id })); setPicking(null); }} />
      {confirmSheet}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  h: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
});
