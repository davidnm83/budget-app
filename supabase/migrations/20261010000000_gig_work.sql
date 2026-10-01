-- Gig work (GIG-2, 3, 8): a shift log and a couple of settings. Payouts themselves are ordinary
-- transactions in the "Gig work" category.
create table public.gig_shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  platform text not null default 'doordash',
  start_time text,            -- "HH:MM"
  end_time text,
  active_minutes integer,
  deliveries integer,
  earnings numeric(10, 2) not null default 0,   -- total for the shift, tips included
  tips numeric(10, 2),
  km numeric(8, 1),
  notes text,
  created_at timestamptz not null default now()
);
create index gig_shifts_user_date on public.gig_shifts (user_id, date desc);
alter table public.gig_shifts enable row level security;
create policy "own gig shifts" on public.gig_shifts for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.gig_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  cost_per_km numeric(6, 3),
  weekly_target numeric(10, 2),
  updated_at timestamptz not null default now()
);
alter table public.gig_settings enable row level security;
create policy "own gig settings" on public.gig_settings for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
