-- Security tidy-up: the new-user trigger function doesn't need to be callable by anyone.
-- (Postgres already refuses direct calls to trigger functions; this removes the grant as well.)
revoke execute on function public.seed_default_categories() from public, anon, authenticated;
