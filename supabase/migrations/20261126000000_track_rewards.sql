-- Points redeemed in store (read from receipts): with track_rewards on, a receipt with points attached to its
-- transaction splits it into the purchase's full value and the points back under a "Rewards" income category.
-- A column on an existing table: its grants and row-level security already cover it.
alter table public.user_prefs add column if not exists track_rewards boolean not null default false;
