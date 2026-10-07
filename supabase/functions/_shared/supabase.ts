import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Admin = SupabaseClient;

/**
 * Supabase provides keys to Edge Functions either as the new JSON dictionaries
 * (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS) or, on older projects, as
 * SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY. Support both.
 */
function firstKey(jsonVar: string, legacyVar: string): string {
  const raw = Deno.env.get(jsonVar);
  if (raw) {
    try {
      const dict = JSON.parse(raw) as Record<string, string>;
      const v = dict.default ?? Object.values(dict)[0];
      if (v) return v;
    } catch { /* fall through */ }
  }
  const legacy = Deno.env.get(legacyVar);
  if (!legacy) throw new Error(`Missing ${jsonVar} / ${legacyVar}`);
  return legacy;
}

export const secretKey = () => firstKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
export const publishableKey = () => firstKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');

/** Server-side client that bypasses row-level security. Never send its key to the app. */
export function adminClient(): Admin {
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });
}

export function bearer(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
}

/** Compares two strings in constant time, so the secret can't be guessed from response timing. */
function sameText(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

/** True when the daily cron job is calling (shared CRON_SECRET in the x-cron-secret header). */
export function isCronCall(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  const given = req.headers.get('x-cron-secret');
  return !!expected && !!given && sameText(given, expected);
}

/** A client acting as the signed-in user, so row-level security limits it to their own rows. */
export function userClient(req: Request): Admin {
  return createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer(req)}` } } });
}

/** The signed-in user's id, or null if the token is missing or invalid. */
export async function userIdFrom(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

/**
 * True for a demo user (app_metadata.demo = true, which only the project owner can set).
 * Demo users can't link banks, so a shared demo password can't use your Plaid account.
 */
export async function isDemoUser(req: Request): Promise<boolean> {
  const token = bearer(req);
  if (!token) return false;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { auth: { persistSession: false } });
  const { data } = await client.auth.getUser(token);
  return data.user?.app_metadata?.demo === true;
}
