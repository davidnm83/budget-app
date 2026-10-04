// Backups (PLT-8):
//   • Signed-in user ("Back up now" in Settings): writes their backup for today.
//   • Scheduled (x-cron-secret header): everyone's. The hourly bank-sync job also runs this at 3 AM
//     in APP_TIMEZONE (see plaid-sync), so no extra schedule is needed.
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, isCronCall, userIdFrom } from '../_shared/supabase.ts';
import { backupEveryone, backupUser } from '../_shared/backup.ts';
import { todayIn } from '../_shared/core/index.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const admin = adminClient();
    const date = todayIn(Deno.env.get('APP_TIMEZONE') ?? 'UTC');
    if (isCronCall(req)) return json({ results: await backupEveryone(admin, date) });
    const userId = await userIdFrom(req);
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const r = await backupUser(admin, userId, date);
    return r.error ? json({ error: r.error }, 500) : json(r);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
