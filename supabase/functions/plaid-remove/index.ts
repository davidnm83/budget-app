// Disconnects a bank: tells Plaid to revoke access, deletes the stored token and
// the connection. Accounts and transaction history stay (become manual accounts).
// Body: { itemId: "..." }
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, userIdFrom } from '../_shared/supabase.ts';
import { plaid } from '../_shared/plaid.ts';
import { accessToken } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const userId = await userIdFrom(req);
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const { itemId } = await req.json();
    const admin = adminClient();
    const { data: item } = await admin.from('plaid_items').select('*').eq('item_id', itemId).eq('user_id', userId).single();
    if (!item) return json({ error: 'Connection not found.' }, 404);
    try {
      await plaid('/item/remove', { access_token: await accessToken(admin, item.access_token_secret_id) });
    } catch (_) { /* already removed at Plaid */ }
    await admin.from('accounts').update({ kind: 'manual' }).eq('plaid_item_id', item.id);
    await admin.rpc('delete_plaid_token', { p_secret_id: item.access_token_secret_id });
    await admin.from('plaid_items').delete().eq('id', item.id);
    return json({ removed: itemId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
