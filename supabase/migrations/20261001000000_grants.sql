-- Newer Supabase projects no longer grant table access to the API roles automatically
-- (exposure is opt-in). Grant exactly what the app and the Edge Functions need.
-- Row-level security still decides WHICH rows each signed-in user can touch.

grant usage on schema public to authenticated, service_role;

-- Signed-in users (the app)
grant select on public.plaid_items, public.sync_runs to authenticated;
grant select, insert, update, delete on
  public.accounts,
  public.categories,
  public.category_rules,
  public.merchant_rules,
  public.transactions,
  public.transaction_splits
to authenticated;

-- Edge Functions (secret / service role key)
grant select, insert, update, delete on all tables in schema public to service_role;

-- Nothing for anon: signed-out visitors get no table access at all.
