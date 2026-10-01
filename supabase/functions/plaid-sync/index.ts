// Syncs bank connections.
//   • Daily cron (x-cron-secret header, body {scheduled:true}): every user's connections, but only
//     in the run that lands at 5 AM in APP_TIMEZONE (cron fires at 09:00 and 10:00 UTC).
//     Add {force:true} to run immediately.
//   • Signed-in user ("Sync now", or after fixing a connection): their connections,
//     or just one with {itemId}.
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, isCronCall, userIdFrom } from '../_shared/supabase.ts';
import { syncItem, type PlaidItemRow, type SyncResult } from '../_shared/sync.ts';
import { hourIn } from '../_shared/core/index.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    const admin = adminClient();
    let query = admin.from('plaid_items').select('*');

    if (isCronCall(req)) {
      const tz = Deno.env.get('APP_TIMEZONE') ?? 'America/Toronto';
      if (body.scheduled && !body.force && hourIn(tz) !== 5) {
        return json({ skipped: `Not 5 AM in ${tz} (hour ${hourIn(tz)}).` });
      }
    } else {
      const userId = await userIdFrom(req);
      if (!userId) return json({ error: 'Sign in first.' }, 401);
      query = query.eq('user_id', userId);
      if (body.itemId) query = query.eq('item_id', body.itemId);
    }

    const { data: items, error } = await query;
    if (error) throw new Error(error.message);
    const results: SyncResult[] = [];
    for (const item of (items ?? []) as PlaidItemRow[]) results.push(await syncItem(admin, item));
    const added = results.reduce((s, r) => s + r.added, 0);
    return json({ added, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
