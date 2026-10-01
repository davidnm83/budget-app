-- budget-app: initial schema
-- Amounts: money OUT of an account is negative, money IN is positive.
-- Every table is per-user and protected by row-level security (RLS).

create extension if not exists pgcrypto;

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── bank connections ─────────────────────────
-- One row per Plaid "Item" (one bank login). The access token itself lives in
-- Supabase Vault (encrypted); this table only keeps the Vault secret's id.
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id text not null unique,
  institution_name text not null default 'Unknown bank',
  access_token_secret_id uuid not null,
  cursor text,
  status text not null default 'ok' check (status in ('ok', 'login_required', 'error')),
  error_code text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  plaid_item_id uuid references public.plaid_items on delete set null,
  plaid_account_id text unique,
  kind text not null default 'manual' check (kind in ('plaid', 'manual')),
  name text not null,
  official_name text,
  mask text,
  type text,       -- depository, credit, loan, investment, other
  subtype text,    -- checking, savings, credit card, auto, ...
  currency text not null default 'CAD',
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  balance_updated_at timestamptz,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── categories & rules ─────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  group_name text not null default 'Other',
  kind text not null default 'expense' check (kind in ('expense', 'income', 'transfer')),
  is_hidden boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  match_text text not null,
  category_id uuid not null references public.categories on delete cascade,
  account_id uuid references public.accounts on delete cascade,
  min_amount numeric(14, 2),
  max_amount numeric(14, 2),
  created_at timestamptz not null default now()
);

create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  match text not null,
  merchant text not null,
  source text not null default 'manual' check (source in ('manual', 'learned')),
  created_at timestamptz not null default now(),
  unique (user_id, match)
);

-- ───────────────────────── transactions ─────────────────────────
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid not null references public.accounts on delete cascade,
  plaid_transaction_id text unique,
  source text not null default 'manual' check (source in ('plaid', 'csv', 'manual', 'loan')),
  date date not null,
  authorized_date date,
  amount numeric(14, 2) not null,
  currency text not null default 'CAD',
  name text not null,                 -- the bank's description, kept as-is
  merchant text,
  category_id uuid references public.categories on delete set null,
  category_source text check (category_source in ('rule', 'learned', 'plaid', 'manual')),
  plaid_category text,
  reviewed boolean not null default false,
  reviewed_at timestamptz,
  is_transfer boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_date on public.transactions (user_id, date desc);
create index transactions_unreviewed on public.transactions (user_id, date desc) where not reviewed;
create index transactions_account_date on public.transactions (account_id, date desc);

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  transaction_id uuid not null references public.transactions on delete cascade,
  category_id uuid references public.categories on delete set null,
  amount numeric(14, 2) not null,
  notes text
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  added integer not null default 0,
  message text
);

create trigger plaid_items_updated before update on public.plaid_items for each row execute function public.set_updated_at();
create trigger accounts_updated before update on public.accounts for each row execute function public.set_updated_at();
create trigger transactions_updated before update on public.transactions for each row execute function public.set_updated_at();

-- ───────────────────────── row-level security ─────────────────────────
alter table public.plaid_items enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.category_rules enable row level security;
alter table public.merchant_rules enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.sync_runs enable row level security;

-- Connections and sync history are written only by Edge Functions (service role);
-- users can read their own.
create policy "read own items" on public.plaid_items for select using (user_id = (select auth.uid()));
create policy "read own sync runs" on public.sync_runs for select using (user_id = (select auth.uid()));

create policy "own accounts" on public.accounts for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own categories" on public.categories for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own category rules" on public.category_rules for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own merchant rules" on public.merchant_rules for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own transactions" on public.transactions for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own splits" on public.transaction_splits for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── Vault helpers (service role only) ─────────────────────────
create or replace function public.store_plaid_token(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select vault.create_secret(p_token, null, 'Plaid access token') into sid;
  return sid;
end $$;

create or replace function public.read_plaid_token(p_secret_id uuid) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id;
$$;

create or replace function public.delete_plaid_token(p_secret_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where id = p_secret_id;
$$;

revoke all on function public.store_plaid_token(text) from public, anon, authenticated;
revoke all on function public.read_plaid_token(uuid) from public, anon, authenticated;
revoke all on function public.delete_plaid_token(uuid) from public, anon, authenticated;
grant execute on function public.store_plaid_token(text) to service_role;
grant execute on function public.read_plaid_token(uuid) to service_role;
grant execute on function public.delete_plaid_token(uuid) to service_role;

-- ───────────────────────── starter categories for every new user ─────────────────────────
create or replace function public.seed_default_categories() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.categories (user_id, name, group_name, kind, sort) values
    (new.id, 'Paycheque', 'Income', 'income', 10),
    (new.id, 'Gig Income', 'Income', 'income', 11),
    (new.id, 'Refunds', 'Income', 'income', 12),
    (new.id, 'Other Income', 'Income', 'income', 13),
    (new.id, 'Groceries', 'Food', 'expense', 20),
    (new.id, 'Restaurants', 'Food', 'expense', 21),
    (new.id, 'Gas', 'Car', 'expense', 30),
    (new.id, 'Car Insurance', 'Car', 'expense', 31),
    (new.id, 'Car Payment', 'Car', 'expense', 32),
    (new.id, 'Parking & Transit', 'Car', 'expense', 33),
    (new.id, 'Phone & Internet', 'Bills', 'expense', 40),
    (new.id, 'Subscriptions', 'Bills', 'expense', 41),
    (new.id, 'Gym', 'Bills', 'expense', 42),
    (new.id, 'Interest & Fees', 'Bills', 'expense', 43),
    (new.id, 'Shopping', 'Shopping', 'expense', 50),
    (new.id, 'Personal Care', 'Shopping', 'expense', 51),
    (new.id, 'Health', 'Health', 'expense', 60),
    (new.id, 'Education', 'Education', 'expense', 70),
    (new.id, 'Entertainment', 'Fun', 'expense', 80),
    (new.id, 'Gifts', 'Fun', 'expense', 81),
    (new.id, 'Home', 'Home', 'expense', 90),
    (new.id, 'Other', 'Other', 'expense', 99),
    (new.id, 'Transfer', 'Transfers', 'transfer', 100),
    (new.id, 'Credit Card Payment', 'Transfers', 'transfer', 101);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.seed_default_categories();
