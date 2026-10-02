-- Merchants page filters: a date range and a set of accounts (all optional).
drop function if exists public.merchant_list();
create or replace function public.merchant_list(p_from date default null, p_to date default null, p_accounts uuid[] default null)
returns table (merchant text, txns bigint, total numeric, last_date date)
language sql stable security invoker set search_path = '' as $$
  select coalesce(nullif(t.merchant, ''), t.name), count(*), sum(t.amount), max(t.date)
  from public.transactions t
  where coalesce(nullif(t.merchant, ''), t.name) is not null
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and (p_accounts is null or t.account_id = any(p_accounts))
  group by 1
  order by 2 desc;
$$;
revoke all on function public.merchant_list(date, date, uuid[]) from public, anon;
grant execute on function public.merchant_list(date, date, uuid[]) to authenticated, service_role;
