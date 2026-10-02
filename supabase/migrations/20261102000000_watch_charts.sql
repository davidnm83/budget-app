-- Spending watch: how the watched categories are drawn.
--   {"byGroup": true}                     categories in the same group share one stacked chart
--   {"custom": [{id, name, ids: [...]}]}  your own combined charts
alter table public.user_prefs add column watch_charts jsonb;
