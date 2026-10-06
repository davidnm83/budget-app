-- Each linked account's balance as the bank reported it, one row per day (the last sync of the day wins).
-- Balances worked back from transactions stay the fallback for days before the first snapshot, and for
-- accounts the bank's transactions explain fully; snapshots matter for investments and loans, whose
-- balances move without a transaction (market changes, interest), and they record what the bank said.
create table public.balance_snapshots (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  balance numeric(14,2) not null,
  taken_at timestamptz not null default now(),
  primary key (account_id, date)
);
create index balance_snapshots_user on public.balance_snapshots (user_id, date);
alter table public.balance_snapshots enable row level security;
create policy "own balance snapshots" on public.balance_snapshots for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.balance_snapshots to authenticated, service_role;
