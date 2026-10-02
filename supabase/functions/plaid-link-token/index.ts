// Creates a Plaid Link token for the signed-in user.
// Body: {}                → link a new bank
//       { itemId: "..." } → "update mode" to fix a connection that needs a new sign-in
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, isDemoUser, userIdFrom } from '../_shared/supabase.ts';
import { countryCodes, plaid } from '../_shared/plaid.ts';
import { accessToken } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const userId = await userIdFrom(req);
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    if (await isDemoUser(req)) return json({ error: 'The demo account cannot link banks.' }, 403);
    const { itemId } = await req.json().catch(() => ({}));

    const body: Record<string, unknown> = {
      client_name: Deno.env.get('APP_NAME') ?? 'Budget App',
      user: { client_user_id: userId },
      country_codes: countryCodes(),
      language: 'en',
    };
    const redirect = Deno.env.get('PLAID_REDIRECT_URI');
    if (redirect) body.redirect_uri = redirect;

    if (itemId) {
      const admin = adminClient();
      const { data: item } = await admin.from('plaid_items').select('*').eq('item_id', itemId).eq('user_id', userId).single();
      if (!item) return json({ error: 'Connection not found.' }, 404);
      body.access_token = await accessToken(admin, item.access_token_secret_id);
    } else {
      body.products = ['transactions'];
      body.transactions = { days_requested: Number(Deno.env.get('PLAID_DAYS_REQUESTED') ?? 365) };
    }
    const res = await plaid<{ link_token: string }>('/link/token/create', body);
    return json({ linkToken: res.link_token });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
