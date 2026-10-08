// Notifications: the hourly run (from plaid-sync) loads each person's data with the admin client, turns it
// into notes with the composers in core/notify.ts, keeps what is due and not sent yet, and sends it by Web
// Push to their devices. Every query is filtered by user_id: the admin client sees everyone's rows.
import type { Admin } from './supabase.ts';
import { sendPush, makeVapidKeys, type Vapid } from './webpush.ts';
import { extraNotes } from './notify_extra.ts';
import {
  addDays, addMonths, balanceAt, buildBudgetMonth, buildWeek, csvReminderOn, expandPlan, goalProgress, monthEnd, monthName, monthOf, nextRefillDate, notifyOn, notifySetting,
  noteBanks, noteBills, noteBudget, noteCheckin, noteCsv, noteGoals, noteLarge, noteLow, noteRadar, noteReview, noteScore, noteSubs, pickNotes, radarBills, radarCards, radarLimits,
  radarPace, radarRunway, radarSubscriptions, radarTransfers, radarUnusual, round2, syncDue, toMessages, transferProgress, RADAR_NOTIFY_DEFAULT,
  type Note, type NotifySettings, type PostedTxn, type RadarCard, type RadarCheck,
} from './core/index.ts';

/** The server's signing key: from secrets if set, else the one kept in push_keys (made on first use). */
export async function vapidKeys(admin: Admin): Promise<Vapid> {
  const subject = Deno.env.get('VAPID_SUBJECT') ?? Deno.env.get('SUPABASE_URL') ?? 'mailto:admin@localhost';
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_JWK');
  if (pub && priv) return { publicKey: pub, privateJwk: JSON.parse(priv), subject };
  const { data } = await admin.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  if (data) return { publicKey: data.public_key, privateJwk: data.private_jwk, subject };
  const made = await makeVapidKeys();
  await admin.from('push_keys').insert({ id: 1, public_key: made.publicKey, private_jwk: made.privateJwk });
  // Two runs at once: the first one in wins, and both use it.
  const { data: kept } = await admin.from('push_keys').select('public_key, private_jwk').eq('id', 1).single();
  return { publicKey: kept!.public_key, privateJwk: kept!.private_jwk, subject };
}

const signed = (a: any) => (a.type === 'credit' || a.type === 'loan' ? -1 : 1) * Number(a.balance ?? 0);
const num = (v: unknown) => Number(v ?? 0);

async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pages = 10): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < pages; p++) {
    const { data, error } = await make(p * 1000, p * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Everything due for one person today, before timing and the sent log are applied. */
export async function notesFor(admin: Admin, userId: string, s: NotifySettings, today: string, hour: number, syncEvery: number | null): Promise<Note[]> {
  const on = (k: Parameters<typeof notifyOn>[1]) => notifyOn(s, k);
  const month = monthOf(today);
  const notes: Note[] = [];
  const tryAdd = async (f: () => Promise<Note[]> | Note[]) => { try { notes.push(...(await f())); } catch (e) { console.error('notify', userId, e instanceof Error ? e.message : e); } };
  const radarOn = on('radar') ? (s.radarChecks ?? RADAR_NOTIFY_DEFAULT) : [];
  const wantRadar = (c: RadarCheck) => radarOn.includes(c);
  const L = radarLimits({});

  const [{ data: accounts }, { data: items }] = await Promise.all([
    admin.from('account_balances').select('*').eq('user_id', userId).eq('is_hidden', false),
    admin.from('plaid_items').select('id, institution_name, status').eq('user_id', userId),
  ]);
  const accts = (accounts ?? []) as any[];
  const name = (id: string) => accts.find((a) => a.id === id)?.name ?? 'An account';
  if (on('bank')) await tryAdd(() => noteBanks(((items ?? []) as any[]).map((i) => ({ id: i.id, name: i.institution_name ?? 'A bank', status: i.status })), today));

  // The plan: from two weeks back (late bills) to the furthest look-ahead.
  const ahead = Math.max(notifySetting(s, 'billDays'), notifySetting(s, 'lowDays'), 7);
  const needPlan = on('bill') || on('low') || on('checkin') || wantRadar('bill');
  let plan: ReturnType<typeof buildWeek> | null = null, back: ReturnType<typeof buildWeek> | null = null;
  const planAccts = accts.filter((a) => a.plan_include);
  if (needPlan && planAccts.length) {
    const ids = planAccts.map((a) => a.id);
    const [{ data: rec }, { data: ent }, posted] = await Promise.all([
      admin.from('recurring').select('*').eq('user_id', userId),
      admin.from('plan_entries').select('*').eq('user_id', userId)
        .or(`and(date.gte.${addDays(today, -45)},date.lte.${addDays(today, ahead + 31)}),and(occurrence_date.gte.${addDays(today, -45)},occurrence_date.lte.${addDays(today, ahead + 31)})`),
      all<any>((a, b) => admin.from('transactions').select('id, date, amount, account_id, name, merchant').eq('user_id', userId).in('account_id', ids)
        .gte('date', addDays(today, -21)).eq('pending', false).order('id').range(a, b)),
    ]);
    const recurring = ((rec ?? []) as any[]).map((r) => ({ ...r, amount: num(r.amount) }));
    const entries = ((ent ?? []) as any[]).filter((e) => !e.plan_key).map((e) => ({ ...e, amount: num(e.amount) }));
    const txns: PostedTxn[] = posted.map((r) => ({ id: r.id, date: r.date, amount: num(r.amount), accountId: r.account_id, name: r.name, merchant: r.merchant }));
    const startOn = (d: string) => planAccts.map((a) => ({ id: a.id, name: a.name, buffer: num(a.plan_buffer), startBalance: balanceAt(signed(a), txns.filter((t) => t.accountId === a.id && t.date <= today), d) }));
    // Entries the bank has counted but not listed yet (balance_gap) count as done, so they aren't taken off twice.
    const unlisted = Object.fromEntries(planAccts.map((a) => [a.id, num(a.balance_gap)] as const).filter(([, g]) => Math.abs(g) >= 0.01));
    plan = buildWeek({ weekStart: today, days: ahead + 1, today, planned: expandPlan(recurring, entries, addDays(today, -10), addDays(today, ahead)), actuals: txns, accounts: startOn(today), unlisted });
    if (wantRadar('bill')) back = buildWeek({ weekStart: addDays(today, -14), days: 14, today, planned: expandPlan(recurring, entries, addDays(today, -14), addDays(today, -1)), actuals: txns, accounts: startOn(addDays(today, -14)) });
  }
  const rows = plan ? plan.days.flatMap((d) => d.rows) : [];
  if (on('bill') && plan) await tryAdd(() => noteBills(rows, today, notifySetting(s, 'billDays')));
  if (on('low') && plan) await tryAdd(() => noteLow(plan!.warnings, name, today, notifySetting(s, 'lowDays')));

  // Spending this month by category, and the three months before (budget, Radar's pace and unusual, runway).
  const needLines = on('budget') || on('checkin') || wantRadar('pace') || wantRadar('unusual') || wantRadar('runway');
  if (needLines) await tryAdd(async () => {
    const from = addMonths(month, -3);
    const lines = await all<any>((a, b) => admin.from('transaction_lines').select('month, date, category_id, kind, amount').eq('user_id', userId).gte('date', from).lte('date', monthEnd(month)).range(a, b), 20);
    const { data: catRows } = await admin.from('categories').select('id, name, group_name, kind, is_hidden').eq('user_id', userId);
    const cats = ((catRows ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, group: c.group_name, kind: c.kind, hidden: c.is_hidden }));
    const totals = (m: string) => { const t = new Map<string | null, number>(); for (const r of lines) if (r.month === m && r.kind !== 'transfer') t.set(r.category_id, (t.get(r.category_id) ?? 0) + num(r.amount)); return t; };
    const out: Note[] = [];
    const lastDay = Number(monthEnd(month).slice(8, 10)), day = Number(today.slice(8, 10));
    let pace: RadarCard[] = [];
    if (on('budget') || wantRadar('pace')) {
      const { data: b } = await admin.from('budgets').select('month, category_id, group_name, amount, rollover').eq('user_id', userId).eq('month', month);
      const view = buildBudgetMonth(cats, ((b ?? []) as any[]).map((x) => ({ categoryId: x.category_id, groupName: x.group_name, amount: num(x.amount), rollover: x.rollover })), totals(month));
      const flat = view.expenses.flatMap((l) => [l, ...(l.children ?? []).filter((c) => c.available > 0)]);
      if (on('budget')) out.push(...noteBudget(flat.map((l) => ({ key: l.key, label: l.label, actual: l.actual, available: l.available })), month, lastDay - day));
      if (wantRadar('pace')) { pace = radarPace(flat, day / lastDay, month, L); out.push(...noteRadar(pace, radarOn)); }
    }
    if (wantRadar('unusual')) {
      const over = new Set(pace.map((c) => c.id.split(':')[2]));
      const spent = (m: string) => new Map(cats.filter((c) => c.kind === 'expense').map((c) => [c.id, -(totals(m).get(c.id) ?? 0)]));
      out.push(...noteRadar(radarUnusual(cats.filter((c) => !c.hidden && !over.has(c.id)), spent(month), [1, 2, 3].map((n) => spent(addMonths(month, -n))), month, lastDay - day, L), radarOn));
    }
    if (wantRadar('runway')) {
      const before = lines.filter((r) => r.month < month && r.kind === 'expense');
      const days = [1, 2, 3].reduce((x, n) => x + Number(monthEnd(addMonths(month, -n)).slice(8, 10)), 0);
      const cash = accts.filter((a) => a.type === 'depository').reduce((x, a) => x + signed(a), 0);
      out.push(...noteRadar(radarRunway(cash, -before.reduce((x, r) => x + num(r.amount), 0) / days, month, L), radarOn));
    }
    if (on('checkin')) {
      const spentYesterday = -lines.filter((r) => r.date === addDays(today, -1) && r.kind === 'expense').reduce((x, r) => x + num(r.amount), 0);
      const { count } = await admin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('reviewed', false);
      const soon = rows.filter((r) => r.kind === 'planned' && !r.item?.transfer && (r.planned ?? 0) < 0 && r.actual == null && r.date <= addDays(today, 2))
        .map((r) => ({ name: r.description, amount: -r.planned!, date: r.date }));
      const low = plan ? plan.days.slice(0, 7).reduce<{ balance: number; date: string } | null>((m, d) => (!m || d.endBalance < m.balance ? { balance: d.endBalance, date: d.date } : m), null) : null;
      out.push(...noteCheckin(today, { spentYesterday: round2(spentYesterday), billsSoon: soon, cash: planAccts.reduce((x, a) => x + signed(a), 0), lowest: low, toReview: count ?? 0 }));
    }
    return out;
  });
  if (wantRadar('bill') && back && plan) await tryAdd(() => noteRadar(radarBills([...back!.days, ...plan!.days].flatMap((d) => d.rows), today, L), radarOn));
  if (wantRadar('cards')) await tryAdd(() => noteRadar(radarCards(accts.filter((a) => a.type === 'credit').map((a) => ({ id: a.id, name: a.name, owed: Math.max(0, -signed(a)), limit: a.credit_limit == null ? null : num(a.credit_limit) })), L), radarOn));
  if (wantRadar('transfers')) await tryAdd(async () => {
    const { data, error } = await admin.from('balance_transfers').select('*').eq('user_id', userId).is('closed_on', null).not('promo_end', 'is', null);
    if (error) return [];
    const owed = (id: string) => { const a = accts.find((x) => x.id === id); return a ? Math.max(0, -signed(a)) : 0; };
    return noteRadar(radarTransfers(((data ?? []) as any[]).map((r) => {
      const t = { id: r.id, fromAccountId: r.from_account_id, toAccountId: r.to_account_id, amount: num(r.amount), fee: num(r.fee), date: r.date, promoApr: r.promo_apr == null ? null : num(r.promo_apr), promoEnd: r.promo_end };
      const g = transferProgress(t as any, owed(t.toAccountId), today);
      return { id: t.id, to: name(t.toAccountId), remaining: g.remaining, promoEnd: t.promoEnd, daysLeft: g.daysLeft, perMonth: g.perMonth };
    })), radarOn);
  });

  if (on('large')) await tryAdd(async () => {
    // Moving money between your own accounts (card payments, balance transfers) isn't spending.
    const { data } = await admin.from('transactions').select('id, date, amount, name, merchant, account_id').eq('user_id', userId).eq('pending', false).eq('is_transfer', false)
      .lte('amount', -Math.abs(notifySetting(s, 'largeAmount'))).gte('created_at', new Date(Date.now() - 26 * 3600_000).toISOString()).limit(50);
    return noteLarge(((data ?? []) as any[]).map((r) => ({ id: r.id, date: r.date, amount: num(r.amount), name: r.merchant || r.name, account: name(r.account_id) })), notifySetting(s, 'largeAmount'));
  });
  if (on('subs')) await tryAdd(async () => {
    const charges = await all<any>((a, b) => admin.from('transactions').select('id, date, amount, name, merchant, account_id').eq('user_id', userId).lt('amount', 0).eq('pending', false)
      .gte('date', addDays(today, -200)).order('date').range(a, b), 5);
    return noteSubs(radarSubscriptions(charges.map((r) => ({ ...r, amount: num(r.amount) })), today));
  });
  if (on('goal') || on('goalpace')) await tryAdd(async () => {
    const [{ data: g, error }, { data: e }] = await Promise.all([
      admin.from('goals').select('*').eq('user_id', userId).is('closed_on', null),
      admin.from('goal_entries').select('goal_id, amount').eq('user_id', userId),
    ]);
    if (error) return [];
    return noteGoals(((g ?? []) as any[]).map((r) => {
      const account = accts.find((a) => a.id === r.account_id);
      const marked = ((e ?? []) as any[]).filter((x) => x.goal_id === r.id).reduce((x, y) => x + num(y.amount), 0);
      const current = r.kind === 'payoff' ? (account ? Math.max(0, -signed(account)) : num(r.start_value)) : account ? signed(account) : marked;
      const due = r.target_date && r.refills ? nextRefillDate(r.target_date, today) : r.target_date;
      const rolled = !!(r.refills && due && r.target_date && due !== r.target_date);
      const p = goalProgress({ kind: r.kind, target: num(r.target), targetDate: due, startDate: rolled ? `${Number(due.slice(0, 4)) - 1}${due.slice(4)}` : r.start_date, startValue: rolled ? 0 : num(r.start_value), current }, today);
      return { id: r.id, name: r.name, pct: p.share, current: r.kind === 'payoff' ? num(r.start_value) - current : current, target: r.kind === 'payoff' ? num(r.start_value) : num(r.target), behind: p.behind };
    }), today).filter((n) => (n.kind === 'goal' ? on('goal') : on('goalpace')));
  });
  if (on('review')) notes.push(...noteReview(today, monthName(addMonths(month, -1), false)));
  if (on('score')) notes.push(...noteScore(today, notifySetting(s, 'scoreDay')));
  if (on('csv') && syncDue(hour, syncEvery)) await tryAdd(async () => {
    const { data } = await admin.from('accounts').select('id, name, type, kind, plaid_item_id, csv_reminder').eq('user_id', userId).eq('is_hidden', false);
    const broken = new Set(((items ?? []) as any[]).filter((i) => i.status !== 'ok').map((i) => i.id));
    const want = ((data ?? []) as any[]).filter((a) => csvReminderOn(a.type, a.csv_reminder) && (a.kind === 'manual' || (a.plaid_item_id && broken.has(a.plaid_item_id))));
    if (!want.length) return [];
    const { data: recent } = await admin.from('transactions').select('account_id').eq('user_id', userId).eq('source', 'csv').gte('created_at', new Date(Date.now() - 20 * 3600_000).toISOString()).in('account_id', want.map((a) => a.id));
    const done = new Set(((recent ?? []) as any[]).map((r) => r.account_id));
    return noteCsv(want.filter((a) => !done.has(a.id)).map((a) => a.name), `${today}:${hour}`);
  });
  await tryAdd(() => extraNotes(admin, userId, s, today, hour));
  return notes;
}

/** Sends messages to all of a person's devices. Devices that unsubscribed are removed. Returns how many got them. */
export async function deliver(admin: Admin, userId: string, messages: { title: string; body: string; url: string; tag: string }[], vapid: Vapid, fetcher: typeof fetch = fetch): Promise<number> {
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  let ok = 0;
  for (const sub of (subs ?? []) as any[]) {
    let reached = false;
    for (const m of messages) {
      try {
        const r = await sendPush(sub, m, vapid, fetcher);
        if (r.gone) { await admin.from('push_subscriptions').delete().eq('id', sub.id); break; }
        if (r.ok) reached = true;
      } catch (e) { console.error('push', e instanceof Error ? e.message : e); }
    }
    if (reached) { ok++; await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', sub.id); }
  }
  return ok;
}

/** The hourly run: everyone with a device turned on gets what's due for them now. */
export async function runNotifications(admin: Admin, hour: number, today: string, fetcher: typeof fetch = fetch): Promise<{ users: number; sent: number }> {
  const { data: subs, error } = await admin.from('push_subscriptions').select('user_id');
  if (error) return { users: 0, sent: 0 }; // before the migration
  const users = [...new Set(((subs ?? []) as any[]).map((r) => r.user_id as string))];
  if (!users.length) return { users: 0, sent: 0 };
  const vapid = await vapidKeys(admin);
  await admin.from('notification_log').delete().lt('sent_at', new Date(Date.now() - 60 * 86_400_000).toISOString());
  let sent = 0;
  for (const userId of users) {
    try {
      const { data: prefs } = await admin.from('user_prefs').select('notify, sync_every').eq('user_id', userId).maybeSingle();
      const s: NotifySettings = (prefs as any)?.notify ?? {};
      const all = await notesFor(admin, userId, s, today, hour, (prefs as any)?.sync_every ?? null);
      const { data: log } = await admin.from('notification_log').select('key').eq('user_id', userId).in('key', all.map((n) => n.key).slice(0, 200));
      const due = pickNotes(all, new Set(((log ?? []) as any[]).map((r) => r.key)), hour, s);
      if (!due.length) continue;
      if (await deliver(admin, userId, toMessages(due, s), vapid, fetcher)) {
        sent += due.length;
        await admin.from('notification_log').upsert(due.map((n) => ({ user_id: userId, key: n.key })), { onConflict: 'user_id,key', ignoreDuplicates: true });
      }
    } catch (e) { console.error('notify', userId, e instanceof Error ? e.message : e); }
  }
  return { users: users.length, sent };
}
