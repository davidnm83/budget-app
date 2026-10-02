-- The order of pages in the menu (hrefs, e.g. '/gig', '/page/abc'); pages not listed come after, in their usual order.
alter table public.user_prefs add column menu_order text[];
