-- The Transactions tab reads this view: each transaction with its account and category names,
-- the absolute amount (for "largest first" and amount filters), and every category it touches,
-- including the categories of its split parts, so filtering by a category also finds splits.
create view public.transaction_list with (security_invoker = true) as
select
  t.id,
  t.user_id,
  t.account_id,
  t.date,
  t.amount,
  abs(t.amount) as amount_abs,
  t.currency,
  t.name,
  t.merchant,
  coalesce(nullif(t.merchant, ''), t.name) as display_name,
  lower(coalesce(nullif(t.merchant, ''), t.name)) as sort_name,
  t.category_id,
  t.category_source,
  t.reviewed,
  t.notes,
  t.tags,
  t.is_transfer,
  t.source,
  a.name as account_name,
  a.mask as account_mask,
  c.name as category_name,
  c.group_name as category_group,
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
