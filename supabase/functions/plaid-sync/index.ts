// Syncs bank connections.
//   • Scheduled (x-cron-secret header, body {scheduled:true}): cron fires every hour; each user's
//     connections are synced in the runs their setting asks for (user_prefs.sync_every: every N
//     hours counted from 5 AM in APP_TIMEZONE; no setting = once a day at 5 AM; 0 = never).
//     Add {force:true} to run everyone immediately.
//   • Signed-in user ("Sync now", or after fixing a connection): their connections,
//     or just one with {itemId}.
// Afterwards, loan payments are copied and loan interest logged (see _shared/loans.ts), and
// both sides of recent transfers between your accounts are paired (_shared/transfers.ts).
// Every scheduled run then sends the notifications that are due (_shared/notify.ts).
import { json, preflight } from '../_shared/cors.ts';
import { adminClient, isCronCall, userIdFrom } from '../_shared/supabase.ts';
import { syncItem, type PlaidItemRow, type SyncResult } from '../_shared/sync.ts';
import { hourIn, syncDue, todayIn } from '../_shared/core/index.ts';
import { processLoans, type LoanResult } from '../_shared/loans.ts';
import { pairRecentTransfers } from '../_shared/transfers.ts';
import { backupEveryone } from '../_shared/backup.ts';
import { runNotifications } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    const admin = adminClient();
    let query = admin.from('plaid_items').select('*');

    if (isCronCall(req)) {
      const tz = Deno.env.get('APP_TIMEZONE') ?? 'UTC';
      if (body.scheduled && !body.force) {
        const hour = hourIn(tz);
        // Nightly backups (PLT-8) ride on this hourly run: at 3 AM, before any 5 AM sync.
        if (hour === 3) { try { await backupEveryone(admin, todayIn(tz)); } catch { /* a failed backup must not stop syncing */ } }
        // Who is due this hour. If the setting can't be read (the column isn't there yet), everyone is on once a day.
        const { data: prefs } = await admin.from('user_prefs').select('user_id, sync_every');
        const every = new Map((prefs ?? []).map((p: any) => [p.user_id as string, p.sync_every as number | null]));
        const { data: owners, error: ownersError } = await admin.from('plaid_items').select('user_id');
        if (ownersError) throw new Error(ownersError.message);
        const due = [...new Set((owners ?? []).map((o: any) => o.user_id as string))].filter((u) => syncDue(hour, every.get(u)));
        if (!due.length) {
          const notified = await runNotifications(admin, hour, todayIn(tz)).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
          return json({ skipped: `Nobody is due at hour ${hour} in ${tz}.`, notified });
        }
        query = query.in('user_id', due);
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
    // Loans: copy payments and log interest from the new balances (ACC-5, LOAN-1).
    const today = todayIn(Deno.env.get('APP_TIMEZONE') ?? 'UTC');
    const loans: LoanResult[] = [];
    for (const userId of new Set((items ?? []).map((i: any) => i.user_id as string))) {
      try { loans.push(...(await processLoans(admin, userId, today))); }
      catch (e) { loans.push({ loan: '?', payments: 0, interest: null, status: e instanceof Error ? e.message : String(e) }); }
      try { await pairRecentTransfers(admin, userId, today); } catch { /* pairing is best-effort */ }
    }
    // Scheduled runs: what's due now, with the new transactions and any connection that just failed.
    const notified = isCronCall(req) && body.scheduled
      ? await runNotifications(admin, hourIn(Deno.env.get('APP_TIMEZONE') ?? 'UTC'), today).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
      : undefined;
    return json({ added, results, loans, notified });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
