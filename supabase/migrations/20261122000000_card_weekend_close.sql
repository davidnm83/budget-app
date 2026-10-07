-- Some banks close a statement on the next weekday when its day falls on a weekend (TD did on Monday
-- Aug 17 for the 16th); others close on the weekend day itself. On: move a weekend close to the Monday.
alter table public.accounts add column if not exists close_weekend_monday boolean not null default false;
