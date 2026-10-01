-- Gig shifts: where a shift came from (so an import can be re-run without duplicates) and,
-- when known, what the gas for that shift actually cost (otherwise km × cost per km is used).
alter table public.gig_shifts
  add column source text not null default 'app',
  add column fuel_cost numeric(8, 2),
  add column fuel_litres numeric(8, 2);
create index gig_shifts_source on public.gig_shifts (user_id, source);
