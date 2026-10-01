-- Your own Reports tabs: [{ "id": "...", "name": "...", "widgets": ["avgspend", "watch", ...] }].
alter table public.user_prefs add column report_tabs jsonb;
