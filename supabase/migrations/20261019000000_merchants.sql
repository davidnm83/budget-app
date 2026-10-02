-- Merchants page: every merchant with how many transactions it has, the total and the last date.
create or replace function public.merchant_list()
returns table (merchant text, txns bigint, total numeric, last_date date)
language sql stable security invoker set search_path = '' as $$
  select coalesce(nullif(t.merchant, ''), t.name), count(*), sum(t.amount), max(t.date)
  from public.transactions t
  where coalesce(nullif(t.merchant, ''), t.name) is not null
  group by 1
  order by 2 desc;
$$;
revoke all on function public.merchant_list() from public, anon;
grant execute on function public.merchant_list() to authenticated, service_role;
