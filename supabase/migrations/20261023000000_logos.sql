-- Logos. Plaid sends a logo and website with many transactions; keep them so merchants can show
-- a picture. merchant_sites lets you set a merchant's website yourself (its icon is used).
alter table public.transactions add column if not exists logo_url text;
alter table public.transactions add column if not exists website text;

create table if not exists public.merchant_sites (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  merchant text not null,
  domain text not null,
  primary key (user_id, merchant)
);
alter table public.merchant_sites enable row level security;
create policy "own merchant sites" on public.merchant_sites for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.merchant_sites to authenticated, service_role;

-- One row per merchant that has a logo or website from the bank feed.
create or replace function public.merchant_logos()
returns table (merchant text, logo_url text, website text)
language sql stable security invoker set search_path = '' as $$
  select coalesce(nullif(t.merchant, ''), t.name), max(t.logo_url), max(t.website)
  from public.transactions t
  where t.logo_url is not null or t.website is not null
  group by 1;
$$;
revoke all on function public.merchant_logos() from public, anon;
grant execute on function public.merchant_logos() to authenticated, service_role;
