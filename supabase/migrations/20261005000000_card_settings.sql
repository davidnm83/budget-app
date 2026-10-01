-- Credit card details for the card page: limit (for utilisation), statement closing day,
-- payment due day and interest rate (for the interest estimate). The limit fills in from the
-- bank when it reports one; the rest you enter in the account pop-up.
alter table public.accounts
  add column credit_limit numeric(14, 2),
  add column statement_day smallint check (statement_day between 1 and 31),
  add column due_day smallint check (due_day between 1 and 31),
  add column apr numeric(6, 3);  -- percent, e.g. 20.99

-- account_balances lists a.* as of when it was created, so recreate it for the new columns.
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
