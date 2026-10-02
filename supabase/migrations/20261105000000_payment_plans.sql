-- Card payment plans: a purchase on a credit card paid in monthly instalments, with an optional
-- one-time fee and interest. The app works out the schedule and adds each instalment to the
-- budget in its own month (the bank doesn't list instalments as transactions).
create table public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,          -- the card
  transaction_id uuid references public.transactions(id) on delete set null,           -- the purchase, when it is in the app
  description text not null,
  category_id uuid references public.categories(id) on delete set null,                -- what the purchase was for
  interest_category_id uuid references public.categories(id) on delete set null,       -- where the fee and interest go
  paying_account_id uuid references public.accounts(id) on delete set null,            -- the account the card is paid from
  principal numeric(14,2) not null check (principal > 0),
  months smallint not null check (months between 1 and 120),
  start_date date not null,                                                            -- first instalment
  setup_fee numeric(14,2) not null default 0 check (setup_fee >= 0),
  apr numeric(6,3) not null default 0 check (apr >= 0),                                 -- yearly interest on the plan, percent
  post_charges boolean not null default true,       -- add the fee and interest as transactions (off when the statement lists them)
  count_from date,                                  -- instalments before this were already recorded by hand: track them, don't add them
  closed_on date,                                   -- paid off early
  created_at timestamptz not null default now()
);
create index payment_plans_user_account on public.payment_plans (user_id, account_id);

alter table public.payment_plans enable row level security;
create policy "own payment plans" on public.payment_plans using ((user_id = (select auth.uid() as uid))) with check ((user_id = (select auth.uid() as uid)));

-- New Supabase projects don't grant these automatically.
grant select, insert, update, delete on public.payment_plans to authenticated;
grant all on public.payment_plans to service_role;
