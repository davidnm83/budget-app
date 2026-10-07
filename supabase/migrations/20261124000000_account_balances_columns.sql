-- account_balances is accounts plus the worked-out balance. A view's "a.*" is fixed when the view is made, so
-- columns added to accounts since (the CSV reminder, a card's minimum rule and checks, the weekend close) never
-- reached the app through it: the reminder switch, for one, always showed its default. Made again with every column.
-- Whenever a column is added to accounts, this view has to be made again too.
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
