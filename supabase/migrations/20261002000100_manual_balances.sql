-- Auto balance for manual accounts (CSV / Fina imports), like Fina's "Auto balance":
-- balance = start balance + every transaction in the account. You type today's balance once and
-- the start balance is worked out, so later imports keep it right without retyping.
-- start_balance uses the app's sign (money you owe is negative).

alter table public.accounts add column start_balance numeric(14, 2);

-- Accounts with their balance worked out. current_balance keeps Plaid's convention
-- (cards and loans: amount owing as a positive number), so the app treats both kinds alike.
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

-- "My balance today is X": stores the start balance that makes it so. X uses the app's sign.
create or replace function public.set_balance_today(p_account uuid, p_balance numeric)
returns void language sql security invoker set search_path = '' as $$
  update public.accounts
  set start_balance = p_balance - coalesce((select sum(t.amount) from public.transactions t where t.account_id = p_account), 0)
  where id = p_account and kind = 'manual';
$$;

grant select on public.account_balances to authenticated, service_role;
revoke all on function public.set_balance_today(uuid, numeric) from public, anon;
grant execute on function public.set_balance_today(uuid, numeric) to authenticated, service_role;
