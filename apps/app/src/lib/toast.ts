// The short message that appears at the bottom after you do something: "Saved", or "Bill deleted"
// with an Undo button. One at a time; a new one replaces the old.
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { refreshNow } from './pullRefresh';

export interface Toast { id: number; text: string; undo?: () => Promise<void> | void; error?: boolean }
let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(text: string, opts: { undo?: () => Promise<void> | void; error?: boolean } = {}) {
  current = { id: ++seq, text, ...opts };
  if (timer) clearTimeout(timer);
  timer = setTimeout(dismissToast, opts.undo ? 6000 : 2200);
  emit();
}
export function dismissToast() { current = null; if (timer) clearTimeout(timer); timer = null; emit(); }
export function useToast(): Toast | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current, () => null);
}
/** Run a toast's undo, then refresh whatever page is showing. */
export async function runUndo(t: Toast) {
  dismissToast();
  try { await t.undo?.(); toast('Undone'); refreshNow(); }
  catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); }
}

/**
 * Delete one row and offer to put it back. The row (and, for a shift, its per-app parts) is read
 * first so Undo can re-insert exactly what was there.
 */
export async function deleteWithUndo(table: string, id: string, label: string, children?: { table: string; key: string }): Promise<string | null> {
  const { data: row, error: readErr } = await supabase.from(table).select('*').eq('id', id).single();
  if (readErr) return readErr.message;
  const kids = children ? (await supabase.from(children.table).select('*').eq(children.key, id)).data ?? [] : [];
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) return error.message;
  toast(label, { undo: async () => {
    const back = await supabase.from(table).insert(row);
    if (back.error) throw new Error(back.error.message);
    if (children && kids.length) { const k = await supabase.from(children.table).insert(kids); if (k.error) throw new Error(k.error.message); }
  } });
  return null;
}
