-- 1. How often the scheduled bank sync runs for a user: every N hours counted from 5 AM
--    (24 = once a day, the default when empty; 0 = only when "Sync now" is tapped).
alter table public.user_prefs add column if not exists sync_every smallint;
alter table public.user_prefs drop constraint if exists user_prefs_sync_every_check;
alter table public.user_prefs add constraint user_prefs_sync_every_check check (sync_every is null or sync_every in (0, 1, 3, 6, 12, 24));

-- 2. Payment plans:
--    monthly_fee: a fixed fee charged with every instalment (some cards charge this instead of interest).
--    offset_start: for a plan against the card's balance rather than one purchase. The amount was
--    already counted as spending when it was charged, so it is taken back out of the plan's
--    category on the first instalment date, and the instalments put it back month by month.
alter table public.payment_plans add column if not exists monthly_fee numeric(14,2) not null default 0 check (monthly_fee >= 0);
alter table public.payment_plans add column if not exists offset_start boolean not null default false;
