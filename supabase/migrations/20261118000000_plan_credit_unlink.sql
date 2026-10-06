-- A plan whose bank credit you unlinked by hand isn't searched for one again.
alter table public.payment_plans add column if not exists credit_search boolean not null default true;
