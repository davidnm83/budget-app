-- Per-user layout choices: which widgets Home and the Budget tab show (in order), and the
-- categories on the spending watch list. Plus the gig-gas switch.
create table public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  home_widgets text[],
  budget_widgets text[],
  watch_categories uuid[],
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
create policy "own prefs" on public.user_prefs for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.user_prefs to authenticated, service_role;

-- Count the gas used for gig shifts as a gig cost instead of personal Gas spending.
alter table public.gig_settings add column exclude_gig_gas boolean not null default false;
