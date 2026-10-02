-- Bill suggestions the user dismissed, kept with the account so every device agrees.
alter table public.user_prefs add column if not exists dismissed_suggestions text[];
