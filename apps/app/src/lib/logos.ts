// Pictures for banks and merchants. A logo comes from, in order:
//   1. the bank feed (Plaid sends a logo with many transactions),
//   2. a picture you uploaded for the merchant or account,
//   3. a built-in list of well-known Canadian banks and stores,
// and for 3 the picture is the site's icon, fetched from DuckDuckGo's icon service (only
// the site name, e.g. "cibc.com", is sent). Anything else shows its first letter. Logos can be
// turned off in Settings, which stops every outside request for them.
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

const KEY = 'budget.logos';
let enabled = (() => { try { return globalThis.localStorage?.getItem(KEY) !== 'off'; } catch { return true; } })();
let fromFeed = new Map<string, string>();   // merchant (lowercase) → image url
let mine = new Map<string, string>();       // merchant (lowercase) or account:<id> → your uploaded picture
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

let loading: Promise<void> | null = null;
export function loadLogos(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const [feed, own] = await Promise.all([supabase.rpc('merchant_logos'), supabase.from('merchant_sites').select('merchant, image').not('image', 'is', null)]);
    fromFeed = new Map(((feed.data ?? []) as any[]).flatMap((r) => (r.logo_url ? [[String(r.merchant).toLowerCase(), r.logo_url]] : r.website ? [[String(r.merchant).toLowerCase(), icon(r.website)]] : [])) as [string, string][]);
    mine = new Map(((own.data ?? []) as any[]).map((r) => [String(r.merchant).toLowerCase(), r.image]));
    bump();
  })().catch(() => {});
  return loading;
}

const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const icon = (domain: string) => `https://icons.duckduckgo.com/ip3/${cleanDomain(domain)}.ico`;

// [what to look for in the name, website]. First match wins, so longer names come first.
const BANKS: [RegExp, string][] = [
  [/american express|amex/i, 'americanexpress.com'], [/simplii/i, 'simplii.com'], [/cibc/i, 'cibc.com'], [/tangerine/i, 'tangerine.ca'],
  [/scotia/i, 'scotiabank.com'], [/\brbc\b|royal bank/i, 'rbc.com'], [/\bbmo\b|bank of montreal/i, 'bmo.com'], [/\btd\b|toronto.dominion/i, 'td.com'],
  [/national bank|\bnbc\b/i, 'nbc.ca'], [/desjardins/i, 'desjardins.com'], [/rogers/i, 'rogersbank.com'], [/pc (financial|world|money)|president'?s choice/i, 'pcfinancial.ca'],
  [/capital one/i, 'capitalone.ca'], [/wealthsimple/i, 'wealthsimple.com'], [/\beq bank\b/i, 'eqbank.ca'], [/\bneo\b/i, 'neofinancial.com'], [/mbna/i, 'mbna.ca'],
  [/triangle|canadian tire/i, 'canadiantire.ca'], [/walmart/i, 'walmart.ca'], [/home trust/i, 'hometrust.ca'], [/manulife/i, 'manulifebank.ca'],
  [/hsbc/i, 'hsbc.ca'], [/laurentian/i, 'laurentianbank.ca'], [/\batb\b/i, 'atb.com'], [/questrade/i, 'questrade.com'], [/paypal/i, 'paypal.com'], [/\bwise\b/i, 'wise.com'],
  [/koho/i, 'koho.ca'], [/nslsc|student loan/i, 'csnpe-nslsc.canada.ca'],
];
const STORES: [RegExp, string][] = [
  [/doordash/i, 'doordash.com'], [/uber ?eats/i, 'ubereats.com'], [/\buber\b/i, 'uber.com'], [/instacart/i, 'instacart.ca'], [/skip ?the ?dishes/i, 'skipthedishes.com'], [/\blyft\b/i, 'lyft.com'],
  [/amazon|amzn/i, 'amazon.ca'], [/netflix/i, 'netflix.com'], [/spotify/i, 'spotify.com'], [/disney/i, 'disneyplus.com'], [/youtube/i, 'youtube.com'], [/google/i, 'google.com'], [/apple/i, 'apple.com'],
  [/microsoft|xbox/i, 'microsoft.com'], [/playstation|sony/i, 'playstation.com'], [/steam/i, 'steampowered.com'], [/nintendo/i, 'nintendo.com'],
  [/tim hortons|tims\b/i, 'timhortons.ca'], [/starbucks/i, 'starbucks.ca'], [/mcdonald/i, 'mcdonalds.com'], [/a ?& ?w\b/i, 'aw.ca'], [/wendy/i, 'wendys.com'], [/subway/i, 'subway.com'],
  [/popeyes/i, 'popeyes.com'], [/\bkfc\b/i, 'kfc.ca'], [/burger king/i, 'burgerking.ca'], [/pizza pizza/i, 'pizzapizza.ca'], [/domino/i, 'dominos.ca'], [/chipotle/i, 'chipotle.com'], [/harvey'?s/i, 'harveys.ca'],
  [/loblaws/i, 'loblaws.ca'], [/no frills/i, 'nofrills.ca'], [/superstore|rcss/i, 'realcanadiansuperstore.ca'], [/metro\b/i, 'metro.ca'], [/sobeys/i, 'sobeys.com'], [/freshco/i, 'freshco.com'],
  [/food basics/i, 'foodbasics.ca'], [/costco/i, 'costco.ca'], [/shoppers/i, 'shoppersdrugmart.ca'], [/dollarama/i, 'dollarama.com'], [/walmart/i, 'walmart.ca'], [/canadian tire/i, 'canadiantire.ca'],
  [/home depot/i, 'homedepot.ca'], [/ikea/i, 'ikea.com'], [/best buy/i, 'bestbuy.ca'], [/winners/i, 'winners.ca'], [/\blcbo\b/i, 'lcbo.com'], [/beer store/i, 'thebeerstore.ca'],
  [/esso/i, 'esso.ca'], [/petro.?canada/i, 'petro-canada.ca'], [/shell\b/i, 'shell.ca'], [/pioneer/i, 'pioneer.ca'], [/ultramar/i, 'ultramar.ca'], [/circle k/i, 'circlek.com'], [/7.?eleven/i, '7-eleven.ca'],
  [/presto/i, 'prestocard.ca'], [/\bttc\b/i, 'ttc.ca'], [/go transit|metrolinx/i, 'gotransit.com'], [/via rail/i, 'viarail.ca'], [/air canada/i, 'aircanada.com'], [/westjet/i, 'westjet.com'],
  [/rogers/i, 'rogers.com'], [/\bbell\b/i, 'bell.ca'], [/telus/i, 'telus.com'], [/fido/i, 'fido.ca'], [/koodo/i, 'koodomobile.com'], [/freedom mobile/i, 'freedommobile.ca'], [/public mobile/i, 'publicmobile.ca'],
  [/goodlife/i, 'goodlifefitness.com'], [/planet fitness/i, 'planetfitness.ca'], [/belair/i, 'belairdirect.com'], [/cineplex/i, 'cineplex.com'], [/indigo|chapters/i, 'indigo.ca'],
  [/ford/i, 'ford.ca'], [/toyota/i, 'toyota.ca'], [/honda/i, 'honda.ca'], [/openai|chatgpt/i, 'openai.com'], [/anthropic|claude/i, 'anthropic.com'], [/github/i, 'github.com'],
];
const match = (list: [RegExp, string][], name: string) => list.find(([re]) => re.test(name))?.[1];

/** Image for a merchant name, or null to show its letter. */
export function merchantLogo(name: string | null | undefined): string | null {
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
export function bankLogo(...names: (string | null | undefined)[]): string | null {
  if (!enabled) return null;
  for (const n of names) { const d = n ? match(BANKS, n) : undefined; if (d) return icon(d); }
  return null;
}
/** A picture you uploaded, by merchant name or "account:<id>". */
export const customPicture = (key: string): string | null => mine.get(key.toLowerCase()) ?? null;
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
  await savePicture(to, pic); await savePicture(from, null);
}
