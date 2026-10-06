-- A card's own minimum-payment rule, worked out from statements checked against the bank
-- (see minimumPayment in packages/core/src/cards.ts). Null = the app's 3%, at least $10 estimate.
alter table public.accounts add column if not exists minimum_rule jsonb;
-- The statements checked so far: [{close, balance, charges, minimum}], newest last.
alter table public.accounts add column if not exists minimum_checks jsonb;

-- IDEA-9 money owed: a transaction can count toward what a person owes you (or you owe them).
-- iou_amount is signed from your side: positive = they owe you that much more, negative = less
-- (or you owe them). It defaults to the whole transaction, turned around (money out = they owe you).
alter table public.transactions add column if not exists iou_person text;
alter table public.transactions add column if not exists iou_amount numeric(14,2);
create index if not exists transactions_iou on public.transactions (user_id, iou_person) where iou_person is not null;
