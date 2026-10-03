-- Payment plans: changes to single instalments, keyed by instalment number, e.g.
--   {"2": {"date": "2026-11-20", "amount": 100.02, "paidBy": "<transaction id>", "budget": "added"}}
-- date: billed on another day. amount: what the bank actually billed (the last instalment evens
-- out the cents). paidBy: the card payment that paid it. budget: that month's instalment was
-- added to the category's budget, or the suggestion was turned down.
-- A column on an existing table: its grants and row-level security already cover it.
alter table public.payment_plans add column if not exists instalments jsonb not null default '{}'::jsonb;
