// AI features (IDEA-12), through the `ai` Edge Function with the owner's Claude API key (see docs/SELF_HOSTING.md):
// reading receipt photos, and asking questions about your money. Both are off until the key is set.
import { useSyncExternalStore } from 'react';
import { callFunction } from './supabase';

export type ModelChoice = 'haiku' | 'sonnet';
/** As the server sends it; `redeemed` is missing from a server not yet updated. */
export interface ReadReceipt { merchant: string | null; date: string | null; total: number | null; tax: number | null; items: { name: string; amount: number }[]; redeemed?: { name: string; amount: number }[]; legible: boolean }
export interface ChatTurn { role: 'user' | 'assistant'; text: string; looked?: string[] }

// Whether the server has a key (asked once per app start).
let on: boolean | null = null;
let asking: Promise<boolean> | null = null;
const subs = new Set<() => void>();
export function aiOn(): Promise<boolean> {
  if (on != null) return Promise.resolve(on);
  asking ??= callFunction<{ on: boolean }>('ai', { action: 'status' }).then((r) => !!r.on, () => false).then((v) => { on = v; subs.forEach((f) => f()); return v; });
  return asking;
}
/** null while unknown, then true or false. */
export function useAiOn(): boolean | null {
  return useSyncExternalStore((f) => { subs.add(f); aiOn(); return () => { subs.delete(f); }; }, () => on, () => on);
}

const base64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(new Error('The photo couldn’t be read.'));
  r.readAsDataURL(b);
});

/** Reads a (shrunk, JPEG) receipt photo. */
export async function readReceiptPhoto(photo: Blob): Promise<{ receipt: ReadReceipt | null; model: ModelChoice }> {
  return callFunction('ai', { action: 'receipt', image: await base64(photo) });
}

export async function askAi(question: string, history: ChatTurn[], model: ModelChoice): Promise<{ answer: string; looked: string[] }> {
  return callFunction('ai', { action: 'ask', question, model, history: history.map(({ role, text }) => ({ role, text })) });
}

// The chat's model, per device.
const KEY = 'budget.ai.model';
export function savedModel(): ModelChoice { try { return globalThis.localStorage?.getItem(KEY) === 'sonnet' ? 'sonnet' : 'haiku'; } catch { return 'haiku'; } }
export function saveModel(m: ModelChoice) { try { globalThis.localStorage?.setItem(KEY, m); } catch { /* this session only */ } }
