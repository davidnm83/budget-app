-- A categorised transaction is a transfer exactly when its category is a transfer category. Earlier
-- syncs could keep the bank's transfer hint on a row the user filed as spending; this lines them up and
-- ends any transfer pair one of whose sides is no longer a transfer.
update public.transactions t set is_transfer = (c.kind = 'transfer')
  from public.categories c
  where c.id = t.category_id and t.is_transfer is distinct from (c.kind = 'transfer');

update public.transactions set transfer_pair_id = null
  where transfer_pair_id is not null and not is_transfer;
update public.transactions t set transfer_pair_id = null
  where t.transfer_pair_id is not null
    and not exists (select 1 from public.transactions o where o.id = t.transfer_pair_id and o.transfer_pair_id = t.id);
