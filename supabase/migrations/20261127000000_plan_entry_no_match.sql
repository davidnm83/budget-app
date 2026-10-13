-- A planned entry left unmatched on purpose: the planner stops matching it to a transaction on its own.
-- A column on an existing table: its grants and row-level security already cover it.
alter table public.plan_entries add column if not exists no_match boolean not null default false;
