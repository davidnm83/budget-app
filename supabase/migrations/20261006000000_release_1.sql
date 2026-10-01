-- Release 1.0 foundations.

-- Icons: your own emoji per category or account (the app has defaults until you pick one).
alter table public.categories add column icon text;
alter table public.accounts add column icon text;

-- Loans (ACC-5, LOAN-1): payments are copied from the paying account (a debit there whose
-- description contains loan_payment_match), and interest is logged from the balance change,
-- as the Plaid Sync script does now.
alter table public.accounts
  add column loan_payment_match text,
  add column loan_paying_account_id uuid references public.accounts on delete set null,
  add column loan_last_balance numeric(14, 2),      -- amount owing when interest was last logged
  add column loan_last_balance_date date;

-- Credit card bills (BIL-3): the amount comes from the card's statement instead of a fixed number.
alter table public.recurring
  add column card_account_id uuid references public.accounts on delete set null,
  add column card_rule text check (card_rule in ('statement', 'minimum', 'custom'));

-- Transfers between your own accounts are paired (TXN-8): both sides point at each other.
alter table public.transactions add column transfer_pair_id uuid references public.transactions on delete set null;
create index transactions_transfer_pair on public.transactions (transfer_pair_id) where transfer_pair_id is not null;

-- account_balances lists a.* as of creation; recreate for the new account columns.
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
grant select on public.account_balances to authenticated, service_role;

-- transaction_list gains the category icon (recreated: a view's column list is fixed).
drop view if exists public.transaction_list cascade;
create view public.transaction_list with (security_invoker = true) as
select
  t.id, t.user_id, t.account_id, t.date, t.amount, abs(t.amount) as amount_abs, t.currency, t.name, t.merchant,
  coalesce(nullif(t.merchant, ''), t.name) as display_name,
  lower(coalesce(nullif(t.merchant, ''), t.name)) as sort_name,
  t.category_id, t.category_source, t.reviewed, t.notes, t.tags, t.is_transfer, t.source, t.transfer_pair_id,
  a.name as account_name, a.mask as account_mask,
  c.name as category_name, c.group_name as category_group, c.icon as category_icon,
  coalesce(sp.n, 0) as split_count,
  case when coalesce(sp.n, 0) > 0 then coalesce(sp.category_ids, '{}') else array_remove(array[t.category_id], null) end as category_ids
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id
left join lateral (
  select count(*) as n, array_agg(distinct s.category_id) filter (where s.category_id is not null) as category_ids
  from public.transaction_splits s where s.transaction_id = t.id
) sp on true;
grant select on public.transaction_list to authenticated, service_role;

-- merchant_names() depended on transaction_list (dropped above with cascade); recreate it.
create or replace function public.merchant_names()
returns table (merchant text, txns bigint)
language sql stable security invoker set search_path = '' as $$
  select display_name, count(*) from public.transaction_list group by 1 order by 2 desc, 1 limit 2000;
$$;
revoke all on function public.merchant_names() from public, anon;
grant execute on function public.merchant_names() to authenticated, service_role;
