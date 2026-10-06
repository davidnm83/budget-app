// Notifications for the signed-in user (the hourly sending is in plaid-sync, see _shared/notify.ts):
//   {action:'key'}      the server's public push key, to turn notifications on with
//   {action:'test'}     a test notification to every device you turned on
//   {action:'preview'}  what would be sent today, before quiet hours and what was already sent
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, userIdFrom } from '../_shared/supabase.ts';
import { deliver, notesFor, vapidKeys } from '../_shared/notify.ts';
import { hourIn, todayIn, type NotifySettings } from '../_shared/core/index.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const userId = await userIdFrom(req);
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const body = await req.json().catch(() => ({}));
    const admin = adminClient();
    const vapid = await vapidKeys(admin);
    if (body.action === 'key') return json({ publicKey: vapid.publicKey });
    if (body.action === 'test') {
      const n = await deliver(admin, userId, [{ title: 'Notifications are on', body: 'This is how they will look on this device.', url: '/settings', tag: 'test' }], vapid);
      return json({ devices: n });
    }
    if (body.action === 'preview') {
      const tz = Deno.env.get('APP_TIMEZONE') ?? 'UTC';
      const { data: prefs } = await admin.from('user_prefs').select('notify, sync_every').eq('user_id', userId).maybeSingle();
      const s: NotifySettings = (prefs as any)?.notify ?? {};
      const notes = await notesFor(admin, userId, s, todayIn(tz), hourIn(tz), (prefs as any)?.sync_every ?? null);
      return json({ notes });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
