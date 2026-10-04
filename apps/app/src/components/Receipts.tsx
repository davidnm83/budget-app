// Receipt pieces shared by the Receipts page and the transaction pop-up: the photo, the form to add
// or change one, and the strip of receipts attached to a transaction.
import { formatMoney, parseMoney, shortDate, toIsoDate } from '@budget-app/core';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { Field, Sheet, useChanged } from '@/components/Forms';
import { Button } from '@/components/ui';
import { today } from '@/lib/plan';
import { deleteReceipt, photoUrl, pickPhoto, receiptsFor, receiptsMatching, saveReceipt, shrinkPhoto, updateReceipt, type Receipt } from '@/lib/receipts';
import { useTheme, type Theme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import { afterClose } from '@/lib/useBackToClose';

/** A receipt's photo, fetched when shown. */
export function ReceiptPhoto({ path, size, full }: { path: string; size?: number; full?: boolean }) {
  const t = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; photoUrl(path).then((u) => live && setUrl(u)).catch(() => live && setFailed(true)); return () => { live = false; }; }, [path]);
  const box = full ? { width: '100%' as const, aspectRatio: 0.62, maxHeight: 640 } : { width: size ?? 56, height: (size ?? 56) * 1.3 };
  return (
    <View style={[box, styles.photo, { backgroundColor: t.line }]}>
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode={full ? 'contain' : 'cover'} accessibilityLabel="Receipt photo" />
        : failed ? <Text style={{ color: t.muted, fontSize: 11, textAlign: 'center' }}>Photo unavailable</Text>
        : <ActivityIndicator color={t.muted} />}
    </View>
  );
}

/**
 * Add a receipt (choose or take the photo first) or change one. With `attachTo`, a new receipt is
 * attached to that transaction straight away.
 */
export function ReceiptForm({ initial, photo: given, attachTo, onClose, onSaved }: {
  initial?: Receipt; photo?: Blob | null; attachTo?: { id: string; date: string; amount: number; merchant: string | null };
  onClose: () => void; onSaved: () => void;
}) {
  const t = useTheme();
  const [photo, setPhoto] = useState<Blob | null>(given ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState(initial?.amount != null ? initial.amount.toFixed(2) : attachTo ? Math.abs(attachTo.amount).toFixed(2) : '');
  const [date, setDate] = useState(initial?.taken_on ?? attachTo?.date ?? today());
  const [merchant, setMerchant] = useState(initial?.merchant ?? attachTo?.merchant ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = useChanged([photo, amount, date, merchant, note]);
  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }];
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);

  const choose = async (camera: boolean) => {
    setError('');
    const f = await pickPhoto(camera);
    if (!f) return;
    try { setPhoto(await shrinkPhoto(f)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const save = async () => {
    const a = amount.trim() ? parseMoney(amount) : null;
    if (a != null && (isNaN(a) || a === 0)) { setError('That amount isn’t a number.'); return; }
    const d = date.trim() ? toIsoDate(date) : null;
    if (date.trim() && !d) { setError('That date isn’t a date.'); return; }
    const fields = { taken_on: d, amount: a == null ? null : Math.abs(a), merchant: merchant.trim() || null, note: note.trim() || null };
    setBusy(true); setError('');
    try {
      if (initial) await updateReceipt(initial.id, fields);
      else {
        if (!photo) { setError('Choose or take a photo first.'); setBusy(false); return; }
        await saveReceipt(photo, { ...fields, transaction_id: attachTo?.id ?? null });
      }
      toast(initial ? 'Saved' : attachTo ? 'Receipt attached' : 'Receipt added');
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!initial) return;
    try { await deleteReceipt(initial); toast('Receipt deleted'); onSaved(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Sheet title={initial ? 'Receipt' : 'Add a receipt'} dirty={changed} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {initial && <Button title="Delete" kind="danger" onPress={remove} />}
        {initial?.transaction_id && <Button title="Detach" kind="plain" onPress={async () => { await updateReceipt(initial.id, { transaction_id: null }); toast('Back in the inbox'); onSaved(); onClose(); }} />}
        <Button title={initial ? 'Save' : 'Add receipt'} onPress={save} busy={busy} style={{ flex: 1 }} />
      </View>}>
      {initial ? <ReceiptPhoto path={initial.path} full />
        : preview ? (
          <View style={{ gap: 8 }}>
            <View style={[styles.photo, { width: '100%', aspectRatio: 0.75, maxHeight: 420, backgroundColor: t.line }]}>
              <Image source={{ uri: preview }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            </View>
            <Pressable onPress={() => choose(false)} hitSlop={6}><Text style={{ color: t.accent }}>Choose a different photo</Text></Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="📷 Take photo" onPress={() => choose(true)} style={{ flex: 1 }} />
            <Button title="Choose photo" kind="plain" onPress={() => choose(false)} style={{ flex: 1 }} />
          </View>
        )}
      <Text style={{ color: t.muted, fontSize: 12 }}>
        {attachTo ? 'Attached to this transaction.' : 'The amount and date are optional; with them, the app finds the transaction when it syncs.'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field t={t} label="Total"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.muted} style={input} /></Field></View>
        <View style={{ flex: 1 }}><Field t={t} label="Date"><DateField value={date} onChange={setDate} /></Field></View>
      </View>
      <Field t={t} label="Store (optional)"><TextInput value={merchant} onChangeText={setMerchant} placeholder="e.g. Loblaws" placeholderTextColor={t.muted} style={input} /></Field>
      <Field t={t} label="Note (optional)"><TextInput value={note} onChangeText={setNote} placeholder="e.g. split: groceries and household" placeholderTextColor={t.muted} style={input} /></Field>
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
    </Sheet>
  );
}

/** In the transaction pop-up: its receipts, ones in the inbox that may belong to it, and Add receipt. */
export function TxnReceipts({ t, txn }: { t: Theme; txn: { id: string; date: string; amount: number; name: string; merchant: string | null } }) {
  const [mine, setMine] = useState<Receipt[]>([]);
  const [maybe, setMaybe] = useState<Receipt[]>([]);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    receiptsFor(txn.id).then(setMine);
    if (txn.amount < 0) receiptsMatching(txn).then(setMaybe);
  }, [txn.id, n]);
  const attach = async (r: Receipt) => { await updateReceipt(r.id, { transaction_id: txn.id }); toast('Receipt attached'); setN((x) => x + 1); };
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <View style={styles.between}>
        <Text style={{ color: t.muted, fontSize: 13 }}>Receipt{mine.length > 1 ? 's' : ''}</Text>
        <Pressable onPress={() => setAdding(true)} hitSlop={8}><Text style={{ color: t.accent }}>+ Add receipt</Text></Pressable>
      </View>
      {mine.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {mine.map((r) => <Pressable key={r.id} onPress={() => setOpen(r)} accessibilityLabel="Open receipt"><ReceiptPhoto path={r.path} size={64} /></Pressable>)}
        </View>
      )}
      {maybe.map((r) => (
        <View key={r.id} style={[styles.maybe, { borderColor: t.line }]}>
          <ReceiptPhoto path={r.path} size={40} />
          <Text style={{ color: t.text, flex: 1, fontSize: 13 }}>A receipt in your inbox may be this one{r.amount != null ? ` (${formatMoney(r.amount)}` : ''}{r.taken_on ? `${r.amount != null ? ', ' : ' ('}${shortDate(r.taken_on)})` : r.amount != null ? ')' : ''}.</Text>
          <Button title="Attach" kind="plain" onPress={() => attach(r)} />
        </View>
      ))}
      {open && <ReceiptForm initial={open} onClose={() => setOpen(null)} onSaved={() => setN((x) => x + 1)} />}
      {adding && <ReceiptForm attachTo={txn} onClose={() => setAdding(false)} onSaved={() => afterClose(() => setN((x) => x + 1))} />}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  maybe: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 8 },
});
