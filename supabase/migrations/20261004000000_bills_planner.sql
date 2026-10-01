-- Foundations for recurring bills/income (BIL) and the weekly planner (PLN).

-- ───────────────────────── recurring bills and income ─────────────────────────
-- One row per bill or paycheque. Due dates are worked out from the schedule:
--   weekly / biweekly: every 7 / 14 days from start_date
--   monthly: on start_date's day of the month (the 31st falls back to the month's last day)
--   yearly: on start_date's month and day
create table public.recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null default 'bill' check (kind in ('bill', 'income')),
  amount numeric(14, 2) not null,                    -- app sign: bills negative, income positive
  estimated boolean not null default false,          -- varies month to month (matched with a wider tolerance)
  frequency text not null default 'monthly' check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly')),
  start_date date not null,                          -- first due date; sets the day of the month/week
  end_date date,                                     -- instalment plans stop on their own
  account_id uuid references public.accounts on delete set null,  -- paying (or receiving) account
  category_id uuid references public.categories on delete set null,
  match_text text,                                   -- text in the bank description, e.g. 'ROGERS'
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger recurring_updated before update on public.recurring for each row execute function public.set_updated_at();

-- ───────────────────────── planner ─────────────────────────
-- One-off planned entries, and changes to a single occurrence of a recurring one
-- (recurring_id + occurrence_date: moved, different amount, skipped).
create table public.plan_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  description text not null,
  amount numeric(14, 2) not null,                    -- app sign
  account_id uuid references public.accounts on delete cascade,
  to_account_id uuid references public.accounts on delete set null,  -- planned transfer: shows on both accounts
  category_id uuid references public.categories on delete set null,
  recurring_id uuid references public.recurring on delete cascade,
  occurrence_date date,
  skipped boolean not null default false,
  matched_transaction_id uuid references public.transactions on delete set null,  -- set by hand (PLN-6)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurring_id, occurrence_date)
);
create index plan_entries_user_date on public.plan_entries (user_id, date);
create trigger plan_entries_updated before update on public.plan_entries for each row execute function public.set_updated_at();

-- Which accounts the weekly plan covers (PLN-14) and the balance to stay above (PLN-4).
alter table public.accounts
  add column plan_include boolean not null default false,
  add column plan_buffer numeric(14, 2) not null default 0;
-- Start with chequing accounts in the plan (change it per account in the app).
update public.accounts set plan_include = true
where type = 'depository' and coalesce(subtype, '') not in ('savings', 'cd', 'money market') and name not ilike '%saving%';

-- The account_balances view lists a.* at creation time, so it's recreated to pick these up.
drop view if exists public.account_balances;
create view public.account_balances with (security_invoker = true) as
select
  a.*,
  case
    when a.kind = 'manual' and a.start_balance is not null then
      (case when a.type in ('credit', 'loan') then -1 else 1 end) * (a.start_balance + coalesce(s.total, 0))
    else a.current_balance
  end as balance,
  case when a.kind = 'manual' and a.start_balance is not null then s.last_change else a.balance_updated_at end as balance_as_of
from public.accounts a
left join lateral (
  select sum(t.amount) as total, max(t.updated_at) as last_change
  from public.transactions t where t.account_id = a.id
) s on true;

-- ───────────────────────── merchants for the filter picker ─────────────────────────
create or replace function public.merchant_names()
returns table (merchant text, txns bigint)
language sql stable security invoker set search_path = '' as $$
  select display_name, count(*) from public.transaction_list group by 1 order by 2 desc, 1 limit 2000;
$$;

-- ───────────────────────── access ─────────────────────────
alter table public.recurring enable row level security;
alter table public.plan_entries enable row level security;
create policy "own recurring" on public.recurring for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own plan entries" on public.plan_entries for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.recurring, public.plan_entries to authenticated, service_role;
grant select on public.account_balances to authenticated, service_role;
revoke all on function public.merchant_names() from public, anon;
grant execute on function public.merchant_names() to authenticated, service_role;
