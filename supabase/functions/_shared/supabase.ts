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

/** True when the daily cron job is calling (shared CRON_SECRET in the x-cron-secret header). */
export function isCronCall(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  return !!expected && req.headers.get('x-cron-secret') === expected;
}

/** The signed-in user's id, or null if the token is missing or invalid. */
export async function userIdFrom(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}
