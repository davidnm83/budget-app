// Pictures for banks and merchants. A logo comes from, in order:
//   1. the bank feed (Plaid sends a logo with many transactions),
//   2. a picture you uploaded for the merchant or account,
//   3. a built-in list of well-known banks and stores,
// and for 3 the picture is the site's icon, fetched from DuckDuckGo's icon service (only
// the site name, e.g. "examplebank.com", is sent). Anything else shows its first letter. Logos can be
// turned off in Settings, which stops every outside request for them.
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

const KEY = 'budget.logos';
let enabled = (() => { try { return globalThis.localStorage?.getItem(KEY) !== 'off'; } catch { return true; } })();
let fromFeed = new Map<string, string>();   // merchant (lowercase) → image url
let mine = new Map<string, string>();       // merchant (lowercase) or account:<id> → your uploaded picture
const fitted = new Set<string>();            // uploaded pictures shown whole inside the circle, not filling it
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };

export function setLogosEnabled(v: boolean) {
  enabled = v;
  try { globalThis.localStorage?.setItem(KEY, v ? 'on' : 'off'); } catch { /* lasts until reload */ }
  bump();
}
/** Re-renders when logos are switched on or off or the merchant list loads. Returns whether they're on. */
export function useLogos(): boolean {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version, () => 0);
  return enabled;
}

/**
 * A number that changes whenever logos change (loaded, uploaded, switched on or off). The app is
 * built with the React Compiler, which reuses a component's earlier result when its inputs look
 * the same; the lookups below read data that lives outside React, so pass this number to them
 * (their last argument) and the compiler knows to look again.
 */
export function useLogoVersion(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version, () => 0);
}

let loading: Promise<void> | null = null;
export function loadLogos(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const [feed, own] = await Promise.all([supabase.rpc('merchant_logos'), supabase.from('merchant_sites').select('merchant, image, fill').not('image', 'is', null)]);
    fromFeed = new Map(((feed.data ?? []) as any[]).flatMap((r) => (r.logo_url ? [[String(r.merchant).toLowerCase(), r.logo_url]] : r.website ? [[String(r.merchant).toLowerCase(), icon(r.website)]] : [])) as [string, string][]);
    mine = new Map(((own.data ?? []) as any[]).map((r) => [String(r.merchant).toLowerCase(), r.image]));
    fitted.clear(); for (const r of (own.data ?? []) as any[]) if (r.fill === false) fitted.add(r.image);
    bump();
  })().catch(() => {});
  return loading;
}

const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const icon = (domain: string) => `https://icons.duckduckgo.com/ip3/${cleanDomain(domain)}.ico`;

// [what to look for in the name, website]. First match wins, so longer names come first.
const BANKS: [RegExp, string][] = [
  [/american express|amex/i, 'americanexpress.com'], [/capital one/i, 'capitalone.com'], [/\bchase\b|jpmorgan/i, 'chase.com'], [/bank of america|\bbofa\b/i, 'bankofamerica.com'],
  [/wells fargo/i, 'wellsfargo.com'], [/\bciti(bank)?\b/i, 'citi.com'], [/discover/i, 'discover.com'], [/us bank|u\.s\. bank/i, 'usbank.com'], [/\bpnc\b/i, 'pnc.com'],
  [/\bally\b/i, 'ally.com'], [/charles schwab|schwab/i, 'schwab.com'], [/fidelity/i, 'fidelity.com'], [/vanguard/i, 'vanguard.com'], [/\bsofi\b/i, 'sofi.com'], [/chime/i, 'chime.com'],
  [/royal bank|\brbc\b/i, 'rbc.com'], [/toronto.dominion|\btd\b/i, 'td.com'], [/scotia/i, 'scotiabank.com'], [/bank of montreal|\bbmo\b/i, 'bmo.com'], [/\bcibc\b/i, 'cibc.com'],
  [/hsbc/i, 'hsbc.com'], [/barclay/i, 'barclays.co.uk'], [/lloyds/i, 'lloydsbank.com'], [/natwest/i, 'natwest.com'], [/santander/i, 'santander.com'], [/monzo/i, 'monzo.com'],
  [/revolut/i, 'revolut.com'], [/\bn26\b/i, 'n26.com'], [/\bing\b/i, 'ing.com'], [/deutsche bank/i, 'deutsche-bank.de'], [/bnp paribas/i, 'bnpparibas.com'],
  [/commonwealth bank|commbank/i, 'commbank.com.au'], [/westpac/i, 'westpac.com.au'], [/\banz\b/i, 'anz.com'], [/\bnab\b/i, 'nab.com.au'],
  [/paypal/i, 'paypal.com'], [/\bwise\b/i, 'wise.com'], [/venmo/i, 'venmo.com'], [/cash app/i, 'cash.app'], [/wealthsimple/i, 'wealthsimple.com'], [/robinhood/i, 'robinhood.com'],
];
const STORES: [RegExp, string][] = [
  [/doordash/i, 'doordash.com'], [/uber ?eats/i, 'ubereats.com'], [/\buber\b/i, 'uber.com'], [/instacart/i, 'instacart.com'], [/\blyft\b/i, 'lyft.com'], [/deliveroo/i, 'deliveroo.com'],
  [/amazon|amzn/i, 'amazon.com'], [/netflix/i, 'netflix.com'], [/spotify/i, 'spotify.com'], [/disney/i, 'disneyplus.com'], [/youtube/i, 'youtube.com'], [/google/i, 'google.com'], [/apple/i, 'apple.com'],
  [/microsoft|xbox/i, 'microsoft.com'], [/playstation|sony/i, 'playstation.com'], [/steam/i, 'steampowered.com'], [/nintendo/i, 'nintendo.com'], [/\bhulu\b/i, 'hulu.com'], [/audible/i, 'audible.com'],
  [/starbucks/i, 'starbucks.com'], [/mcdonald/i, 'mcdonalds.com'], [/wendy/i, 'wendys.com'], [/subway/i, 'subway.com'], [/dunkin/i, 'dunkindonuts.com'], [/tim hortons/i, 'timhortons.com'],
  [/popeyes/i, 'popeyes.com'], [/\bkfc\b/i, 'kfc.com'], [/burger king/i, 'bk.com'], [/domino/i, 'dominos.com'], [/chipotle/i, 'chipotle.com'], [/taco bell/i, 'tacobell.com'], [/pizza hut/i, 'pizzahut.com'],
  [/walmart/i, 'walmart.com'], [/costco/i, 'costco.com'], [/target\b/i, 'target.com'], [/whole foods/i, 'wholefoodsmarket.com'], [/trader joe/i, 'traderjoes.com'], [/kroger/i, 'kroger.com'],
  [/\baldi\b/i, 'aldi.com'], [/\blidl\b/i, 'lidl.com'], [/tesco/i, 'tesco.com'], [/sainsbury/i, 'sainsburys.co.uk'], [/carrefour/i, 'carrefour.com'], [/loblaws/i, 'loblaws.ca'],
  [/home depot/i, 'homedepot.com'], [/lowe'?s/i, 'lowes.com'], [/ikea/i, 'ikea.com'], [/best buy/i, 'bestbuy.com'], [/\bcvs\b/i, 'cvs.com'], [/walgreens/i, 'walgreens.com'], [/\bebay\b/i, 'ebay.com'], [/etsy/i, 'etsy.com'],
  [/\bshell\b/i, 'shell.com'], [/\bbp\b/i, 'bp.com'], [/exxon|mobil\b|esso/i, 'exxon.com'], [/chevron/i, 'chevron.com'], [/circle k/i, 'circlek.com'], [/7.?eleven/i, '7-eleven.com'],
  [/airbnb/i, 'airbnb.com'], [/booking\.com/i, 'booking.com'], [/expedia/i, 'expedia.com'],
  [/verizon/i, 'verizon.com'], [/at&t/i, 'att.com'], [/t-?mobile/i, 't-mobile.com'], [/comcast|xfinity/i, 'xfinity.com'], [/vodafone/i, 'vodafone.com'],
  [/planet fitness/i, 'planetfitness.com'], [/openai|chatgpt/i, 'openai.com'], [/anthropic|claude/i, 'anthropic.com'], [/github/i, 'github.com'], [/dropbox/i, 'dropbox.com'], [/adobe/i, 'adobe.com'],
];
const match = (list: [RegExp, string][], name: string) => list.find(([re]) => re.test(name))?.[1];

/** Image for a merchant name, or null to show its letter. */
export function merchantLogo(name: string | null | undefined, _v?: number): string | null {
  if (!name) return null;
  const k = name.toLowerCase();
  const own = mine.get(k);
  if (own) return own; // your own picture shows even with logos switched off
  if (!enabled) return null;
  const fed = fromFeed.get(k);
  if (fed) return fed;
  const d = match(STORES, name) ?? match(BANKS, name);
  return d ? icon(d) : null;
}
/** Image for an account, from the bank named in it (or its institution). */
export function bankLogo(name: string | null | undefined, _v?: number): string | null {
  if (!enabled) return null;
  for (const n of [name]) { const d = n ? match(BANKS, n) : undefined; if (d) return icon(d); }
  return null;
}
/** A picture you uploaded, by merchant name or "account:<id>". */
export const customPicture = (key: string, _v?: number): string | null => mine.get(key.toLowerCase()) ?? null;
/** Whether a picture fills its circle. Only uploads can; site icons always sit inside it. */
export const fillsCircle = (uri: string, _v?: number) => uri.startsWith('data:') && !fitted.has(uri);
export async function setPictureFill(key: string, fill: boolean) {
  const res = await supabase.from('merchant_sites').update({ fill }).eq('merchant', key);
  if (res.error) throw new Error(res.error.message);
  await loadLogos(true);
}
/** Save (or with null, remove) your picture for a merchant name or "account:<id>". */
export async function savePicture(key: string, image: string | null) {
  const res = image ? await supabase.from('merchant_sites').upsert({ merchant: key, image, domain: null }, { onConflict: 'user_id,merchant' })
    : await supabase.from('merchant_sites').delete().eq('merchant', key);
  if (res.error) throw new Error(res.error.message);
  await loadLogos(true);
}
/** A merchant was renamed: its picture follows it. */
export async function movePicture(from: string, to: string) {
  const pic = customPicture(from);
  if (!pic || customPicture(to)) return;
  const fill = fillsCircle(pic);
  await savePicture(to, pic); if (!fill) await setPictureFill(to, false); await savePicture(from, null);
}
