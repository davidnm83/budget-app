-- Release 2, first part:
--   • notes + tags on transactions (TXN-11); bank's original date/amount kept when you edit a Plaid row (TXN-12)
--   • history import from Fina (import_id makes it safe to run twice)
--   • monthly budgets per category or category group, with rollover (BUD-1, BUD-2)
--   • report functions: totals per category per month, cash flow by month, spending by merchant (RPT-1..3)

-- ───────────────────────── transactions ─────────────────────────
alter table public.transactions
  add column tags text[] not null default '{}',
  add column original_date date,           -- set the first time you change a Plaid row's date
  add column original_amount numeric(14, 2), -- ...or its amount; the bank's value lives here from then on
  add column import_id text;               -- e.g. 'fina:…' for imported history

alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('plaid', 'csv', 'manual', 'loan', 'import'));

create unique index transactions_import_id on public.transactions (user_id, import_id) where import_id is not null;
create index transactions_tags on public.transactions using gin (tags);
create index transaction_splits_txn on public.transaction_splits (transaction_id);

-- ───────────────────────── budgets ─────────────────────────
-- One row per month and per category OR per category group.
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid references public.categories on delete cascade,
  group_name text,
  amount numeric(14, 2) not null default 0,
  rollover boolean not null default false,  -- carry what's left (or overspent) into next month
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((category_id is null) <> (group_name is null))
);
create unique index budgets_month_category on public.budgets (user_id, month, category_id) where category_id is not null;
create unique index budgets_month_group on public.budgets (user_id, month, group_name) where group_name is not null;
create trigger budgets_updated before update on public.budgets for each row execute function public.set_updated_at();

alter table public.budgets enable row level security;
create policy "own budgets" on public.budgets for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── reporting ─────────────────────────
-- One line per transaction, or per split when a transaction is split. "kind" comes from the
-- category; uncategorized lines count as spending (money out) or income (money in), and
-- uncategorized transfers as transfers. Runs with the caller's permissions, so RLS applies.
create view public.transaction_lines with (security_invoker = true) as
select
  t.id as transaction_id,
  t.user_id,
  t.account_id,
  t.date,
  date_trunc('month', t.date)::date as month,
  case when s.id is null then t.category_id else s.category_id end as category_id,
  coalesce(s.amount, t.amount) as amount,
  coalesce(nullif(t.merchant, ''), t.name) as merchant,
  coalesce(c.kind,
    case when t.is_transfer then 'transfer'
         when coalesce(s.amount, t.amount) < 0 then 'expense'
         else 'income' end) as kind
from public.transactions t
left join public.transaction_splits s on s.transaction_id = t.id
left join public.categories c on c.id = (case when s.id is null then t.category_id else s.category_id end);

-- Signed totals per month and category (spending is negative). Feeds budgets, comparisons and the year view.
create or replace function public.report_category_months(p_from date, p_to date)
returns table (month date, category_id uuid, kind text, total numeric, txns bigint)
language sql stable security invoker set search_path = '' as $$
  select l.month, l.category_id, l.kind, sum(l.amount), count(*)
  from public.transaction_lines l
  where l.date between p_from and p_to
  group by 1, 2, 3
  order by 1, 2;
$$;

-- Income and spending per month (cash flow), newest first. Transfers are left out.
create or replace function public.report_months(p_from date default '1900-01-01', p_to date default '2999-12-31')
returns table (month date, income numeric, spending numeric, txns bigint)
language sql stable security invoker set search_path = '' as $$
  select l.month,
         coalesce(sum(l.amount) filter (where l.kind = 'income'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'expense'), 0),
         count(*)
  from public.transaction_lines l
  where l.date between p_from and p_to
  group by 1
  order by 1 desc;
$$;

-- Totals per merchant: spending (biggest first) or, with p_kind = 'income', money in by source
-- (e.g. which gig app paid what). Optionally for one category.
create or replace function public.report_merchants(p_from date, p_to date, p_category uuid default null, p_kind text default 'expense')
returns table (merchant text, total numeric, txns bigint)
language sql stable security invoker set search_path = '' as $$
  select l.merchant, sum(l.amount), count(*)
  from public.transaction_lines l
  where l.date between p_from and p_to
    and l.kind = p_kind
    and (p_category is null or l.category_id = p_category)
  group by 1
  order by case when p_kind = 'income' then -sum(l.amount) else sum(l.amount) end
  limit 200;
$$;

-- ───────────────────────── access ─────────────────────────
grant select, insert, update, delete on public.budgets to authenticated, service_role;
grant select on public.transaction_lines to authenticated, service_role;
revoke all on function public.report_category_months(date, date) from public, anon;
revoke all on function public.report_months(date, date) from public, anon;
revoke all on function public.report_merchants(date, date, uuid, text) from public, anon;
grant execute on function public.report_category_months(date, date) to authenticated, service_role;
grant execute on function public.report_months(date, date) to authenticated, service_role;
grant execute on function public.report_merchants(date, date, uuid, text) to authenticated, service_role;
