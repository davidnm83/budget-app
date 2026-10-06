-- Balance transfers between cards: recorded as they happen or after the fact. Their transactions
-- (the credit on the old card, the charge and fee on the new one) are linked once they arrive.
create table public.balance_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_account_id uuid not null references public.accounts(id) on delete cascade,
  to_account_id uuid not null references public.accounts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  fee numeric(14,2) not null default 0 check (fee >= 0),
  date date not null,
  promo_apr numeric(6,3) check (promo_apr >= 0),
  promo_end date,
  out_transaction_id uuid references public.transactions(id) on delete set null,
  in_transaction_id uuid references public.transactions(id) on delete set null,
  fee_transaction_id uuid references public.transactions(id) on delete set null,
  closed_on date,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index balance_transfers_user on public.balance_transfers (user_id);
alter table public.balance_transfers enable row level security;
create policy "own balance transfers" on public.balance_transfers for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.balance_transfers to authenticated, service_role;
