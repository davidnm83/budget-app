// Receipt inbox (TXN-13): photos shrunk on the phone and kept in the private "receipts" storage
// bucket (each user's own folder), with what you typed. Waiting ones are matched to transactions
// as they sync (@budget-app/core receiptMatches); you confirm. Photos are fetched only when shown
// and are never part of the offline copy or a backup file.
import { addDays, receiptMatches, type ReceiptMatch } from '@budget-app/core';
import { today } from './plan';
import { recordRewards } from './rewards';
import { supabase } from './supabase';

export interface Receipt {
  id: string; path: string; taken_on: string | null; amount: number | null; merchant: string | null; note: string | null;
  transaction_id: string | null; created_at: string;
  /** Read from the photo by AI: its lines (points redeemed marked `redeemed`), and which model read it. */
  items?: { name: string; amount: number; redeemed?: boolean }[] | null; read_by?: string | null;
}
export interface CandidateTxn { id: string; date: string; amount: number; name: string; merchant: string | null; display_name: string; account_name: string | null }
export interface InboxItem { receipt: Receipt; matches: (ReceiptMatch & { txn: CandidateTxn })[] }

const BUCKET = 'receipts';
const LONG_EDGE = 1600, QUALITY = 0.8;
const NEEDS_UPDATE = 'Receipts need the newest database update (supabase db push).';
const friendly = (m: string) => (/receipts/.test(m) && /exist|schema cache|bucket/i.test(m) ? NEEDS_UPDATE : m);

/** Choose or take a photo. `camera` opens the camera straight away on a phone. */
export function pickPhoto(camera: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Shrink a photo to at most 1600 px on its long side, as a JPEG (a receipt stays readable at about 150–400 KB). */
export function shrinkPhoto(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, LONG_EDGE / Math.max(w, h));
        const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('That photo couldn’t be read.'))), 'image/jpeg', QUALITY);
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo the app can read.')); };
    img.src = url;
  });
}

const uuid = () => (crypto as any).randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

/** Save a receipt: the photo into storage, then its row. Optionally attached straight to a transaction. */
export async function saveReceipt(photo: Blob, fields: { taken_on: string | null; amount: number | null; merchant: string | null; note: string | null; transaction_id?: string | null; items?: Receipt['items']; read_by?: string | null }): Promise<Receipt> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Sign in again to add a receipt.');
  const id = uuid();
  const path = `${uid}/${id}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, await photo.arrayBuffer(), { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(friendly(up.error.message));
  const { data, error } = await supabase.from('receipts').insert({ id, path, ...fields, transaction_id: fields.transaction_id ?? null }).select('*').single();
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(friendly(error.message)); }
  return norm(data);
}

const norm = (r: any): Receipt => ({ ...r, amount: r.amount == null ? null : Number(r.amount) });

export async function updateReceipt(id: string, patch: Partial<Pick<Receipt, 'taken_on' | 'amount' | 'merchant' | 'note' | 'transaction_id' | 'items' | 'read_by'>>) {
  const { error } = await supabase.from('receipts').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Attach a receipt to a transaction; points on it are recorded as rewards when that's switched on. Returns the message to show. */
export async function attachReceipt(r: Pick<Receipt, 'id' | 'items'>, txnId: string): Promise<string> {
  await updateReceipt(r.id, { transaction_id: txnId });
  return attachedMessage(await recordRewards(txnId, r.items ?? null).catch(() => null));
}
export const attachedMessage = (rewards: Awaited<ReturnType<typeof recordRewards>>) =>
  rewards === 'recorded' ? 'Receipt attached; points recorded as rewards' : rewards === 'split already' ? 'Receipt attached (already split, so the points weren’t added)' : 'Receipt attached';

export async function deleteReceipt(r: Receipt) {
  const { error } = await supabase.from('receipts').delete().eq('id', r.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([r.path]); // the photo; a leftover file does no harm
}

/**
 * The photo as a local address an <Image> can show (fetched when needed, not saved for offline). A page full of
 * receipts asks for many at once: they're fetched a few at a time, the same photo only once, and a failed fetch
 * is tried again (a slow connection, or the sign-in still refreshing as the app opens, used to leave them blank).
 */
const shown = new Map<string, string>();
const fetching = new Map<string, Promise<string>>();
let running = 0;
const waiting: (() => void)[] = [];
const slot = () => (running < 4 ? (running++, Promise.resolve()) : new Promise<void>((go) => waiting.push(() => { running++; go(); })));
const free = () => { running--; waiting.shift()?.(); };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function photoUrl(path: string): Promise<string> {
  const hit = shown.get(path);
  if (hit) return Promise.resolve(hit);
  const going = fetching.get(path);
  if (going) return going;
  const p = (async () => {
    await slot();
    try {
      let last = 'The photo couldn’t be loaded.';
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await pause(800 * attempt);
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (data && !error) { const url = URL.createObjectURL(data); shown.set(path, url); return url; }
        last = error?.message ?? last;
        if (/not.?found|404/i.test(last)) break; // gone for good: no point asking again
      }
      throw new Error(last);
    } finally { free(); fetching.delete(path); }
  })();
  fetching.set(path, p);
  return p;
}

export async function loadReceipts(): Promise<Receipt[]> {
  const { data, error } = await supabase.from('receipts').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(friendly(error.message));
  return (data ?? []).map(norm);
}

export async function receiptsFor(transactionId: string): Promise<Receipt[]> {
  const { data, error } = await supabase.from('receipts').select('*').eq('transaction_id', transactionId).order('created_at');
  if (error) return []; // older database: no receipts yet
  return (data ?? []).map(norm);
}

/** Waiting receipts with the transactions they probably belong to. */
export async function loadInbox(receipts: Receipt[]): Promise<InboxItem[]> {
  const waiting = receipts.filter((r) => !r.transaction_id);
  if (!waiting.length) return [];
  const dates = waiting.map((r) => r.taken_on ?? r.created_at.slice(0, 10)).sort();
  const { data } = await supabase.from('transaction_list').select('id, date, amount, name, merchant, display_name, account_name')
    .lt('amount', 0).gte('date', addDays(dates[0], -1)).lte('date', addDays(dates[dates.length - 1] > today() ? today() : dates[dates.length - 1], 6)).limit(2000);
  const txns = ((data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })) as CandidateTxn[];
  const taken = new Set(receipts.map((r) => r.transaction_id).filter((x): x is string => !!x));
  return waiting.map((r) => ({
    receipt: r,
    matches: receiptMatches({ id: r.id, amount: r.amount, date: r.taken_on, merchant: r.merchant }, txns, taken)
      .map((m) => ({ ...m, txn: txns.find((t) => t.id === m.txnId)! })),
  }));
}

/** Waiting receipts that could belong to this transaction (for the transaction pop-up). */
export async function receiptsMatching(txn: { id: string; date: string; amount: number; name: string; merchant: string | null }): Promise<Receipt[]> {
  const { data, error } = await supabase.from('receipts').select('*').is('transaction_id', null).limit(200);
  if (error) return [];
  return (data ?? []).map(norm).filter((r) => receiptMatches({ id: r.id, amount: r.amount, date: r.taken_on, merchant: r.merchant }, [txn]).length > 0);
}
