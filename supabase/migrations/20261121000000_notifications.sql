-- Notifications: phone and browser notifications through Web Push.

-- One row per device that turned notifications on (Settings → Notifications).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions" on public.push_subscriptions for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated, service_role;

-- What was sent, by key, so nothing is sent twice. Kept for 60 days.
create table public.notification_log (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notification_log enable row level security;
create policy "own notification log" on public.notification_log for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.notification_log to authenticated, service_role;

-- The server's push signing key (VAPID), made the first time it's needed. Never readable by users.
create table public.push_keys (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;
grant select, insert on public.push_keys to service_role;

-- Each person's notification settings (packages/core/src/notify.ts, NotifySettings).
alter table public.user_prefs add column if not exists notify jsonb;
