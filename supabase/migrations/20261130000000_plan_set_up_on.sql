-- The day a card payment plan was set up with the bank. With the card's statement closing day, the first
-- instalment is billed on the first statement that closes on or after it (and one on each statement after),
-- the way the bank bills it. Plans without it keep the first instalment date entered by hand.
alter table public.payment_plans add column if not exists created_on date;
