-- Payment plans: the one-time fee and the interest are now switched separately. Many cards list
-- the fee on the statement as its own line when the plan starts, but not the monthly interest.
-- post_fee: the app adds the fee as a transaction (turn off when the statement already has it).
-- post_charges keeps its column name and now means the interest only.
alter table public.payment_plans add column if not exists post_fee boolean not null default true;
