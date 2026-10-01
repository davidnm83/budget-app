-- The API roles need explicit access to new tables (see 20261001000000_grants.sql).
-- Missed for these three, which made the Gig work page say "permission denied" and group emojis not save.
grant select, insert, update, delete on public.category_groups, public.gig_shifts, public.gig_settings to authenticated, service_role;
