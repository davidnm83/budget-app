// Called after Plaid Link succeeds for a NEW bank: stores the connection
// (access token encrypted in Vault), adds its accounts and runs a first sync.
// Body: { publicToken: "...", institutionName: "..." }
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, isDemoUser, userIdFrom } from '../_shared/supabase.ts';
import { plaid } from '../_shared/plaid.ts';
import { syncItem } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const userId = await userIdFrom(req);
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    if (await isDemoUser(req)) return json({ error: 'The demo account cannot link banks.' }, 403);
    const { publicToken, institutionName } = await req.json();
    if (!publicToken) return json({ error: 'publicToken is required.' }, 400);

    const admin = adminClient();
    const ex = await plaid<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken });
    const { data: secretId, error: vaultErr } = await admin.rpc('store_plaid_token', { p_token: ex.access_token });
    if (vaultErr) throw new Error('Could not store the bank token: ' + vaultErr.message);

    const { data: item, error } = await admin.from('plaid_items').insert({
      user_id: userId,
      item_id: ex.item_id,
      institution_name: institutionName || 'Unknown bank',
      access_token_secret_id: secretId,
    }).select('*').single();
    if (error) throw new Error('Saving the connection failed: ' + error.message);

    // First sync. Plaid may still be gathering history; the next run picks up the rest.
    const result = await syncItem(admin, item);
    return json({ ...result, itemId: ex.item_id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
