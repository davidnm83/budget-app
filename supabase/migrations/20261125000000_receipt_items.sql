-- Receipts read by AI (IDEA-12): the lines on the receipt, and which model read it ('haiku' or 'sonnet').
-- Columns on an existing table: its grants and row-level security already cover them.
alter table public.receipts add column if not exists items jsonb;
alter table public.receipts add column if not exists read_by text;
