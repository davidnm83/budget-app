-- Widget layouts for the built-in pages (Gig work, Credit cards, Car & loans, Spending watch):
-- { "gig": ["gig:tiles", ...], "credit": [...] }. A page with no entry shows its default layout.
alter table public.user_prefs add column if not exists page_layouts jsonb;
