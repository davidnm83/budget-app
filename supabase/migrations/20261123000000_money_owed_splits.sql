-- Money owed (IDEA-9) as its own category. The part someone owes you is filed under "Money owed", a
-- transfer category, so it is left out of the budget and spending; the person sits on that line: the
-- transaction itself when all of it is owed, or one of its splits. What they owe is that line turned
-- around (money out = they owe you more, money in = they paid you back).
alter table public.transaction_splits add column if not exists iou_person text;

-- Entries made the earlier way (a person and an amount on the transaction) move over.
do $$
declare
  r record;
  cat uuid;
  part numeric;
  big uuid;
begin
  for r in select t.id, t.user_id, t.amount, t.category_id, t.iou_person, t.iou_amount,
                  exists (select 1 from public.transaction_splits s where s.transaction_id = t.id) as has_splits
             from public.transactions t
            where t.iou_person is not null
  loop
    select id into cat from public.categories where user_id = r.user_id and name = 'Money owed';
    if cat is null then
      insert into public.categories (user_id, name, group_name, kind, sort)
        values (r.user_id, 'Money owed', 'Transfers', 'transfer', 103) returning id into cat;
    end if;
    -- The owed part, with the transaction's own sign.
    part := sign(r.amount) * least(abs(coalesce(r.iou_amount, r.amount)), abs(r.amount));
    if abs(part) >= abs(r.amount) - 0.004 and not r.has_splits then
      update public.transactions set category_id = cat, category_source = 'manual', is_transfer = true, iou_amount = null where id = r.id;
    elsif not r.has_splits then
      insert into public.transaction_splits (user_id, transaction_id, category_id, amount) values (r.user_id, r.id, r.category_id, r.amount - part);
      insert into public.transaction_splits (user_id, transaction_id, category_id, amount, iou_person) values (r.user_id, r.id, cat, part, r.iou_person);
      update public.transactions set category_id = null, category_source = 'manual', iou_person = null, iou_amount = null where id = r.id;
    else
      -- Already split: the owed part comes out of its biggest part.
      select id into big from public.transaction_splits where transaction_id = r.id order by abs(amount) desc limit 1;
      update public.transaction_splits set amount = amount - part where id = big;
      delete from public.transaction_splits where id = big and amount = 0;
      insert into public.transaction_splits (user_id, transaction_id, category_id, amount, iou_person) values (r.user_id, r.id, cat, part, r.iou_person);
      update public.transactions set iou_person = null, iou_amount = null where id = r.id;
    end if;
  end loop;
end $$;

create index if not exists transaction_splits_iou on public.transaction_splits (user_id, iou_person) where iou_person is not null;
