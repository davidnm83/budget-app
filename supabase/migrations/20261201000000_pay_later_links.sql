-- Pay later payments linked by hand to the transaction that paid them: payment number (1 = the first) → transaction id.
-- For a payment the app can't find by itself (a different day or description, a few cents off).
alter table public.pay_later add column if not exists paid_with jsonb not null default '{}'::jsonb;
