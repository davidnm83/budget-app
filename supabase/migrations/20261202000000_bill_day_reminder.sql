-- A notification the morning a bill's payment is planned ("Payment day"), per bill. Empty: the default, on for
-- credit card payments (bills linked to a card) and off for other bills.
alter table public.recurring add column if not exists remind_on_day boolean;
