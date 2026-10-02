// Names already in use, for suggestions while typing: merchants (most used first) and tags.
import { supabase } from './supabase';

let merchants: string[] | null = null;
let tags: string[] | null = null;

export async function knownMerchants(): Promise<string[]> {
  if (!merchants) {
    const { data } = await supabase.rpc('merchant_names');
    merchants = ((data ?? []) as { merchant: string; txns: number }[]).sort((a, b) => Number(b.txns) - Number(a.txns)).map((m) => m.merchant).filter(Boolean);
  }
  return merchants;
}

export async function knownTags(): Promise<string[]> {
  if (!tags) {
    const { data } = await supabase.from('transactions').select('tags').neq('tags', '{}').order('date', { ascending: false }).limit(1000);
    const count = new Map<string, number>();
    for (const r of (data ?? []) as { tags: string[] }[]) for (const x of r.tags ?? []) count.set(x, (count.get(x) ?? 0) + 1);
    tags = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  }
  return tags;
}

/** Call after saving a transaction so new names show up next time. */
export function forgetKnown() { merchants = null; tags = null; }
