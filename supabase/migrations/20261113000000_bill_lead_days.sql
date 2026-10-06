-- A bill can be planned some days before its due date (BIL: pay a credit card ahead of its due day).
alter table public.recurring add column if not exists lead_days smallint check (lead_days between 0 and 28);
