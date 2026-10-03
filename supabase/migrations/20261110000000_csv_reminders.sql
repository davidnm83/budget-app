-- Reminders to import a bank CSV, at the times the scheduled sync runs, for accounts the sync can't reach
-- (manual accounts) or couldn't this time (a connection with an error).
-- accounts.csv_reminder: true = remind, false = never; null = automatic (cash and credit cards yes, loans and the rest no).
-- user_prefs.csv_prompted_at: when the reminder was last answered, so it comes back only at the next sync time.
-- Columns on existing tables: their grants and row-level security already cover them.
alter table public.accounts add column if not exists csv_reminder boolean;
alter table public.user_prefs add column if not exists csv_prompted_at timestamptz;
