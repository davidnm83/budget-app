-- Goals (GOAL-1, with IDEA-7 funds that refill each year), the receipt inbox (TXN-13), the credit
-- score log (VIEW-11) and storage for receipt photos and nightly backups (PLT-8).

-- A savings goal counts an account's balance (account_id) or money marked for it (goal_entries).
-- A payoff goal points at a loan or card (account_id) and counts what's still owed against start_value.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  kind text not null default 'save' check (kind in ('save', 'payoff')),
  target numeric(14,2) not null default 0 check (target >= 0),
  target_date date,
  start_date date not null default current_date,
  start_value numeric(14,2) not null default 0,
  account_id uuid references public.accounts(id) on delete set null,
  refills boolean not null default false,          -- a yearly fund: once the date passes, the next is a year on
  sort smallint not null default 0,
  closed_on date,
  created_at timestamptz not null default now()
);
create index goals_user on public.goals (user_id);

-- Money marked for a goal (positive) or spent from a fund (negative).
create table public.goal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  date date not null default current_date,
  amount numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);
create index goal_entries_goal on public.goal_entries (user_id, goal_id, date);

-- A receipt photo (in the private "receipts" storage bucket, under the user's own folder) with what
-- you typed, waiting for or attached to its transaction.
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null,                               -- <user id>/<receipt id>.jpg in the bucket
  taken_on date,
  amount numeric(14,2),
  merchant text,
  note text,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index receipts_user on public.receipts (user_id, transaction_id);

-- Credit scores you note down from Borrowell (Equifax) or your bank's app (TransUnion).
create table public.credit_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null default current_date,
  score smallint not null check (score between 300 and 900),
  bureau text not null default 'Equifax' check (bureau in ('Equifax', 'TransUnion', 'Other')),
  note text,
  created_at timestamptz not null default now()
);
create index credit_scores_user on public.credit_scores (user_id, date);

alter table public.goals enable row level security;
alter table public.goal_entries enable row level security;
alter table public.receipts enable row level security;
alter table public.credit_scores enable row level security;
create policy "own goals" on public.goals using ((user_id = (select auth.uid() as uid))) with check ((user_id = (select auth.uid() as uid)));
create policy "own goal entries" on public.goal_entries using ((user_id = (select auth.uid() as uid))) with check ((user_id = (select auth.uid() as uid)));
create policy "own receipts" on public.receipts using ((user_id = (select auth.uid() as uid))) with check ((user_id = (select auth.uid() as uid)));
create policy "own credit scores" on public.credit_scores using ((user_id = (select auth.uid() as uid))) with check ((user_id = (select auth.uid() as uid)));

-- New Supabase projects don't grant these automatically.
grant select, insert, update, delete on public.goals, public.goal_entries, public.receipts, public.credit_scores to authenticated;
grant all on public.goals, public.goal_entries, public.receipts, public.credit_scores to service_role;

-- Storage: two private buckets. Each user reads and writes only their own folder (named by their
-- user id). Backups are written by the nightly function (service role) and only read by the user.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728, array['image/jpeg', 'image/webp', 'image/png']),
       ('backups', 'backups', false, 52428800, array['application/json'])
on conflict (id) do nothing;

create policy "budget-app: own receipt photos" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "budget-app: read own backups" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
