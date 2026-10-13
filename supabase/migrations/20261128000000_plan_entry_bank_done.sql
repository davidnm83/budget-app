-- A planned entry marked by hand as done by the bank: already in the account's balance though not listed
-- yet, so the planner doesn't count it a second time. A column on an existing table: its grants and
-- row-level security already cover it.
alter table public.plan_entries add column if not exists bank_done boolean not null default false;
