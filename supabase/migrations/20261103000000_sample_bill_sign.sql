-- Sample data stored bills as positive amounts; bills are money out, so negative like everywhere
-- else. This patches load_sample_data in place where it exists, and corrects rows it already made.
do $$
declare def text;
begin
  if to_regprocedure('public.load_sample_data()') is null then return; end if;
  def := pg_get_functiondef('public.load_sample_data()'::regprocedure);
  if position('select u, x.name, x.kind, x.amt, x.freq' in def) > 0 then
    execute replace(def, 'select u, x.name, x.kind, x.amt, x.freq', 'select u, x.name, x.kind, case when x.kind = ''bill'' then -x.amt else x.amt end, x.freq');
  end if;
  update public.recurring r set amount = -r.amount
    where r.kind = 'bill' and r.amount > 0
      and r.account_id in (select id from public.accounts where kind = 'manual' and name like 'Sample %');
end $$;
