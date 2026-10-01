-- Gig work, part 2:
--   • a shift can have several apps on at once: time, km and gas stay on the shift; each app's
--     earnings, active time and orders go in gig_shift_parts
--   • gas from $/L and fuel efficiency
--   • when each app pays out (weekly on a set day, or instant with a fee), for the planner
create table public.gig_shift_parts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  shift_id uuid not null references public.gig_shifts on delete cascade,
  platform text not null,
  earnings numeric(10, 2) not null default 0,
  tips numeric(10, 2),
  active_minutes integer,
  deliveries integer
);
create index gig_shift_parts_shift on public.gig_shift_parts (shift_id);
alter table public.gig_shift_parts enable row level security;
create policy "own gig shift parts" on public.gig_shift_parts for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Every shift so far had one app: copy it into a part.
insert into public.gig_shift_parts (user_id, shift_id, platform, earnings, tips, active_minutes, deliveries)
select user_id, id, platform, earnings, tips, active_minutes, deliveries from public.gig_shifts;

alter table public.gig_shifts add column fuel_price numeric(6, 3), add column fuel_efficiency numeric(5, 2);
alter table public.gig_settings add column fuel_price numeric(6, 3), add column fuel_efficiency numeric(5, 2),
  add column plan_ahead boolean not null default false;

create table public.gig_platforms (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  platform text not null,
  payout_mode text not null default 'off' check (payout_mode in ('weekly', 'instant', 'off')),
  payout_weekday smallint not null default 0 check (payout_weekday between 0 and 6),  -- 0 = Monday
  instant_fee numeric(6, 2) not null default 0,
  account_id uuid references public.accounts on delete set null,
  match_text text,
  primary key (user_id, platform)
);
alter table public.gig_platforms enable row level security;
create policy "own gig platforms" on public.gig_platforms for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.gig_shift_parts, public.gig_platforms to authenticated, service_role;
