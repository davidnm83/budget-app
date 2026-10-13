-- Pay later (buy now, pay later: Affirm, Klarna, PayPal Pay in 4…): a purchase paid in fixed instalments from a
-- bank account or card. The app keeps a bill for the payments (recurring_id) so the planner shows and matches them,
-- files each matched payment under what was bought, and keeps what's owed on a "Pay later" account.
create table public.pay_later (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,                                                   -- Affirm, Klarna, PayPal…
  description text not null,                                                -- what was bought
  total numeric(14,2) not null check (total > 0),                           -- the purchase price
  down_payment numeric(14,2) not null default 0 check (down_payment >= 0),  -- paid at checkout, not part of the plan
  payments smallint not null check (payments between 1 and 120),
  frequency text not null default 'biweekly' check (frequency in ('weekly', 'biweekly', 'monthly')),
  first_date date not null,                                                 -- the first scheduled payment
  purchase_date date,                                                       -- when it was bought (defaults to the first payment)
  apr numeric(6,3) not null default 0 check (apr >= 0),                     -- yearly interest, percent
  account_id uuid references public.accounts(id) on delete set null,        -- the account or card the payments come from
  category_id uuid references public.categories(id) on delete set null,     -- what was bought: where the payments are filed
  match_text text,                                                          -- how the payments show on the bank (e.g. AFFIRM)
  recurring_id uuid references public.recurring(id) on delete set null,     -- the bill the app keeps for the payments
  paid_by_hand smallint[] not null default '{}',                            -- payments marked paid by hand (1 = the first)
  closed_on date,                                                           -- paid off early or cancelled
  notes text,
  created_at timestamptz not null default now()
);
create index pay_later_user on public.pay_later (user_id);

alter table public.pay_later enable row level security;
create policy "own pay later plans" on public.pay_later using ((user_id = (select auth.uid() as uid))) with check ((user_id = (select auth.uid() as uid)));

-- New Supabase projects don't grant these automatically.
grant select, insert, update, delete on public.pay_later to authenticated;
grant all on public.pay_later to service_role;
