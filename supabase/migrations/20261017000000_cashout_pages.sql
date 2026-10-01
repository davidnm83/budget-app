-- GIG-10: a shift's pay for one app can be cashed out early (instant pay) with its own fee.
alter table public.gig_shift_parts add column cashed_out boolean not null default false, add column cashout_fee numeric(6, 2);
-- NAV-2: your own pages in the menu: [{ "id", "name", "icon", "widgets": [...] }].
alter table public.user_prefs add column pages jsonb;
