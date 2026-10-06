-- Payment plans: the bank's plan credit, for cards that move a plan off the balance with a credit
-- ("INSTALLMENT PLAN FOR $1,800.00"). It is a plan movement, not a payment, and from its date the
-- rest of the plan is owed outside the bank's balance.
alter table public.payment_plans add column if not exists credit_transaction_id uuid references public.transactions(id) on delete set null;
